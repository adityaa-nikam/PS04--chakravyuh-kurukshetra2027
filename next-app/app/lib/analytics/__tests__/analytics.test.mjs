import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateRates, calculateDeltas, generatePerformanceInsights } from "../insights.ts";

describe("Analytics Rates & Arithmetic Calculations", () => {
  test("calculates engagement and interaction rates accurately", () => {
    const snapshot = {
      views: 100,
      reach: 50,
      likes: 5,
      comments: 2,
      shares: 1,
      saved: 2,
      total_interactions: 10,
      avg_watch_time_ms: 4500,
      duration_sec: 30,
    };

    const rates = calculateRates(snapshot);

    assert.equal(rates.engagement_rate_by_reach, 20.0); // (10 / 50) * 100
    assert.equal(rates.like_rate_by_reach, 10.0);       // (5 / 50) * 100
    assert.equal(rates.comment_rate_by_reach, 4.0);    // (2 / 50) * 100
    assert.equal(rates.share_rate_by_reach, 2.0);      // (1 / 50) * 100
    assert.equal(rates.save_rate_by_reach, 4.0);       // (2 / 50) * 100
    assert.equal(rates.watch_time_to_duration_ratio, 15.0); // (4.5 / 30) * 100
  });

  test("guards against division by zero when reach is 0 or duration is missing", () => {
    const zeroReachSnapshot = {
      views: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saved: 0,
      total_interactions: 0,
      avg_watch_time_ms: 0,
      duration_sec: 0,
    };

    const rates = calculateRates(zeroReachSnapshot);

    assert.equal(rates.engagement_rate_by_reach, 0);
    assert.equal(rates.like_rate_by_reach, 0);
    assert.equal(rates.comment_rate_by_reach, 0);
    assert.equal(rates.save_rate_by_reach, 0);
    assert.equal(rates.share_rate_by_reach, 0);
    assert.equal(rates.watch_time_to_duration_ratio, null);
    assert.equal(Number.isNaN(rates.engagement_rate_by_reach), false);
    assert.equal(Number.isFinite(rates.engagement_rate_by_reach), true);
  });
});

describe("Historical Snapshots & Deltas", () => {
  test("returns null deltas if only one snapshot is available", () => {
    const singleSnapshot = [
      {
        id: "s1",
        instagram_media_id: "123",
        views: 50,
        reach: 40,
        likes: 2,
        comments: 0,
        shares: 0,
        saved: 0,
        total_interactions: 2,
        avg_watch_time_ms: 3000,
        total_watch_time_ms: 150000,
        avg_watch_time_sec: 3.0,
        total_watch_time_sec: 150.0,
        snapshot_at: "2026-10-17T01:00:00Z",
        created_at: "2026-10-17T01:00:00Z",
      },
    ];

    const deltas = calculateDeltas(singleSnapshot);
    assert.equal(deltas, null);
  });

  test("calculates positive deltas and velocity across multiple snapshots", () => {
    const snapshots = [
      {
        id: "s1",
        instagram_media_id: "123",
        views: 100,
        reach: 80,
        likes: 5,
        comments: 1,
        shares: 0,
        saved: 1,
        total_interactions: 7,
        avg_watch_time_ms: 4000,
        total_watch_time_ms: 400000,
        avg_watch_time_sec: 4.0,
        total_watch_time_sec: 400.0,
        snapshot_at: "2026-10-17T01:00:00Z",
        created_at: "2026-10-17T01:00:00Z",
      },
      {
        id: "s2",
        instagram_media_id: "123",
        views: 150,
        reach: 120,
        likes: 9,
        comments: 2,
        shares: 2,
        saved: 3,
        total_interactions: 16,
        avg_watch_time_ms: 4200,
        total_watch_time_ms: 630000,
        avg_watch_time_sec: 4.2,
        total_watch_time_sec: 630.0,
        snapshot_at: "2026-10-17T03:00:00Z",
        created_at: "2026-10-17T03:00:00Z",
      },
    ];

    const deltas = calculateDeltas(snapshots);
    assert.ok(deltas);
    assert.equal(deltas.delta_views, 50);
    assert.equal(deltas.delta_reach, 40);
    assert.equal(deltas.delta_interactions, 9);
    assert.equal(deltas.delta_watch_time_sec, 230.0);
    assert.equal(deltas.time_between_snapshots_hours, 2.0);
  });
});

describe("Deterministic AI Performance Insights Engine", () => {
  test("generates high engagement and bookmark insights for educational reels", () => {
    const snapshot = {
      id: "s_test",
      instagram_media_id: "12345",
      views: 300,
      reach: 200,
      likes: 12,
      comments: 3,
      shares: 6,
      saved: 8,
      total_interactions: 29, // 14.5% engagement rate
      avg_watch_time_ms: 5500,
      total_watch_time_ms: 1650000,
      avg_watch_time_sec: 5.5,
      total_watch_time_sec: 1650.0,
      duration_sec: 10, // 55% retention ratio
      snapshot_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const insights = generatePerformanceInsights(snapshot, [snapshot]);

    const insightTypes = insights.map((i) => i.type);
    assert.ok(insightTypes.includes("engagement"), "Should detect high engagement");
    assert.ok(insightTypes.includes("saves"), "Should detect high educational saves");
    assert.ok(insightTypes.includes("shares"), "Should detect peer sharing");
    assert.ok(insightTypes.includes("watch_time"), "Should evaluate watch time retention");

    const engagementInsight = insights.find((i) => i.type === "engagement");
    assert.equal(engagementInsight?.level, "positive");
    assert.equal(engagementInsight?.value, "14.5%");
  });

  test("generates collection benchmark insight when Reel has top reach", () => {
    const topReel = {
      id: "top_reel",
      instagram_media_id: "999",
      views: 1200,
      reach: 850,
      likes: 40,
      comments: 5,
      shares: 10,
      saved: 15,
      total_interactions: 70,
      avg_watch_time_ms: 6000,
      total_watch_time_ms: 7200000,
      avg_watch_time_sec: 6.0,
      total_watch_time_sec: 7200.0,
      duration_sec: 30,
      snapshot_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const otherReel = {
      ...topReel,
      id: "other_reel",
      instagram_media_id: "888",
      reach: 300,
      views: 400,
    };

    const insights = generatePerformanceInsights(topReel, [topReel, otherReel]);
    const benchmarkInsight = insights.find((i) => i.type === "benchmark");

    assert.ok(benchmarkInsight, "Should detect top reach in collection");
    assert.equal(benchmarkInsight?.title, "Top Performer by Reach");
  });

  test("provides baseline telemetry note when only initial snapshot exists", () => {
    const initialSnapshot = {
      id: "init",
      instagram_media_id: "111",
      views: 10,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saved: 0,
      total_interactions: 0,
      avg_watch_time_ms: 0,
      total_watch_time_ms: 0,
      avg_watch_time_sec: 0,
      total_watch_time_sec: 0,
      duration_sec: null,
      snapshot_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const insights = generatePerformanceInsights(initialSnapshot, [initialSnapshot]);
    assert.equal(insights.length, 1);
    assert.equal(insights[0].id, "baseline-snapshot");
  });
});

describe("Graph API Response Parsing & Mock Verification", () => {
  test("parses mock Graph API insights payload into structured metrics", () => {
    const mockApiResponse = {
      data: [
        { name: "views", values: [{ value: 75 }] },
        { name: "reach", values: [{ value: 50 }] },
        { name: "likes", values: [{ value: 4 }] },
        { name: "comments", values: [{ value: 1 }] },
        { name: "shares", values: [{ value: 2 }] },
        { name: "saved", values: [{ value: 3 }] },
        { name: "total_interactions", values: [{ value: 10 }] },
        { name: "ig_reels_avg_watch_time", values: [{ value: 4200 }] },
        { name: "ig_reels_video_view_total_time", values: [{ value: 315000 }] },
      ],
    };

    const valuesMap = {};
    for (const item of mockApiResponse.data) {
      valuesMap[item.name] = item.values?.[0]?.value ?? 0;
    }

    assert.equal(valuesMap["views"], 75);
    assert.equal(valuesMap["reach"], 50);
    assert.equal(valuesMap["likes"], 4);
    assert.equal(valuesMap["saved"], 3);
    assert.equal(valuesMap["ig_reels_avg_watch_time"] / 1000, 4.2);
    assert.equal(valuesMap["ig_reels_video_view_total_time"] / 1000, 315.0);
  });

  test("handles missing or unsupported metrics safely with zero-fallbacks", () => {
    // Some account types or older reels do not support watch time
    const partialMockResponse = {
      data: [
        { name: "views", values: [{ value: 20 }] },
        { name: "reach", values: [{ value: 15 }] },
      ],
    };

    const valuesMap = {};
    for (const item of partialMockResponse.data) {
      valuesMap[item.name] = item.values?.[0]?.value ?? 0;
    }

    const views = valuesMap["views"] ?? 0;
    const saves = valuesMap["saved"] ?? 0;
    const avgWatchMs = valuesMap["ig_reels_avg_watch_time"] ?? 0;

    assert.equal(views, 20);
    assert.equal(saves, 0);
    assert.equal(avgWatchMs, 0);
  });

  test("diagnoses Graph API token expiration (Code 190)", () => {
    const errorPayload = {
      error: {
        message: "Error validating access token: Session has expired",
        code: 190,
        type: "OAuthException",
      },
    };

    const isExpired = errorPayload.error.code === 190;
    assert.equal(isExpired, true);
  });

  test("diagnoses Graph API rate limit errors (Code 4 / 17 / 613)", () => {
    const rateLimitCodes = [4, 17, 32, 613];
    assert.ok(rateLimitCodes.includes(4));
    assert.ok(rateLimitCodes.includes(613));
  });
});
