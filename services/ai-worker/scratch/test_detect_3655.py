import cv2
import sys
sys.path.insert(0, ".")
from app.services.screen_content_detector import ScreenContentDetector

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
detector = ScreenContentDetector()

cap = cv2.VideoCapture(SOURCE_PATH)
cap.set(cv2.CAP_PROP_POS_MSEC, 36550.0)
ret, frame = cap.read()
cap.release()

if ret:
    res = detector.detect(frame, webcam_box=None)
    print("Frame 36.55s detection:")
    print(f"  Scene Type: {res.scene_type}")
    print(f"  Recommended mode: {res.recommended_mode}")
    print(f"  Has valid content: {res.has_valid_content}")
    print(f"  Candidates count: {len(res.candidates)}")
    for c in res.candidates:
        print(f"    Candidate: type={c.candidate_type}, score={c.heuristic_score:.2f}, bbox=({c.box_pixels.x},{c.box_pixels.y},{c.box_pixels.width},{c.box_pixels.height}), fits={c.fits_portrait_crop}")
    if res.best_candidate:
        b = res.best_candidate.box_pixels
        print(f"  Best candidate: type={res.best_candidate.candidate_type}, box=({b.x},{b.y},{b.width},{b.height}), fits={res.best_candidate.fits_portrait_crop}")
