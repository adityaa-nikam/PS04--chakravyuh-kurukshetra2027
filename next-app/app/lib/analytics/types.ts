export interface InstagramReelDetails {
  id: string;
  caption: string;
  media_type: string;
  media_url?: string;
  permalink: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface InstagramReelInsights {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  total_interactions: number;
  avg_watch_time_ms: number;
  total_watch_time_ms: number;
  supported_metrics: string[];
  unsupported_metrics: string[];
  raw_metrics?: Record<string, unknown>;
}

export interface AnalyticsSnapshot {
  id: string;
  job_id?: string | null;
  instagram_media_id: string;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  total_interactions: number;
  avg_watch_time_ms: number;
  total_watch_time_ms: number;
  avg_watch_time_sec: number;
  total_watch_time_sec: number;
  duration_sec?: number | null;
  snapshot_at: string;
  created_at: string;
  raw_metrics?: Record<string, unknown>;
}

export interface CalculatedRates {
  engagement_rate_by_reach: number;
  like_rate_by_reach: number;
  comment_rate_by_reach: number;
  save_rate_by_reach: number;
  share_rate_by_reach: number;
  watch_time_to_duration_ratio: number | null;
}

export interface ReelPerformanceInsight {
  id: string;
  type: "reach" | "engagement" | "saves" | "shares" | "watch_time" | "growth" | "benchmark";
  level: "positive" | "neutral" | "info";
  title: string;
  message: string;
  metric: string;
  value: string | number;
  benchmark?: string;
}

export interface MetricDeltas {
  delta_views: number;
  delta_reach: number;
  delta_interactions: number;
  delta_watch_time_sec: number;
  time_between_snapshots_hours: number;
}

export interface PublishedReelSummary {
  job_id: string;
  instagram_media_id: string;
  caption: string;
  video_key?: string;
  permalink: string;
  thumbnail_url?: string;
  published_at: string;
  last_synced_at: string | null;
  metrics: {
    views: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
    total_interactions: number;
    avg_watch_time_sec: number;
    total_watch_time_sec: number;
    engagement_rate_by_reach: number;
  };
  sync_status: "synced" | "pending" | "stale" | "error";
  sync_error?: string;
}
