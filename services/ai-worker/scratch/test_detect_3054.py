import os
import cv2
import json
from app.services.screen_content_detector import ScreenContentDetector

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
detector = ScreenContentDetector()

cap = cv2.VideoCapture(SOURCE_PATH)
cap.set(cv2.CAP_PROP_POS_MSEC, 30540.0)
ret, frame = cap.read()
cap.release()

if ret:
    res = detector.detect(frame, webcam_box=(466, 87, 208, 208))
    print(f"Frame 30.54s detection:")
    print(f"  Scene Type: {res.scene_type}")
    print(f"  Candidates count: {len(res.all_candidates)}")
    print(f"  Has valid content: {res.has_valid_content}")
    for c in res.all_candidates:
        print(f"    Candidate: type={c.candidate_type}, score={c.heuristic_score:.2f}, bbox=({c.x},{c.y},{c.width},{c.height}), fits={c.fits_portrait_crop}")
