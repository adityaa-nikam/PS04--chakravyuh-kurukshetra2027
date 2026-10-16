import json

with open(r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\lecture_reel_render_manifest.json") as f:
    mf = json.load(f)

for d in mf.get("frame_diagnostics_sample", []):
    f_idx = d["frame_index"]
    st = d["source_timestamp_sec"]
    rt = f_idx / 29.97
    if 33.0 <= st <= 38.0:
        print(f"Frame #{f_idx} (R:{rt:.2f}s, S:{st:.2f}s): mode={d['dominant_mode']}, alpha={d['alpha']:.2f}, cut={d['scene_cut_detected']}")
