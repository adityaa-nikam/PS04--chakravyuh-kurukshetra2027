"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicJob } from "./api/jobs/contracts";

export default function Home() {
  const [token, setToken] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("Beginners");
  const [duration, setDuration] = useState(45);
  const [visualActions, setVisualActions] = useState(false);
  const [orientation, setOrientation] = useState("portrait");
  const [job, setJob] = useState<PublicJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState("");
  const [resumeId, setResumeId] = useState("");
  const videoRef = useRef("");
  const operation = useRef(false);
  const jobId = job?.id;
  const active = Boolean(job && !["failed", "completed"].includes(job.status));
  useEffect(() => () => { if (videoRef.current) URL.revokeObjectURL(videoRef.current); }, []);
  useEffect(() => {
    if (!jobId || !active || !token) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Could not read job status.");
        setJob(data); setError("");
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Connection failed. The laptop may still be working; keep the job ID."); }
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [jobId, active, token]); // Poll a stable job ID, not each status object.

  async function api(url: string, body?: unknown) {
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "The request failed.");
    return data as PublicJob;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (operation.current) return; operation.current = true; setBusy(true); setError("");
    try {
      if (videoRef.current) URL.revokeObjectURL(videoRef.current); videoRef.current = ""; setVideo("");
      const next = await api("/api/generate", { topic, targetAudience: audience, durationSeconds: duration, visualActions, orientation });
      setJob(next); setResumeId(next.id); localStorage.setItem("astra-last-job", next.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not submit the prompt."); }
    finally { operation.current = false; setBusy(false); }
  }
  async function recover(approveOverrun = false) {
    if (!job || operation.current) return; operation.current = true; setBusy(true); setError("");
    try { setJob(await api(`/api/jobs/${job.id}/resume`, { approveOverrun })); }
    catch (err) { setError(err instanceof Error ? err.message : "Resume failed."); }
    finally { operation.current = false; setBusy(false); }
  }
  async function loadJob() {
    setError("");
    const id = resumeId || localStorage.getItem("astra-last-job") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) { setError("Enter a valid saved job ID."); return; }
    try { if (videoRef.current) URL.revokeObjectURL(videoRef.current); videoRef.current = ""; setVideo(""); setJob(await api(`/api/jobs/${id}`)); setResumeId(id); }
    catch (err) { setError(err instanceof Error ? err.message : "Job not found."); }
  }
  async function loadVideo() {
    if (!job) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/jobs/${job.id}/video`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error?.message || "Video is unavailable."); }
      const blob = await response.blob();
      if (videoRef.current) URL.revokeObjectURL(videoRef.current);
      videoRef.current = URL.createObjectURL(blob); setVideo(videoRef.current);
    } catch (err) { setError(err instanceof Error ? err.message : "Download failed."); }
    finally { setBusy(false); }
  }
  const inputClass = "w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 focus:outline-2 focus:outline-cyan-600";
  const buttonClass = "rounded-lg bg-cyan-800 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
  return <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
    <div className="mx-auto max-w-3xl space-y-7">
      <header><p className="text-sm font-semibold uppercase tracking-widest text-cyan-800">Astra Studio</p><h1 className="mt-3 text-4xl font-bold">Turn an idea into a visual explainer</h1><p className="mt-3 text-slate-600">Your laptop generates and renders a silent video. Keep the server running while your job is in progress.</p></header>
      <label className="block space-y-2"><span className="font-medium">Laptop server access token</span><input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className={inputClass} placeholder="Provided by the server owner" /><span className="block text-sm text-slate-500">Kept in this tab only. This is not your model API key.</span></label>
      <form onSubmit={submit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block space-y-2"><span className="font-medium">What should the video explain?</span><textarea required minLength={1} maxLength={500} rows={4} value={topic} onChange={e => setTopic(e.target.value)} className={inputClass} placeholder="For example: Why do bridges vibrate?" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2"><span>Audience</span><input required maxLength={120} value={audience} onChange={e => setAudience(e.target.value)} className={inputClass} /></label><label className="space-y-2"><span>Target duration (seconds)</span><input type="number" required min={15} max={120} value={duration} onChange={e => setDuration(Number(e.target.value))} className={inputClass} /></label></div>
        <label className="block space-y-2"><span>Video format</span><select value={orientation} onChange={e => setOrientation(e.target.value)} className={inputClass}><option value="portrait">Portrait · 9:16</option><option value="landscape">Landscape · 16:9</option></select></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={visualActions} onChange={e => setVisualActions(e.target.checked)} /><span>Try experimental XML/JSON visual actions. Leave off for general topics.</span></label>
        <button className={buttonClass} disabled={!token || busy || active}>Generate video</button>
      </form>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <section aria-live="polite" className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Your job</h2>
        {job ? <><p className="break-all text-sm">ID: {job.id}</p><p className="font-semibold capitalize">{job.status.replaceAll("_", " ")}</p><p>{job.message}</p>
          {job.durationSeconds && <p>Estimated video length: {job.durationSeconds.toFixed(1)} seconds.</p>}
          {job.code && <p className="text-amber-800">{job.code === "DURATION_APPROVAL_REQUIRED" ? "The saved script exceeds the duration threshold. Read it below before explicitly approving the longer video." : `Stopped: ${job.code}. The server owner can inspect the local diagnostics.`}</p>}
          {job.script && <details><summary className="cursor-pointer font-medium">Review saved narration</summary><h3 className="mt-3 font-semibold">{job.script.title}</h3>{job.script.scenes.map((scene, i) => <p key={i} className="mt-3 whitespace-pre-wrap text-sm">{i + 1}. {scene.narration}</p>)}</details>}
          {job.status === "failed" && <button type="button" disabled={busy || !token} className={buttonClass} onClick={() => recover(job.code === "DURATION_APPROVAL_REQUIRED")}>{job.code === "DURATION_APPROVAL_REQUIRED" ? "Approve this saved script’s overrun and resume" : "Resume saved job"}</button>}
          {job.status === "completed" && !video && <button type="button" disabled={busy || !token} className={buttonClass} onClick={loadVideo}>Load preview and download</button>}
          {video && <><video controls playsInline src={video} className="mx-auto max-h-[640px] w-full rounded-lg bg-black" /><a className="inline-block font-semibold text-cyan-800 underline" download={`astra-${job.id}.mp4`} href={video}>Download MP4</a></>}
        </> : <p className="text-slate-600">Submit a prompt, or reopen a saved job below.</p>}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4"><input aria-label="Saved job ID" value={resumeId} onChange={e => setResumeId(e.target.value)} className={`${inputClass} flex-1`} placeholder="Saved job ID (or restore last job)" /><button type="button" onClick={loadJob} disabled={!token || busy} className={buttonClass}>Open job</button></div>
      </section>
      <p className="text-sm text-slate-500">Narration is preserved as metadata. Audio and captions are not included yet. Review generated explanations for accuracy.</p>
    </div>
  </main>;
}
