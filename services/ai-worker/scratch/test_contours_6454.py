import cv2
import numpy as np

cap = cv2.VideoCapture(r"C:\Users\adiit\Desktop\lecture.mp4")
cap.set(cv2.CAP_PROP_POS_MSEC, 64540.0)
ret, frame = cap.read()
cap.release()

src_h, src_w = frame.shape[:2]
gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

# Face box at 64.54s: x=345, y=79, w=165, h=165
# Mask face
analysis_gray = gray.copy()
analysis_gray[79:79+165, 345:345+165] = 0

# Sobel
grad_x = cv2.Sobel(analysis_gray, cv2.CV_16S, 1, 0, ksize=3)
grad_y = cv2.Sobel(analysis_gray, cv2.CV_16S, 0, 1, ksize=3)
abs_grad_x = cv2.convertScaleAbs(grad_x)
abs_grad_y = cv2.convertScaleAbs(grad_y)
edge_map = cv2.addWeighted(abs_grad_x, 0.7, abs_grad_y, 0.3, 0)

kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
dilated_h = cv2.dilate(edge_map, kernel_h, iterations=1)
_, thresh = cv2.threshold(dilated_h, 35, 255, cv2.THRESH_BINARY)

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print(f"Total contours found: {len(contours)}")
frame_area = src_w * src_h
for i, cnt in enumerate(contours):
    x, y, w, h = cv2.boundingRect(cnt)
    area = w * h
    area_ratio = area / frame_area
    if area >= 2500:
        print(f"Contour #{i}: bbox=({x},{y},{w},{h}), area={area}, ratio={area_ratio:.4f}")
