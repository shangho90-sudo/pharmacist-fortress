"""화산 연구소/하늘의 약국 배경: 사용자 원화를 1600×900로 맞추고, 아래쪽(실제 지형과 혼동될 수 있는 바위/섬)을
점점 흐리게+대기색 헤이즈로 밀어 원경처럼 보이게 한다."""
import numpy as np, cv2
JOBS = {'volcano_lab': ('/mnt/user-data/uploads/4d015e72-image.png', (40, 22, 60)), 'sky_pharmacy': ('/mnt/user-data/uploads/cd5b57a6-image.png', (250, 236, 220))}
for k, (f, haze) in JOBS.items():
    im = cv2.resize(cv2.imread(f), (1600, 900), interpolation=cv2.INTER_AREA).astype(np.float32)
    h = im.shape[0]
    blur = cv2.GaussianBlur(im, (0, 0), 2.2)
    t = np.clip((np.arange(h) / h - 0.42) / 0.5, 0, 1)[:, None, None]
    out = im * (1 - t * 0.85) + blur * (t * 0.85)
    hz = 0.08 + 0.42 * t
    out = out * (1 - hz) + np.array(haze, np.float32) * hz
    cv2.imwrite(f'public/bg/{k}.jpg', out.clip(0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(k)
