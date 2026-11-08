import type { Platform } from "../publishing/platforms";
import type { AnalyticsCapability } from "./model";

/**
 * What each platform's analytics sync can read (normalized keys) and which
 * OAuth scopes it needs. Keep in sync with services/analytics/platforms/*.ts.
 * Doc sources are cited in each platform file.
 */
export const ANALYTICS_CAPABILITIES: Record<Platform, AnalyticsCapability> = {
  youtube: {
    supported: true,
    accountMetrics: ["views", "watch_time_seconds", "avg_view_duration_seconds", "likes", "comments", "shares", "followers", "followers_gained", "followers_lost"],
    postMetrics: ["views", "likes", "comments", "watch_time_seconds", "avg_view_duration_seconds", "shares"],
    requiredScopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
    note: "YouTube Analytics data can arrive up to 3 days late.",
  },
  facebook: {
    supported: true,
    accountMetrics: ["views", "reach", "impressions", "engagements", "followers", "followers_gained", "followers_lost", "video_views", "profile_views"],
    postMetrics: ["views", "likes", "clicks", "video_views"],
    requiredScopes: ["read_insights", "pages_read_engagement"],
    note: "Facebook no longer reports unique post reach (deprecated after Graph API v25).",
  },
  threads: {
    supported: true,
    accountMetrics: ["views", "likes", "comments", "reposts", "quotes", "clicks", "followers"],
    postMetrics: ["views", "likes", "comments", "reposts", "quotes", "shares"],
    requiredScopes: ["threads_manage_insights"],
  },
  x: {
    supported: true,
    accountMetrics: ["followers"],
    postMetrics: ["impressions", "likes", "comments", "reposts", "quotes", "bookmarks", "clicks", "profile_views"],
    requiredScopes: ["tweet.read", "users.read"],
    note: "Updated at 1 h, 24 h, 7 d and 30 d after posting to limit API cost. X has no daily account views.",
  },
  linkedin: {
    supported: false,
    accountMetrics: [],
    postMetrics: [],
    requiredScopes: [],
    note: "Analytics aren't available with the current LinkedIn access.",
  },
};

/** Required scopes the connection doesn't have. Unknown scopes (null/empty) → [] (try, and learn from a 403). */
export function missingScopes(platform: Platform, scopes: string[] | null | undefined): string[] {
  if (!scopes || scopes.length === 0) return [];
  return ANALYTICS_CAPABILITIES[platform].requiredScopes.filter((s) => !scopes.includes(s));
}
