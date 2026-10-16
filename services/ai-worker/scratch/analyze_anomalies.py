import json

with open(r"C:\Users\adiit\PS04--chakravyuh-kurukshetra2027\storage\rendered\inspection\qc_gate\qc_report.json") as f:
    d = json.load(f)

anomalies = d.get("anomalies", [])
clusters = []
for a in anomalies:
    if not clusters or a["frame"] - clusters[-1][-1]["frame"] > 5:
        clusters.append([a])
    else:
        clusters[-1].append(a)

print(f"Total anomaly items in report: {len(anomalies)}")
print(f"Total anomaly clusters: {len(clusters)}")
for i, c in enumerate(clusters):
    types = set(t for x in c for t in x["anomalies"])
    f_start = c[0]["frame"]
    f_end = c[-1]["frame"]
    r_start = c[0]["render_t"]
    r_end = c[-1]["render_t"]
    s_start = c[0]["source_t"]
    s_end = c[-1]["source_t"]
    print(f"[{i+1}] Render {r_start:.2f}s -> {r_end:.2f}s (Source {s_start:.2f}s -> {s_end:.2f}s), frames {f_start}-{f_end} (count={len(c)}):")
    print(f"    Types: {types}")
    print(f"    Render: mu={c[0]['render_mu']}->{c[-1]['render_mu']}, std={c[0]['render_std']}->{c[-1]['render_std']}")
    print(f"    Source: mu={c[0]['source_mu']}->{c[-1]['source_mu']}, std={c[0]['source_std']}->{c[-1]['source_std']}")
