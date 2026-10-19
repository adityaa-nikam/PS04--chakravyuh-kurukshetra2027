import type {
  AnalyticsSnapshot,
  CalculatedRates,
  MetricDeltas,
  ReelPerformanceInsight,
} from "./types";

/**
 * Deterministically compute rates with safe division-by-zero guards
 */
export function calculateRates(
  snapshot: {
    views: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saved: number;
    total_interactions: number;
    avg_watch_time_sec?: number;
    avg_watch_time_ms?: number;
    duration_sec?: number | null;
  }
): CalculatedRates {
  const reach = Number(snapshot.reach) || 0;
  const likes = Number(snapshot.likes) || 0;
  const comments = Number(snapshot.comments) || 0;
  const shares = Number(snapshot.shares) || 0;
  const saved = Number(snapshot.saved) || 0;
  const totalInteractions = Number(snapshot.total_interactions) || 0;

  const engagementRate = reach > 0 ? Number(((totalInteractions / reach) * 100).toFixed(2)) : 0;
  const likeRate = reach > 0 ? Number(((likes / reach) * 100).toFixed(2)) : 0;
  const commentRate = reach > 0 ? Number(((comments / reach) * 100).toFixed(2)) : 0;
  const saveRate = reach > 0 ? Number(((saved / reach) * 100).toFixed(2)) : 0;
  const shareRate = reach > 0 ? Number(((shares / reach) * 100).toFixed(2)) : 0;

  const avgWatchSec =
    typeof snapshot.avg_watch_time_sec === "number"
      ? snapshot.avg_watch_time_sec
      : typeof snapshot.avg_watch_time_ms === "number"
      ? snapshot.avg_watch_time_ms / 1000
      : 0;

  const durationSec = snapshot.duration_sec && snapshot.duration_sec > 0 ? snapshot.duration_sec : null;
  const watchRatio =
    durationSec && durationSec > 0 && avgWatchSec > 0
      ? Number(((avgWatchSec / durationSec) * 100).toFixed(2))
      : null;

  return {
    engagement_rate_by_reach: engagementRate,
    like_rate_by_reach: likeRate,
    comment_rate_by_reach: commentRate,
    save_rate_by_reach: saveRate,
    share_rate_by_reach: shareRate,
    watch_time_to_duration_ratio: watchRatio,
  };
}

/**
 * Compute differences between the two most recent snapshots
 */
export function calculateDeltas(snapshots: AnalyticsSnapshot[]): MetricDeltas | null {
  if (!snapshots || snapshots.length < 2) return null;

  // Assumes snapshots are chronologically ordered ASC
  const prev = snapshots[snapshots.length - 2];
  const curr = snapshots[snapshots.length - 1];

  const prevTime = new Date(prev.snapshot_at).getTime();
  const currTime = new Date(curr.snapshot_at).getTime();
  const hours = Math.max(0.1, Number(((currTime - prevTime) / (1000 * 60 * 60)).toFixed(1)));

  return {
    delta_views: curr.views - prev.views,
    delta_reach: curr.reach - prev.reach,
    delta_interactions: curr.total_interactions - prev.total_interactions,
    delta_watch_time_sec: Number((curr.total_watch_time_sec - prev.total_watch_time_sec).toFixed(1)),
    time_between_snapshots_hours: hours,
  };
}

/**
 * Deterministic AI Performance Insights generator based on verified metrics,
 * historical snapshots, and collection benchmarking.
 */
export function generatePerformanceInsights(
  targetSnapshot: AnalyticsSnapshot,
  allReelsSnapshots: AnalyticsSnapshot[] = [],
  deltas: MetricDeltas | null = null
): ReelPerformanceInsight[] {
  const insights: ReelPerformanceInsight[] = [];
  const rates = calculateRates(targetSnapshot);

  // 1. Growth Velocity Insight (from multiple snapshots)
  if (deltas) {
    if (deltas.delta_views > 0 || deltas.delta_reach > 0) {
      insights.push({
        id: "growth-velocity",
        type: "growth",
        level: "positive",
        title: "Active Viewer Momentum",
        message: `Gained +${deltas.delta_views.toLocaleString()} views and +${deltas.delta_reach.toLocaleString()} reach over the last ${deltas.time_between_snapshots_hours} hours.`,
        metric: "Snapshot Delta",
        value: `+${deltas.delta_views} views`,
      });
    } else {
      insights.push({
        id: "stable-reach",
        type: "growth",
        level: "neutral",
        title: "Plateaued Velocity",
        message: `View count remained steady at ${targetSnapshot.views.toLocaleString()} across the last sampling window.`,
        metric: "Snapshot Delta",
        value: "0 new views",
      });
    }
  }

  // 2. Engagement Rate Insight
  if (targetSnapshot.reach > 0) {
    if (rates.engagement_rate_by_reach >= 5.0) {
      insights.push({
        id: "high-engagement",
        type: "engagement",
        level: "positive",
        title: "Above-Average Engagement Rate",
        message: `High engagement rate of ${rates.engagement_rate_by_reach}% (interactions per unique account reached). Viewers actively liked, saved, or commented.`,
        metric: "Interactions / Reach",
        value: `${rates.engagement_rate_by_reach}%`,
      });
    } else if (rates.engagement_rate_by_reach > 0) {
      insights.push({
        id: "standard-engagement",
        type: "engagement",
        level: "neutral",
        title: "Standard Engagement",
        message: `Recorded ${targetSnapshot.total_interactions} total interactions across ${targetSnapshot.reach} accounts (${rates.engagement_rate_by_reach}% interaction rate).`,
        metric: "Interactions / Reach",
        value: `${rates.engagement_rate_by_reach}%`,
      });
    }
  }

  // 3. Save & Share Intent (High-value signals)
  if (targetSnapshot.saved > 0 || targetSnapshot.shares > 0) {
    if (rates.save_rate_by_reach >= 2.0) {
      insights.push({
        id: "high-bookmark-rate",
        type: "saves",
        level: "positive",
        title: "High Educational Bookmark Value",
        message: `${targetSnapshot.saved} viewers saved this Reel (${rates.save_rate_by_reach}% of reached audience), signaling strong reference value.`,
        metric: "Saves / Reach",
        value: `${rates.save_rate_by_reach}%`,
      });
    }
    if (rates.share_rate_by_reach >= 2.0) {
      insights.push({
        id: "virality-distribution",
        type: "shares",
        level: "positive",
        title: "Organic Peer Sharing",
        message: `${targetSnapshot.shares} peer shares recorded (${rates.share_rate_by_reach}% share rate), driving organic non-follower reach.`,
        metric: "Shares / Reach",
        value: `${rates.share_rate_by_reach}%`,
      });
    }
  }

  // 4. Watch Time Insight
  if (targetSnapshot.avg_watch_time_sec > 0) {
    if (rates.watch_time_to_duration_ratio !== null) {
      const isHighRetention = rates.watch_time_to_duration_ratio >= 50;
      insights.push({
        id: "watch-duration-ratio",
        type: "watch_time",
        level: isHighRetention ? "positive" : "neutral",
        title: isHighRetention ? "Strong Video Completion Rate" : "Average Watch Time Recorded",
        message: `Average viewer watched for ${targetSnapshot.avg_watch_time_sec}s (${rates.watch_time_to_duration_ratio}% of full duration ${targetSnapshot.duration_sec}s).`,
        metric: "Avg Watch / Duration",
        value: `${rates.watch_time_to_duration_ratio}%`,
      });
    } else {
      insights.push({
        id: "raw-watch-time",
        type: "watch_time",
        level: "info",
        title: "Average Watch Time Captured",
        message: `Average watch time is ${targetSnapshot.avg_watch_time_sec} seconds, accumulating ${(targetSnapshot.total_watch_time_sec / 60).toFixed(1)} minutes of total viewing time.`,
        metric: "Avg Watch Time",
        value: `${targetSnapshot.avg_watch_time_sec}s`,
      });
    }
  }

  // 5. Benchmark against other published Reels in collection
  if (allReelsSnapshots.length >= 2) {
    const maxReach = Math.max(...allReelsSnapshots.map((s) => s.reach));
    if (targetSnapshot.reach === maxReach && maxReach > 0) {
      insights.push({
        id: "top-reach-reel",
        type: "benchmark",
        level: "positive",
        title: "Top Performer by Reach",
        message: `This Reel currently holds the highest reach (${targetSnapshot.reach.toLocaleString()} unique accounts) among your published Astra Studio library.`,
        metric: "Account Reach",
        value: `#1 (${targetSnapshot.reach} accounts)`,
      });
    }
  }

  // Baseline prompt if only 1 snapshot and no interactions yet
  if (insights.length === 0) {
    insights.push({
      id: "baseline-snapshot",
      type: "growth",
      level: "info",
      title: "Baseline Metrics Initialized",
      message: `Initial telemetry established for this Reel (${targetSnapshot.views} views, ${targetSnapshot.reach} reach). Subsequent syncs will measure audience acceleration.`,
      metric: "Status",
      value: "Telemetry active",
    });
  }

  return insights;
}
