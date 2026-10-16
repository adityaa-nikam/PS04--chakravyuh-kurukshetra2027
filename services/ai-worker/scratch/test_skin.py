import cv2
import numpy as np

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
cap = cv2.VideoCapture(SOURCE_PATH)
cap.set(cv2.CAP_PROP_POS_MSEC, 30540.0)
ret, frame = cap.read()
cap.release()

if ret:
    # False face box
    fx, fy, fw, fh = 466, 87, 208, 208
    crop = frame[fy:fy+fh, fx:fx+fw]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    ycrcb = cv2.cvtColor(crop, cv2.COLOR_BGR2YCrCb)

    # Standard skin tone mask in YCrCb: Cr in [133, 173], Cb in [77, 127]
    skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
    skin_pct = (np.count_nonzero(skin_mask) / (fw * fh)) * 100.0

    print(f"False face box skin percentage: {skin_pct:.2f}%")
    print(f"Mean BGR in box: {np.mean(crop, axis=(0,1))}")

    # Now let's test real presenter face at 28.54s
    cap = cv2.VideoCapture(SOURCE_PATH)
    cap.set(cv2.CAP_PROP_POS_MSEC, 28540.0)
    ret2, frame2 = cap.read()
    cap.release()
    if ret2:
        fx2, fy2, fw2, fh2 = 360, 87, 171, 171
        crop2 = frame2[fy2:fy2+fh2, fx2:fx2+fw2]
        ycrcb2 = cv2.cvtColor(crop2, cv2.COLOR_BGR2YCrCb)
        skin_mask2 = cv2.inRange(ycrcb2, np.array([0, 133, 77]), np.array([255, 173, 127]))
        skin_pct2 = (np.count_nonzero(skin_mask2) / (fw2 * fh2)) * 100.0
        print(f"Real face box skin percentage at 28.54s: {skin_pct2:.2f}%")
        print(f"Mean BGR in real face box: {np.mean(crop2, axis=(0,1))}")
