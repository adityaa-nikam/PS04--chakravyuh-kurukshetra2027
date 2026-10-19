import type { InstagramReelDetails, InstagramReelInsights } from "./types";

const GRAPH_URL = "https://graph.instagram.com";

function getAccessToken(): string {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Missing INSTAGRAM_ACCESS_TOKEN in environment variables.");
  }
  return token;
}

/**
 * Fetch Instagram Media details (caption, permalink, thumbnail_url, timestamp, counts)
 */
export async function fetchInstagramMedia(mediaId: string): Promise<InstagramReelDetails> {
  const token = getAccessToken();
  const url = new URL(`${GRAPH_URL}/${mediaId}`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count"
  );
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || `Instagram API request failed with status ${response.status}`;
    const errorCode = data.error?.code;
    const errorSubcode = data.error?.error_subcode;
    
    // Provide clean diagnostic messaging without leaking token
    if (errorCode === 190) {
      throw new Error(`Instagram access token expired or revoked (Code 190). Please refresh your credentials.`);
    }
    if (errorCode === 4 || errorCode === 17 || errorCode === 32 || errorCode === 613) {
      throw new Error(`Instagram Graph API rate limit reached (Code ${errorCode}). Please try again later.`);
    }
    throw new Error(`Failed to fetch media details for ${mediaId}: ${errorMsg} (Code: ${errorCode || "UNKNOWN"}${errorSubcode ? `/${errorSubcode}` : ""})`);
  }

  return {
    id: data.id,
    caption: data.caption || "",
    media_type: data.media_type || "VIDEO",
    media_url: data.media_url,
    permalink: data.permalink || `https://www.instagram.com/reel/${mediaId}/`,
    thumbnail_url: data.thumbnail_url || data.media_url,
    timestamp: data.timestamp || new Date().toISOString(),
    like_count: typeof data.like_count === "number" ? data.like_count : undefined,
    comments_count: typeof data.comments_count === "number" ? data.comments_count : undefined,
  };
}

/**
 * Helper to execute an insights request for a given comma-separated list of metrics
 */
async function queryInsightsMetrics(
  mediaId: string,
  metrics: string[],
  token: string
): Promise<{ data?: Array<{ name: string; values?: Array<{ value: number }> }>; error?: { message: string; code?: number } }> {
  const url = new URL(`${GRAPH_URL}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return await response.json();
}

/**
 * Fetch Instagram Insights for a Reel.
 * Uses official media-level metrics:
 * - views, reach, likes, comments, shares, saved, total_interactions
 * - ig_reels_avg_watch_time, ig_reels_video_view_total_time
 *
 * Implements fallback queries if a subset of metrics is rejected by the API.
 */
export async function fetchInstagramInsights(mediaId: string): Promise<InstagramReelInsights> {
  const token = getAccessToken();

  const standardMetrics = [
    "views",
    "reach",
    "likes",
    "comments",
    "shares",
    "saved",
    "total_interactions",
  ];
  const watchTimeMetrics = [
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
  ];

  const allMetrics = [...standardMetrics, ...watchTimeMetrics];
  const supported: string[] = [];
  const unsupported: string[] = [];
  const valuesMap: Record<string, number> = {};
  const rawData: Record<string, unknown> = {};

  // First try the unified batch query
  let result = await queryInsightsMetrics(mediaId, allMetrics, token);

  // If the batch failed (e.g., metric parameter error for older media type), fall back to querying separately
  if (result.error || !result.data) {
    // Try standard metrics first
    const stdResult = await queryInsightsMetrics(mediaId, standardMetrics, token);
    if (stdResult.data) {
      for (const item of stdResult.data) {
        const val = item.values?.[0]?.value ?? 0;
        valuesMap[item.name] = val;
        supported.push(item.name);
        rawData[item.name] = val;
      }
    } else {
      // Standard metrics also threw an error, check rate limit or token
      const errorCode = stdResult.error?.code;
      if (errorCode === 190) {
        throw new Error("Instagram access token has expired. Please refresh your credentials.");
      }
      if (errorCode === 4 || errorCode === 17 || errorCode === 32 || errorCode === 613) {
        throw new Error("Instagram Graph API rate limit reached. Please wait a few minutes.");
      }
      throw new Error(`Failed to query standard metrics: ${stdResult.error?.message || "Unknown error"}`);
    }

    // Try watch time metrics separately
    try {
      const wtResult = await queryInsightsMetrics(mediaId, watchTimeMetrics, token);
      if (wtResult.data) {
        for (const item of wtResult.data) {
          const val = item.values?.[0]?.value ?? 0;
          valuesMap[item.name] = val;
          supported.push(item.name);
          rawData[item.name] = val;
        }
      } else {
        unsupported.push(...watchTimeMetrics);
      }
    } catch {
      unsupported.push(...watchTimeMetrics);
    }
  } else {
    // Unified query succeeded
    for (const item of result.data) {
      const val = item.values?.[0]?.value ?? 0;
      valuesMap[item.name] = val;
      supported.push(item.name);
      rawData[item.name] = val;
    }

    // Check which ones were missing
    for (const metric of allMetrics) {
      if (!(metric in valuesMap)) {
        unsupported.push(metric);
      }
    }
  }

  return {
    views: valuesMap["views"] ?? 0,
    reach: valuesMap["reach"] ?? 0,
    likes: valuesMap["likes"] ?? 0,
    comments: valuesMap["comments"] ?? 0,
    shares: valuesMap["shares"] ?? 0,
    saved: valuesMap["saved"] ?? 0,
    total_interactions: valuesMap["total_interactions"] ?? 0,
    avg_watch_time_ms: valuesMap["ig_reels_avg_watch_time"] ?? 0,
    total_watch_time_ms: valuesMap["ig_reels_video_view_total_time"] ?? 0,
    supported_metrics: supported,
    unsupported_metrics: unsupported,
    raw_metrics: rawData,
  };
}
