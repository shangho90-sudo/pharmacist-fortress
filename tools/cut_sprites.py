"""캐릭터 시트(어두운 패널)의 '인게임 스프라이트'에서 대기/전투/공격 프레임을 GrabCut으로 분리해 투명 PNG로 저장.
출력: public/chars2/<id>_<frame>.png + manifest.json (발 기준 몸 중심 x 비율, 높이)"""
import json, sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage

U = '/mnt/user-data/uploads/'
# id: (파일, {프레임: (x0,y0,x1,y1)})  — 좌표는 원본 1024x1536 기준
SHEETS = {
    'seok':   ('a4e947c4', {'idle': (250, 985, 375, 1137), 'battle': (405, 985, 545, 1137), 'shoot': (575, 985, 725, 1137)}),
    'du':     ('cb3badbd', {'idle': (250, 980, 365, 1138), 'battle': (400, 980, 530, 1138), 'shoot': (570, 980, 730, 1138)}),
    'jo':     ('5c9a7040', {'idle': (250, 985, 355, 1140), 'battle': (540, 985, 690, 1140), 'shoot': (540, 985, 690, 1140)}),
    'sagong': ('a5acda15', {'idle': (250, 985, 370, 1140), 'battle': (415, 985, 540, 1140), 'shoot': (575, 985, 720, 1140)}),
    'yong':   ('e0496413', {'idle': (400, 985, 535, 1137), 'battle': (400, 985, 535, 1137), 'shoot': (565, 985, 722, 1137)}),
    'paeng':  ('0373dcfa', {'idle': (50, 995, 205, 1150), 'battle': (250, 995, 415, 1150), 'shoot': (465, 990, 665, 1150)}),
    'gu':     ('5a9b98ee', {'idle': (240, 1030, 350, 1183), 'battle': (400, 1030, 545, 1183), 'shoot': (590, 1030, 740, 1183)}),
    'bang':   ('31ea36a3', {'idle': (280, 945, 390, 1097), 'battle': (610, 945, 755, 1102), 'shoot': (610, 945, 755, 1102)}),
    'cheol':  ('a0b76c9f', {'idle': (240, 985, 365, 1138), 'battle': (390, 985, 530, 1138), 'shoot': (570, 985, 720, 1138)}),
    'dong':   ('09876748', {'idle': (245, 995, 360, 1152), 'battle': (400, 995, 544, 1152), 'shoot': (586, 995, 728, 1152)}),
}
OUT = sys.argv[1]
PAD = 10


def make_walk(cid, rgba, body_x, manifest):
    """전투 자세 스프라이트의 다리 부분을 부드러운 변위장으로 휘어 걷기 4프레임 생성 (이음새 없음)."""
    h, w = rgba.shape[:2]
    img = np.zeros((h, w + PAD * 2, 4), np.uint8)
    img[:, PAD:PAD + w] = rgba
    W = w + PAD * 2
    cx = body_x + PAD
    hip = h * 0.70  # 이 아래부터 다리가 움직임
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float32)
    t = np.clip((yy - hip) / (h - hip), 0, 1)
    wy = t * t * (3 - 2 * t)  # 엉덩이 0 → 발 1
    side = np.clip((xx - cx) / 7.0, -1, 1)  # 왼다리 -1, 오른다리 +1 (가운데 부드럽게)
    sl = np.clip(-side, 0, 1)
    sr = np.clip(side, 0, 1)
    k = h / 80.0  # 월드 1px당 텍스처 px
    for i in range(4):
        ph = i / 4 * 2 * np.pi
        strideL, strideR = np.cos(ph) * 3.4 * k, -np.cos(ph) * 3.4 * k
        liftL, liftR = max(0, np.sin(ph)) * 3.0 * k, max(0, np.sin(ph + np.pi)) * 3.0 * k
        dx = (sl * strideL + sr * strideR) * wy
        dy = -(sl * liftL + sr * liftR) * wy * wy
        bob = (abs(np.sin(ph)) * 1.2 * k)  # 상체 출렁임
        dyall = dy - bob * (1 - wy)
        mapx = (xx - dx).astype(np.float32)
        mapy = (yy - dyall).astype(np.float32)
        out = cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        Image.fromarray(out, 'RGBA').save(f'{OUT}/{cid}_walk{i}.png', optimize=True)
        manifest[cid][f'walk{i}'] = {'w': int(W), 'h': int(h), 'ox': round(cx / W, 3)}

manifest = {}
for cid, (fid, frames) in SHEETS.items():
    src = cv2.imread(f'{U}{fid}-image.png')
    manifest[cid] = {}
    for fname, (x0, y0, x1, y1) in frames.items():
        pad = 6
        crop = src[y0 - pad:y1 + pad, x0 - pad:x1 + pad].copy()
        h, w = crop.shape[:2]
        border = np.concatenate([crop[:3].reshape(-1, 3), crop[-3:].reshape(-1, 3), crop[:, :3].reshape(-1, 3), crop[:, -3:].reshape(-1, 3)])
        bgc = np.median(border, axis=0)
        dist = np.sqrt(((crop.astype(np.float32) - bgc) ** 2).sum(-1))
        # 배경 = 테두리에서 이어진 '배경색에 가깝고 매끈한' 픽셀 (머리카락처럼 어두워도 질감이 있으면 멈춤)
        g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
        mu = cv2.blur(g, (3, 3))
        sd = np.sqrt(np.maximum(0, cv2.blur(g * g, (3, 3)) - mu * mu))
        # 배경 색을 국소적으로 추정(패널 그라디언트 대응): 테두리 평균의 큰 블러
        bgish = (dist < 30) & (sd < 7)
        lab0, n0 = ndimage.label(bgish)
        edge_ids = set(np.unique(np.concatenate([lab0[0], lab0[-1], lab0[:, 0], lab0[:, -1]]))) - {0}
        bg = np.isin(lab0, list(edge_ids))
        # 배경 영역에서 한 번 더 확장: 배경과 맞닿고 색이 매우 가까운 픽셀
        for _ in range(2):
            grow = ndimage.binary_dilation(bg) & (dist < 20)
            bg |= grow
        fg = ~bg
        fg = ndimage.binary_opening(fg, iterations=1)
        lab, n = ndimage.label(fg)
        if n == 0:
            continue
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        keep = np.zeros_like(fg)
        big = int(np.argmax(sizes)) + 1
        keep |= lab == big
        # 큰 덩어리 근처의 작은 조각(무기 끝 등)도 포함
        near = ndimage.binary_dilation(lab == big, iterations=4)
        for i, s_ in enumerate(sizes):
            if i + 1 != big and s_ > 40 and (near & (lab == i + 1)).any():
                keep |= lab == i + 1
        keep = ndimage.binary_fill_holes(keep)
        # 맨 아래 3px 안의 넓고 얇은 가로줄(라벨 테두리 잔상) 제거
        rows_ = np.where(keep.any(1))[0]
        if len(rows_):
            yb = rows_.max()
            for yy in range(yb, max(0, yb - 4), -1):
                if keep[yy].sum() > keep.shape[1] * 0.45 and keep[yy - 3].sum() < keep[yy].sum() * 0.8:
                    keep[yy:] = False
        ys, xs = np.where(keep)
        cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[..., :3] = rgb
        # 가장자리 1px 부드럽게
        soft = cv2.GaussianBlur(keep.astype(np.float32), (3, 3), 0.6)
        rgba[..., 3] = (np.clip(soft * 1.4, 0, 1) * keep.astype(np.float32) * 255 + (soft * 120) * (~keep)).clip(0, 255).astype(np.uint8)
        # 발광(오라) 픽셀은 배경색과의 거리만큼 반투명 → 잘린 직선 가장자리 대신 자연스럽게 사라짐
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(np.int16)
        lum = crop.astype(np.float32).mean(-1)
        # 오라: 채도 높은 중간 밝기 픽셀 중 바깥 가장자리 근처(10px)만 (머리카락·바지 같은 어두운 부분 제외)
        edge_d = ndimage.distance_transform_edt(keep)
        glow = keep & (dist < 80) & (hsv[..., 1] > 110) & (hsv[..., 2] > 70) & (edge_d < 10)
        if cid == 'bang':
            # 방약사: 활 뒤의 짙은 노란 후광 제거 (어둡고 탁한 노랑, 바깥과 이어진 영역)
            # 활 쪽(오른쪽 45%)의 어두운 황갈색 후광만 (머리카락은 왼쪽이라 영향 없음, 밝은 금색 활은 V가 높아 유지)
            olive = (hsv[..., 0] >= 12) & (hsv[..., 0] <= 38) & (hsv[..., 2] < 120) & (hsv[..., 1] > 120)
            olive[:, : int(w * 0.55)] = False
            lab_o, n_o = ndimage.label(olive & keep)
            outside = ndimage.binary_dilation(~keep, iterations=2)
            for k in range(1, n_o + 1):
                comp = lab_o == k
                if comp.sum() > 12:
                    keep[comp] = False
            soft = cv2.GaussianBlur(keep.astype(np.float32), (3, 3), 0.6)
            rgba[..., 3] = (np.clip(soft * 1.4, 0, 1) * keep.astype(np.float32) * 255).clip(0, 255).astype(np.uint8)
            glow &= keep
        a = rgba[..., 3].astype(np.float32)
        a[glow] *= np.clip(np.maximum((dist[glow] - 18) / 62, edge_d[glow] / 10), 0.0, 1.0)
        # 잘라낸 상자 좌우 끝에 걸린 오라는 끝으로 갈수록 투명하게 (직선으로 잘린 느낌 제거)
        sat = (hsv[..., 1] > 90) & keep
        xr = np.arange(w)[None, :].repeat(h, 0)
        fade = np.clip(np.minimum(xr - pad, w - pad - 1 - xr) / 14.0, 0, 1)
        a[sat] *= fade[sat]
        rgba[..., 3] = a.astype(np.uint8)
        ys, xs = np.where(rgba[..., 3] > 8)
        cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = rgba[cy0:cy1, cx0:cx1]
        km = keep[cy0:cy1, cx0:cx1]
        # 몸 중심: 하단 25%(다리) 픽셀의 중앙값
        hh = km.shape[0]
        ly, lx = np.where(km[int(hh * 0.75):])
        body_x = float(np.median(lx)) if len(lx) else km.shape[1] / 2
        Image.fromarray(rgba, 'RGBA').save(f'{OUT}/{cid}_{fname}.png', optimize=True)
        manifest[cid][fname] = {'w': int(km.shape[1]), 'h': int(hh), 'ox': round(body_x / km.shape[1], 3)}
        if fname == 'battle':
            make_walk(cid, rgba, body_x, manifest)
    print(cid, manifest[cid])
json.dump(manifest, open(f'{OUT}/manifest.json', 'w'), indent=1)
