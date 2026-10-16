import sys
sys.path.insert(0, ".")
import cv2
import numpy as np
from app.services.screen_content_detector import ScreenContentDetector

detector = ScreenContentDetector()

# Test 1: Frame 36.04s ("BIG O - Speed - Efficiency")
cap = cv2.VideoCapture(r"C:\Users\adiit\Desktop\lecture.mp4")
cap.set(cv2.CAP_PROP_POS_MSEC, 36040.0)
ret, f_36 = cap.read()
cap.release()

if ret:
    res = detector.detect(f_36)
    print("Frame 36.04s:")
    print("  Initial recommended mode:", res.recommended_mode)
    valid_cands = [c for c in res.candidates if c.heuristic_score >= 0.35]
    if valid_cands:
        x1 = min(c.box_pixels.x for c in valid_cands)
        x2 = max(c.box_pixels.x + c.box_pixels.width for c in valid_cands)
        total_span = x2 - x1
        max_crop_w = int(round(480 * (9/16) * 1.15))
        print(f"  Valid candidates: {len(valid_cands)}, total_span: {total_span}px (max allowed: {max_crop_w}px)")
        print(f"  Should be presentation mode: {total_span > max_crop_w}")

# Test 2: Frame 30.54s (Data structures graphic slide with false face box)
cap = cv2.VideoCapture(r"C:\Users\adiit\Desktop\lecture.mp4")
cap.set(cv2.CAP_PROP_POS_MSEC, 30540.0)
ret, f_30 = cap.read()
cap.release()

if ret:
    fx, fy, fw, fh = 466, 87, 208, 208
    roi = f_30[fy:fy+fh, fx:fx+fw]
    ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
    skin_pct = (np.count_nonzero(skin_mask) / (fw * fh)) * 100.0
    print("\nFrame 30.54s:")
    print(f"  Face box skin percentage: {skin_pct:.2f}% (should be rejected if < 8.0%)")
