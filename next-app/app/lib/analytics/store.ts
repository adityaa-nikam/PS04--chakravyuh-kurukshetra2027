import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import type { AnalyticsSnapshot, InstagramReelInsights } from "./types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const LOCAL_STORAGE_PATH = path.join(process.cwd(), "storage", "analytics_snapshots.json");

// Throttle snapshots within 5 minutes unless force-synced
const SNAPSHOT_COOLDOWN_MS = 5 * 60 * 1000;

interface LocalSnapshotStore {
  snapshots: AnalyticsSnapshot[];
}

async function readLocalStore(): Promise<LocalSnapshotStore> {
  try {
    const raw = await fs.readFile(LOCAL_STORAGE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { snapshots: [] };
  }
}

async function writeLocalStore(store: LocalSnapshotStore): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORAGE_PATH), { recursive: true });
    await fs.writeFile(LOCAL_STORAGE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write local analytics store:", err);
  }
}

export interface PublishedJobRecord {
  id: string;
  video_key: string;
  caption: string;
  instagram_media_id: string;
  publish_status: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Fetch all published jobs from Supabase that have an Instagram media ID
 */
export async function getPublishedReelJobs(): Promise<PublishedJobRecord[]> {
  try {
    const { data, error } = await supabase
      .from("publishing_jobs")
      .select("id, video_key, caption, instagram_media_id, publish_status, created_at, updated_at")
      .not("instagram_media_id", "is", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Supabase fetch published jobs error:", error.message);
      return [];
    }

    return (data || []) as PublishedJobRecord[];
  } catch (err) {
    console.error("Unexpected error fetching publishing jobs:", err);
    return [];
  }
}

/**
 * Find a specific published job by its Instagram media ID
 */
export async function getPublishedJobByMediaId(mediaId: string): Promise<PublishedJobRecord | null> {
  try {
    const { data, error } = await supabase
      .from("publishing_jobs")
      .select("id, video_key, caption, instagram_media_id, publish_status, created_at, updated_at")
      .eq("instagram_media_id", mediaId)
      .maybeSingle();

    if (error) {
      console.warn("Error finding publishing job by media ID:", error.message);
      return null;
    }

    return data as PublishedJobRecord | null;
  } catch {
    return null;
  }
}

/**
 * Get all historical snapshots for an Instagram Reel
 */
export async function getSnapshotsForMedia(mediaId: string): Promise<AnalyticsSnapshot[]> {
  try {
    const { data, error } = await supabase
      .from("analytics_snapshots")
      .select("*")
      .eq("instagram_media_id", mediaId)
      .order("snapshot_at", { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map(mapDbRowToSnapshot);
    }
  } catch {
    // Fall back to local file storage if table is unmigrated or Supabase is unavailable
  }

  // Fallback to local store
  const local = await readLocalStore();
  const filtered = local.snapshots
    .filter((s) => s.instagram_media_id === mediaId)
    .sort((a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime());

  return filtered;
}

/**
 * Get the latest recorded snapshot for a Reel
 */
export async function getLatestSnapshot(mediaId: string): Promise<AnalyticsSnapshot | null> {
  const snapshots = await getSnapshotsForMedia(mediaId);
  if (!snapshots.length) return null;
  return snapshots[snapshots.length - 1];
}

/**
 * Record a new analytics snapshot with deduplication throttle
 */
export async function recordSnapshot({
  jobId,
  mediaId,
  insights,
  durationSec,
  force = false,
}: {
  jobId?: string | null;
  mediaId: string;
  insights: InstagramReelInsights;
  durationSec?: number | null;
  force?: boolean;
}): Promise<{ snapshot: AnalyticsSnapshot; isNew: boolean }> {
  // Check latest snapshot for deduplication
  const latest = await getLatestSnapshot(mediaId);
  const now = new Date();

  if (latest && !force) {
    const lastTime = new Date(latest.snapshot_at).getTime();
    if (now.getTime() - lastTime < SNAPSHOT_COOLDOWN_MS) {
      return { snapshot: latest, isNew: false };
    }
  }

  const avgWatchSec = Number((insights.avg_watch_time_ms / 1000).toFixed(2));
  const totalWatchSec = Number((insights.total_watch_time_ms / 1000).toFixed(2));
  const snapshotTimestamp = now.toISOString();

  const newSnapshot: AnalyticsSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    job_id: jobId || null,
    instagram_media_id: mediaId,
    views: insights.views,
    reach: insights.reach,
    likes: insights.likes,
    comments: insights.comments,
    shares: insights.shares,
    saved: insights.saved,
    total_interactions: insights.total_interactions,
    avg_watch_time_ms: insights.avg_watch_time_ms,
    total_watch_time_ms: insights.total_watch_time_ms,
    avg_watch_time_sec: avgWatchSec,
    total_watch_time_sec: totalWatchSec,
    duration_sec: durationSec || null,
    snapshot_at: snapshotTimestamp,
    created_at: snapshotTimestamp,
    raw_metrics: insights.raw_metrics || {},
  };

  // Attempt to persist to Supabase
  let savedToDb = false;
  try {
    const { data, error } = await supabase
      .from("analytics_snapshots")
      .insert({
        job_id: newSnapshot.job_id,
        instagram_media_id: newSnapshot.instagram_media_id,
        views: newSnapshot.views,
        reach: newSnapshot.reach,
        likes: newSnapshot.likes,
        comments: newSnapshot.comments,
        shares: newSnapshot.shares,
        saved: newSnapshot.saved,
        total_interactions: newSnapshot.total_interactions,
        avg_watch_time_ms: newSnapshot.avg_watch_time_ms,
        total_watch_time_ms: newSnapshot.total_watch_time_ms,
        duration_sec: newSnapshot.duration_sec,
        raw_metrics: newSnapshot.raw_metrics,
        snapshot_at: newSnapshot.snapshot_at,
      })
      .select()
      .single();

    if (!error && data) {
      savedToDb = true;
      newSnapshot.id = data.id;
    }
  } catch {
    // If Supabase table isn't migrated, fallback seamlessly
  }

  // Always keep local store updated as resilient local cache
  const store = await readLocalStore();
  store.snapshots.push(newSnapshot);
  // Keep last 1000 snapshots to avoid unbound growth
  if (store.snapshots.length > 1000) {
    store.snapshots = store.snapshots.slice(-1000);
  }
  await writeLocalStore(store);

  return { snapshot: newSnapshot, isNew: true };
}

function mapDbRowToSnapshot(row: Record<string, any>): AnalyticsSnapshot {
  const avgMs = row.avg_watch_time_ms || 0;
  const totalMs = row.total_watch_time_ms || 0;
  return {
    id: String(row.id),
    job_id: row.job_id || null,
    instagram_media_id: String(row.instagram_media_id),
    views: Number(row.views || 0),
    reach: Number(row.reach || 0),
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    shares: Number(row.shares || 0),
    saved: Number(row.saved || 0),
    total_interactions: Number(row.total_interactions || 0),
    avg_watch_time_ms: avgMs,
    total_watch_time_ms: totalMs,
    avg_watch_time_sec: Number((avgMs / 1000).toFixed(2)),
    total_watch_time_sec: Number((totalMs / 1000).toFixed(2)),
    duration_sec: row.duration_sec ? Number(row.duration_sec) : null,
    snapshot_at: row.snapshot_at || row.created_at || new Date().toISOString(),
    created_at: row.created_at || new Date().toISOString(),
    raw_metrics: row.raw_metrics || {},
  };
}
