import sys
sys.path.insert(0, ".")
import json
from app.services.video_renderer import AdaptiveCompositionClassifier
from app.schemas import CropKeyframeResult

cp = json.load(open(r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\crop_plans\lecture_crop_plan.json"))
kfs = [CropKeyframeResult(**k) for k in cp["keyframes"]]

classifier = AdaptiveCompositionClassifier(
    keyframes=kfs,
    source_width=854,
    source_height=480,
    video_path=r"C:\Users\adiit\Desktop\lecture.mp4",
    composition_mode="adaptive_hybrid"
)

for i, (kf, mode, scene_t) in enumerate(zip(kfs, classifier.keyframe_modes, classifier.keyframe_scene_types)):
    st = kf.timestamp_abs_sec
    rt = kf.timestamp_rel_sec
    if 33.0 <= st <= 39.0:
        print(f"KF #{i} (R:{rt:.2f}s, S:{st:.2f}s): mode={mode}, scene_type={scene_t.value}, cut={kf.scene_change_detected}")

print("\nSampling classifier.get_composition_state around 7.5s - 8.5s:")
for t in [7.0, 7.5, 7.8, 8.0, 8.2, 8.5, 8.8, 9.0]:
    m, a = classifier.get_composition_state(t)
    print(f"  t={t:.2f}s: mode={m}, alpha={a:.3f}")
