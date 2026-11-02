"""새 캐릭터 선택 화면 원화: 제목/부제 글자를 지워(인페인트) 배경으로 사용. 패널·타일·버튼은 HTML로 다시 그린다."""
import cv2, numpy as np
s = cv2.imread('/mnt/user-data/uploads/6f39914c-image.png')
hsv = cv2.cvtColor(s, cv2.COLOR_BGR2HSV)
mask = np.zeros(s.shape[:2], np.uint8)
bright = (hsv[..., 2] > 110)
for (x0, y0, x1, y1) in [(578, 6, 1098, 74), (632, 78, 1040, 124)]:
    m = np.zeros_like(mask); m[y0:y1, x0:x1] = 1
    mask[(m == 1) & bright] = 255
mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
out = cv2.inpaint(s, mask, 9, cv2.INPAINT_TELEA)
cv2.imwrite('public/ui/select2_bg.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 90])
cv2.imwrite('/tmp/ui/sel2_top.png', out[0:140, 450:1250])
