"""약초의 숲 원경: 목표 이미지의 유적·폭포·하늘 부분만 잘라 UI를 지우고 좌우 반전으로 이어 붙여 넓은 패럴랙스 원경 제작.
(플레이 지형은 포함하지 않음 — 지형은 별도 파괴 가능 레이어)"""
import cv2, numpy as np
src = cv2.imread('/mnt/user-data/uploads/a4b1a077-image.png')
x0, x1, y1 = 790, 1600, 418
crop = src[0:y1, x0:x1].copy()
mask = np.zeros(crop.shape[:2], np.uint8)
for (a, b, c, d) in [(1255, 8, 1600, 166), (785, 0, 1112, 128)]:
    mask[max(0, b):d, max(0, a - x0):c - x0] = 255
# UI가 덮던 위쪽 하늘 띠(0~170px)는 깨끗한 하늘 열(패널 사이)의 색으로 만든 세로 그라디언트로 교체
# 원본 하늘 색(BGR): 위 짙은 파랑 → 아래 밝은 하늘색
top = np.array([196, 84, 18], np.float32); bot = np.array([238, 176, 92], np.float32)
sky = np.array([top + (bot - top) * min(1, y / 230) for y in range(crop.shape[0])])
band = np.repeat(sky[:, None, :], crop.shape[1], axis=1)
out = crop.astype(np.float32)
for y in range(0, 210):
    k = 1.0 if y < 165 else 1 - (y - 165) / 45
    out[y] = out[y] * (1 - k) + band[y] * k
# 픽셀 구름 몇 개 (흰색 뭉게구름)
rng = np.random.default_rng(3)
for _ in range(7):
    cx, cy = rng.integers(20, crop.shape[1] - 20), rng.integers(20, 150)
    for _b in range(rng.integers(4, 8)):
        bx, by, r = cx + rng.integers(-45, 45), cy + rng.integers(-6, 6), rng.integers(10, 22)
        yy, xx = np.ogrid[:crop.shape[0], :crop.shape[1]]
        m = ((xx - bx) ** 2 + ((yy - by) * 1.3) ** 2) < r * r
        shade = np.where(yy > by + r * 0.3, 0.86, 1.0)[..., None]
        col = np.array([255, 250, 244], np.float32)[None, None, :] * shade
        out = np.where(m[..., None], col, out)
crop = out.clip(0, 255).astype(np.uint8)
wide = np.concatenate([crop, crop[:, ::-1]], axis=1)  # 이음새 없는 반복용
# 아래로 숲 그늘색으로 페이드 (지형 뒤로 자연스럽게 이어짐)
h = wide.shape[0]
pad = 260
under = np.zeros((pad, wide.shape[1], 3), np.uint8)
base = np.array([46, 92, 40], np.float32)  # BGR 짙은 숲
under[:] = base
out = np.concatenate([wide, under], 0).astype(np.float32)
for i in range(60):
    k = i / 60
    out[h - 60 + i] = out[h - 60 + i] * (1 - k) + base * k
cv2.imwrite('public/bg/herb_forest.jpg', out.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
print(out.shape)
