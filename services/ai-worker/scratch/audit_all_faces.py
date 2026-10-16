import json
import cv2
import numpy as np

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
CROP_PLAN_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\crop_plans\lecture_crop_plan.json"

cap = cv2.VideoCapture(SOURCE_PATH)
with open(CROP_PLAN_PATH) as f:
    cp = json.load(f)

print(f"Total keyframes: {len(cp['keyframes'])}")
face_keyframes = []

for kf in cp["keyframes"]:
    if kf["detected_faces_count"] > 0 and kf["primary_face_box"]:
        t = kf["timestamp_abs_sec"]
        box = kf["primary_face_box"]
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ret, frame = cap.read()
        if ret:
            x, y, w, h = box["x"], box["y"], box["width"], box["height"]
            crop = frame[y:y+h, x:x+w]
            ycrcb = cv2.cvtColor(crop, cv2.COLOR_BGR2YCrCb)
            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            skin_pct = (np.count_nonzero(skin_mask) / (w * h)) * 100.0
            face_keyframes.append((t, box, skin_pct))

cap.release()

print(f"Keyframes with detected faces: {len(face_keyframes)}")
for t, box, skin_pct in face_keyframes:
    status = "REAL" if skin_pct >= 10.0 else "FALSE POSITIVE"
    print(f"t={t:.2f}s: skin={skin_pct:.1f}% -> {status} (box: {box['x']},{box['y']},{box['width']},{box['height']})")
