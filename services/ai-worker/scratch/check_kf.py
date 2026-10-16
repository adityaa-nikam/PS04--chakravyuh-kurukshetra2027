import json

cp = json.load(open(r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\crop_plans\lecture_crop_plan.json"))
for kf in cp["keyframes"]:
    st = kf["timestamp_abs_sec"]
    if 28.5 <= st <= 35.0:
        print(f"KF t={st:.2f}s, rel={kf['timestamp_rel_sec']:.2f}s: mode={kf['tracking_mode']}, faces={kf['detected_faces_count']}, cut={kf['scene_change_detected']}, box={kf['crop_box_pixels']}")
