"""시작/캐릭터 선택 화면 원화 준비: 선택 화면에서 고정된 '1P' 배지·금색 선택 테두리를 지워 배경으로 사용."""
import cv2, numpy as np
U = '/mnt/user-data/uploads/'
t = cv2.imread(U + '2d2ef082-image.png')
cv2.imwrite('public/ui/title.jpg', cv2.resize(t, (1920, round(1920 * t.shape[0] / t.shape[1])), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 90])
s = cv2.imread(U + '29ef8e2e-image.png')
hsv = cv2.cvtColor(s, cv2.COLOR_BGR2HSV)
mask = np.zeros(s.shape[:2], np.uint8)
# 팽약사 카드 바깥 금색 테두리/글로우 띠
y0, y1, x0, x1 = 146, 424, 60, 362
band = np.zeros_like(mask); band[y0:y1, x0:x1] = 1; band[178:398, 92:332] = 0
yellow = (hsv[..., 0] > 10) & (hsv[..., 0] < 40) & (hsv[..., 1] > 90) & (hsv[..., 2] > 120)
mask[(band == 1) & yellow] = 255
# 1P 배지
mask[152:212, 62:146] = 255
# 카드 테두리 전체 띠를 마스크 → 주변 남색 배경으로 인페인트 (테두리는 CSS가 다시 그림)
ring = np.zeros_like(mask); ring[y0:y1, x0:x1] = 255; ring[176:402, 90:334] = 0
mask = cv2.dilate(mask, np.ones((5, 5), np.uint8)) | ring
out = cv2.inpaint(s, mask, 9, cv2.INPAINT_TELEA)
cv2.imwrite('public/ui/select_bg.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite('/tmp/ui/select_clean_crop.png', out[120:460, 30:700])
