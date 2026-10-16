import os
import cv2
import numpy as np

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
RENDER_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\lecture_reel.mp4"
OUT_DIR = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\inspection\qc_gate\cluster2_investigation"
os.makedirs(OUT_DIR, exist_ok=True)

src_cap = cv2.VideoCapture(SOURCE_PATH)
ren_cap = cv2.VideoCapture(RENDER_PATH)

# Highlight starts at 28.54
# Source times to sample: 30.5, 31.0, 31.5, 31.7, 32.0, 32.5, 33.0, 33.5
source_times = [30.5, 31.0, 31.5, 31.7, 32.0, 32.5, 33.0, 33.5]

for st in source_times:
    rt = st - 28.54
    # Source
    src_cap.set(cv2.CAP_PROP_POS_MSEC, st * 1000.0)
    ret_s, f_s = src_cap.read()

    # Render
    ren_cap.set(cv2.CAP_PROP_POS_MSEC, rt * 1000.0)
    ret_r, f_r = ren_cap.read()

    if ret_s and ret_r:
        s_gray = cv2.cvtColor(f_s, cv2.COLOR_BGR2GRAY)
        r_gray = cv2.cvtColor(f_r, cv2.COLOR_BGR2GRAY)
        print(f"Time: S={st:.2f}s, R={rt:.2f}s | Source: mu={np.mean(s_gray):.2f}, std={np.std(s_gray):.2f} | Render: mu={np.mean(r_gray):.2f}, std={np.std(r_gray):.2f}")

        # Save individual frames
        cv2.imwrite(os.path.join(OUT_DIR, f"src_{st:.2f}.jpg"), f_s)
        cv2.imwrite(os.path.join(OUT_DIR, f"ren_{rt:.2f}.jpg"), f_r)

src_cap.release()
ren_cap.release()
print("Done extracting cluster 2 frames.")
