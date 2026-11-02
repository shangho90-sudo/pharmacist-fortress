"""레퍼런스 이미지에서 캐릭터를 잘라 배경(흰색)과 이름판을 제거한 투명 PNG로 저장."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

A = '/mnt/user-data/uploads/25d19fe4-image.png'
B = '/mnt/user-data/uploads/2c7d290c-image.jpg'
# (파일, 셀 x0,y0,x1,y1, id)
CELLS = [
    (A, 0, 150, 384, 1024, 'du'), (A, 384, 150, 768, 1024, 'jo'), (A, 768, 150, 1152, 1024, 'sagong'), (A, 1152, 150, 1536, 1024, 'yong'),
    (B, 150, 0, 560, 512, 'paeng'), (B, 560, 0, 960, 512, 'gu'), (B, 960, 0, 1400, 512, 'bang'),
    (B, 150, 500, 560, 1024, 'cheol'), (B, 560, 500, 960, 1024, 'seok'), (B, 960, 500, 1400, 1024, 'dong'),
]
OUT = sys.argv[1]
TARGET_H = 240  # 텍스처 높이. 게임에서 1/3배로 표시 → 월드 80px (줌2: 화면 160px, 줌3: 240px 1:1)

for path, x0, y0, x1, y1, cid in CELLS:
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)[y0:y1, x0:x1]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx = im.max(-1); mn = im.min(-1)
    whiteish = (mn > 228) & (mx - mn < 22)
    # 테두리와 연결된 흰 영역만 배경
    lab, n = ndimage.label(whiteish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    fg = ~bg
    # 이름판(남색) 위치 → 그 위까지만 캐릭터
    navy = (b > 70) & (b - r > 45) & (r < 70) & (g < 90)
    rows = np.where(navy.sum(1) > 80)[0]
    rows = rows[rows > fg.shape[0] * 0.55]
    plate_top = rows.min() if len(rows) else fg.shape[0]
    fg[plate_top - 3:] = False
    # 가장 큰 연결 성분(캐릭터)만
    lab2, n2 = ndimage.label(fg)
    sizes = ndimage.sum(fg, lab2, range(1, n2 + 1))
    keep = 1 + int(np.argmax(sizes))
    mask = lab2 == keep
    ys, xs = np.where(mask)
    # 다리 사이처럼 갇힌 흰 배경(하단 22%)은 투명 처리 — 가운의 흰색은 상단이라 보존
    enclosed = whiteish & ~bg & mask
    lab3, n3 = ndimage.label(enclosed)
    leg_y = ys.min() + (ys.max() - ys.min()) * 0.78
    for k in range(1, n3 + 1):
        cyy, cxx = np.where(lab3 == k)
        if cyy.mean() < leg_y or len(cyy) > 4000:
            continue
        hgt = cyy.max() - cyy.min() + 1
        wid = cxx.max() - cxx.min() + 1
        mid = int(np.median(cyy))
        row = np.where(lab3[mid] == k)[0]
        lx, rx = row.min() - 2, row.max() + 2
        if lx < 0 or rx >= im.shape[1]:
            continue
        dark = lambda x: im[mid, x].max() < 85
        # 양옆이 검은 바지이고 세로로 긴 틈 → 다리 사이 배경
        if dark(lx) and dark(rx) and hgt >= 0.6 * wid:
            mask[lab3 == k] = False
    ys, xs = np.where(mask)
    cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.zeros((cy1 - cy0, cx1 - cx0, 4), np.uint8)
    rgba[..., :3] = im[cy0:cy1, cx0:cx1].clip(0, 255)
    rgba[..., 3] = mask[cy0:cy1, cx0:cx1] * 255
    img = Image.fromarray(rgba, 'RGBA')
    # 프리멀티플라이 후 축소 → 가장자리 흰 테두리 방지
    w = round(img.width * TARGET_H / img.height)
    pm = Image.fromarray(rgba, 'RGBA').convert('RGBa').resize((w, TARGET_H), Image.LANCZOS).convert('RGBA')
    a = np.asarray(pm).copy()
    # 부드러운 알파 유지(선형 필터링용), 희미한 번짐만 제거
    a[..., 3] = np.where(a[..., 3] < 40, 0, np.minimum(255, a[..., 3].astype(np.int32) * 5 // 4))
    Image.fromarray(a, 'RGBA').save(f'{OUT}/{cid}.png', optimize=True)
    Image.fromarray(rgba, 'RGBA').save(f'/tmp/full_{cid}.png')
    print(cid, 'plate_top', plate_top, 'crop', (cx1 - cx0, cy1 - cy0), '->', (w, TARGET_H))
