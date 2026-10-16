"""
Comprehensive Full-Video Quality Control & Release Gate Script
Performs full frame-by-frame analysis, audio sync correlation, anomaly detection,
and generates annotated contact sheets.
"""

import os
import sys
import json
import subprocess
import cv2
import numpy as np

SOURCE_PATH = r"C:\Users\adiit\Desktop\lecture.mp4"
RENDER_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\lecture_reel.mp4"
MANIFEST_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\lecture_reel_render_manifest.json"
HIGHLIGHT_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\highlights\lecture_highlight.json"
CROP_PLAN_PATH = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\crop_plans\lecture_crop_plan.json"
OUTPUT_DIR = r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\inspection\qc_gate"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def probe_file(filepath):
    cmd = [
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-print_format", "json", filepath
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(res.stdout)

def main():
    print("=" * 70)
    print("PS04 REEL STUDIO - FULL VIDEO QC & RELEASE GATE AUDIT")
    print("=" * 70)

    # 1. Probing Files
    print("\n[Step 1] Probing Metadata...")
    src_probe = probe_file(SOURCE_PATH)
    ren_probe = probe_file(RENDER_PATH)

    src_v = next(s for s in src_probe["streams"] if s["codec_type"] == "video")
    src_a = next(s for s in src_probe["streams"] if s["codec_type"] == "audio")
    ren_v = next(s for s in ren_probe["streams"] if s["codec_type"] == "video")
    ren_a = next(s for s in ren_probe["streams"] if s["codec_type"] == "audio")

    with open(HIGHLIGHT_PATH, "r") as f:
        highlight = json.load(f)
    with open(MANIFEST_PATH, "r") as f:
        manifest = json.load(f)

    start_sec = highlight["start_sec"]
    end_sec = highlight["end_sec"]
    expected_duration = end_sec - start_sec
    ren_duration = float(ren_probe["format"]["duration"])
    ren_nb_frames = int(ren_v.get("nb_frames", 0))
    fps_eval = eval(ren_v["r_frame_rate"])

    print(f"Source: {src_v['width']}x{src_v['height']} @ {eval(src_v['r_frame_rate']):.2f} fps, audio {src_a['sample_rate']}Hz {src_a.get('channel_layout', 'stereo')}")
    print(f"Render: {ren_v['width']}x{ren_v['height']} @ {fps_eval:.2f} fps, audio {ren_a['sample_rate']}Hz {ren_a.get('channel_layout', 'stereo')}")
    print(f"Highlight window: {start_sec:.2f}s -> {end_sec:.2f}s (duration {expected_duration:.2f}s)")
    print(f"Render duration: {ren_duration:.3f}s, nb_frames: {ren_nb_frames}")

    # 2. Frame-by-Frame QC Analysis
    print("\n[Step 2] Full Frame-by-Frame Video Stream Audit...")
    cap = cv2.VideoCapture(RENDER_PATH)
    actual_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"OpenCV cap: {w}x{h}, {actual_frames} frames @ {fps:.4f} fps")

    prev_gray = None
    frame_metrics = []
    anomalies = []
    freeze_spans = []
    current_freeze_len = 0

    # Also open source video for side-by-side verification
    src_cap = cv2.VideoCapture(SOURCE_PATH)

    timeline_samples = []  # for contact sheet 1 (sampled every 1.0s)
    sample_interval = int(round(fps))

    for idx in range(actual_frames):
        ret, frame = cap.read()
        if not ret:
            print(f"WARNING: Early EOF at frame {idx}")
            break

        render_t = idx / fps
        source_t = start_sec + render_t

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        mu = float(np.mean(gray))
        std = float(np.std(gray))
        min_val = int(np.min(gray))
        max_val = int(np.max(gray))

        frame_diff = 0.0
        if prev_gray is not None:
            diff = np.abs(gray.astype(np.float32) - prev_gray.astype(np.float32))
            frame_diff = float(np.mean(diff))

            if frame_diff < 0.1:  # strictly identical frame
                current_freeze_len += 1
            else:
                if current_freeze_len >= 15:  # >= 0.5s freeze
                    freeze_spans.append({
                        "start_frame": idx - current_freeze_len,
                        "end_frame": idx - 1,
                        "length_frames": current_freeze_len,
                        "duration_sec": current_freeze_len / fps,
                        "render_t": (idx - current_freeze_len) / fps
                    })
                current_freeze_len = 0

        # Anomaly checks
        anomaly_types = []
        if mu < 10.0:
            anomaly_types.append("near_black")
        if mu > 240.0:
            anomaly_types.append("near_white")
        if std < 8.0:
            anomaly_types.append("flat_blank")
        if frame_diff > 40.0:
            anomaly_types.append("abrupt_cut")

        # Check source at same timestamp to see if source is also anomalous
        if anomaly_types:
            src_cap.set(cv2.CAP_PROP_POS_MSEC, source_t * 1000.0)
            s_ret, s_frame = src_cap.read()
            s_mu, s_std = (0.0, 0.0)
            if s_ret:
                s_gray = cv2.cvtColor(s_frame, cv2.COLOR_BGR2GRAY)
                s_mu = float(np.mean(s_gray))
                s_std = float(np.std(s_gray))

            anomalies.append({
                "frame": idx,
                "render_t": round(render_t, 3),
                "source_t": round(source_t, 3),
                "anomalies": anomaly_types,
                "render_mu": round(mu, 2),
                "render_std": round(std, 2),
                "source_mu": round(s_mu, 2),
                "source_std": round(s_std, 2),
                "diff": round(frame_diff, 2)
            })

        frame_metrics.append({
            "frame": idx,
            "render_t": render_t,
            "source_t": source_t,
            "mu": mu,
            "std": std,
            "diff": frame_diff
        })

        if idx % sample_interval == 0:
            timeline_samples.append((idx, render_t, source_t, frame.copy()))

        prev_gray = gray

    cap.release()

    if current_freeze_len >= 15:
        freeze_spans.append({
            "start_frame": actual_frames - current_freeze_len,
            "end_frame": actual_frames - 1,
            "length_frames": current_freeze_len,
            "duration_sec": current_freeze_len / fps,
            "render_t": (actual_frames - current_freeze_len) / fps
        })

    print(f"Total frames audited: {len(frame_metrics)}")
    print(f"Detected anomalies count: {len(anomalies)}")
    print(f"Detected freeze spans (>=15 frames / 0.5s): {len(freeze_spans)}")
    for fz in freeze_spans:
        print(f"  Freeze: frame {fz['start_frame']}->{fz['end_frame']} ({fz['duration_sec']:.2f}s) at t={fz['render_t']:.2f}s")

    # 3. Generating Contact Sheet 1: Timeline Overview (1 frame per sec)
    print("\n[Step 3] Generating Timeline Overview Contact Sheet...")
    # e.g. 46 frames: arrange in 6 cols x 8 rows
    num_samples = len(timeline_samples)
    cols = 6
    rows = int(np.ceil(num_samples / cols))
    thumb_w = 240
    thumb_h = int(thumb_w * 16 / 9)  # 426
    grid = np.zeros((rows * thumb_h, cols * thumb_w, 3), dtype=np.uint8)

    for i, (f_idx, r_t, s_t, frm) in enumerate(timeline_samples):
        r = i // cols
        c = i % cols
        resized = cv2.resize(frm, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)

        # Draw overlay text
        cv2.rectangle(resized, (0, 0), (thumb_w, 40), (0, 0, 0), -1)
        txt1 = f"#{f_idx} R:{r_t:.1f}s"
        txt2 = f"S:{s_t:.1f}s"
        cv2.putText(resized, txt1, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
        cv2.putText(resized, txt2, (5, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        grid[r*thumb_h:(r+1)*thumb_h, c*thumb_w:(c+1)*thumb_w] = resized

    contact_sheet_path = os.path.join(OUTPUT_DIR, "contact_sheet_timeline_overview.jpg")
    cv2.imwrite(contact_sheet_path, grid)
    print(f"Saved: {contact_sheet_path}")

    # 4. Dense Sampling Around All Transitions
    print("\n[Step 4] Generating Dense Transition Contact Sheets...")
    transitions = manifest.get("frame_diagnostics_sample", [])
    cut_transitions = [t for t in transitions if t.get("scene_cut_detected") or t.get("dominant_mode") != "presenter"]
    print(f"Sampled diagnostics points in manifest: {len(transitions)}")

    # We will sample 12 specific key moments across the video:
    # 0.0s, 3.0s, 8.0s, 12.3s (defect point 1), 16.0s, 20.0s, 24.2s (defect point 2), 28.0s, 32.0s, 36.0s, 40.3s (defect point 3), 44.0s
    key_timestamps = [0.0, 3.0, 8.0, 12.3, 16.0, 20.0, 24.2, 28.0, 32.0, 36.0, 40.3, 44.0]
    side_by_side_rows = []

    cap = cv2.VideoCapture(RENDER_PATH)
    for kt in key_timestamps:
        r_frame_idx = int(round(kt * fps))
        if r_frame_idx >= actual_frames:
            r_frame_idx = actual_frames - 1
        cap.set(cv2.CAP_PROP_POS_FRAMES, r_frame_idx)
        ret, r_frm = cap.read()
        if not ret:
            continue

        s_time = start_sec + (r_frame_idx / fps)
        src_cap.set(cv2.CAP_PROP_POS_MSEC, s_time * 1000.0)
        s_ret, s_frm = src_cap.read()
        if not s_ret:
            continue

        # Resize source to fixed width e.g. 480x270
        s_disp = cv2.resize(s_frm, (480, 270))
        # Resize render to height 270 (width ~ 152)
        r_disp = cv2.resize(r_frm, (152, 270))

        # Composite side-by-side row: [Source (480x270)] [Rendered (152x270)]
        row = np.hstack([s_disp, r_disp])
        cv2.putText(row, f"Source @ {s_time:.2f}s", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        cv2.putText(row, f"Render @ {kt:.2f}s", (490, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        side_by_side_rows.append(row)

    cap.release()
    src_cap.release()

    if side_by_side_rows:
        # Arrange in a multi-row grid (e.g. 6 rows per sheet)
        sheet1 = np.vstack(side_by_side_rows[:6])
        sheet2 = np.vstack(side_by_side_rows[6:])
        s1_path = os.path.join(OUTPUT_DIR, "side_by_side_keypoints_part1.jpg")
        s2_path = os.path.join(OUTPUT_DIR, "side_by_side_keypoints_part2.jpg")
        cv2.imwrite(s1_path, sheet1)
        cv2.imwrite(s2_path, sheet2)
        print(f"Saved: {s1_path} and {s2_path}")

    # 5. Audio Sync Analysis via Cross-Correlation
    print("\n[Step 5] Audio Presence & Cross-Correlation Synchronization Audit...")
    src_wav = os.path.join(OUTPUT_DIR, "src_clip.wav")
    ren_wav = os.path.join(OUTPUT_DIR, "ren_clip.wav")

    # Extract source audio exactly in [start_sec, end_sec]
    cmd_src_a = [
        "ffmpeg", "-y", "-ss", str(start_sec), "-t", str(expected_duration),
        "-i", SOURCE_PATH, "-vn", "-ac", "1", "-ar", "16000", src_wav
    ]
    subprocess.run(cmd_src_a, capture_output=True, check=True)

    # Extract render audio [0, expected_duration]
    cmd_ren_a = [
        "ffmpeg", "-y", "-i", RENDER_PATH, "-vn", "-ac", "1", "-ar", "16000", ren_wav
    ]
    subprocess.run(cmd_ren_a, capture_output=True, check=True)

    # Load WAVs and compute correlation
    import wave
    def load_wav(path):
        with wave.open(path, "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
            sr = wf.getframerate()
            return data, sr

    src_audio, sr_s = load_wav(src_wav)
    ren_audio, sr_r = load_wav(ren_wav)

    print(f"Source audio samples: {len(src_audio)} ({len(src_audio)/sr_s:.3f}s)")
    print(f"Render audio samples: {len(ren_audio)} ({len(ren_audio)/sr_r:.3f}s)")

    # Align lengths
    min_len = min(len(src_audio), len(ren_audio))
    s_sub = src_audio[:min_len]
    r_sub = ren_audio[:min_len]

    # Compute correlation over a +/- 1.0s search window (16000 samples)
    search_win = 16000
    mid = min_len // 2
    seg_len = 16000 * 5  # 5 second segment around middle
    s_seg = s_sub[mid - seg_len//2 : mid + seg_len//2]
    r_search = r_sub[mid - seg_len//2 - search_win : mid + seg_len//2 + search_win]

    corr = np.correlate(r_search, s_seg, mode="valid")
    best_offset = np.argmax(corr) - search_win
    delay_sec = best_offset / 16000.0

    # Volume / RMS check
    rms_s = np.sqrt(np.mean(s_sub**2))
    rms_r = np.sqrt(np.mean(r_sub**2))
    print(f"Source Audio RMS: {rms_s:.1f}, Render Audio RMS: {rms_r:.1f}")
    print(f"Audio Cross-Correlation Optimal Delay: {delay_sec * 1000.0:.2f} ms ({delay_sec:.4f} s)")

    # Clean up temp WAVs
    if os.path.exists(src_wav):
        os.remove(src_wav)
    if os.path.exists(ren_wav):
        os.remove(ren_wav)

    # 6. Summary Report JSON
    qc_report = {
        "source": {
            "path": SOURCE_PATH,
            "width": src_v["width"],
            "height": src_v["height"],
            "fps": float(eval(src_v["r_frame_rate"])),
            "duration": float(src_probe["format"]["duration"]),
            "audio_sr": int(src_a["sample_rate"])
        },
        "highlight": {
            "start_sec": start_sec,
            "end_sec": end_sec,
            "duration_sec": expected_duration
        },
        "render": {
            "path": RENDER_PATH,
            "width": ren_v["width"],
            "height": ren_v["height"],
            "fps": float(fps_eval),
            "duration": ren_duration,
            "nb_frames": actual_frames,
            "audio_sr": int(ren_a["sample_rate"])
        },
        "qc_metrics": {
            "total_frames_audited": len(frame_metrics),
            "anomalies_count": len(anomalies),
            "freeze_spans_count": len(freeze_spans),
            "audio_delay_ms": delay_sec * 1000.0,
            "audio_rms_source": float(rms_s),
            "audio_rms_render": float(rms_r)
        },
        "anomalies": anomalies[:50],  # sample first 50
        "freeze_spans": freeze_spans
    }

    report_path = os.path.join(OUTPUT_DIR, "qc_report.json")
    with open(report_path, "w") as f:
        json.dump(qc_report, f, indent=2)
    print(f"\nQC Audit Report saved to: {report_path}")

if __name__ == "__main__":
    main()
