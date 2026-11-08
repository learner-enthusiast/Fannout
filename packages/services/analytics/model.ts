import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";
import { PlatformSchema } from "../publishing/platforms";

/**
 * Normalized metric keys. Every platform maps its own names onto these in
 * services/analytics/platforms/<platform>.ts. A key the platform doesn't
 * report is ABSENT (never 0) and renders as "—".
 */
export const METRIC_KEYS = [
  "views",
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "reposts",
  "quotes",
  "bookmarks",
  "clicks",
  "watch_time_seconds",
  "avg_view_duration_seconds",
  "followers",
  "followers_gained",
  "followers_lost",
  "profile_views",
  /** Platform-reported total engagements when it doesn't break them down (Facebook page_post_engagements). */
  "engagements",
  /** Video plays as the platform counts them (Facebook ≥3 s views). */
  "video_views",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const metric = (description: string) => z.number().nonnegative().optional().describe(description);
export const MetricsSchema = z
  .object({
    views: metric("Views / plays."),
    impressions: metric("Times the content was shown."),
    reach: metric("Unique accounts reached."),
    likes: metric("Likes / reactions."),
    comments: metric("Comments / replies."),
    shares: metric("Shares."),
    saves: metric("Saves."),
    reposts: metric("Reposts / retweets."),
    quotes: metric("Quote posts."),
    bookmarks: metric("Bookmarks."),
    clicks: metric("Link clicks."),
    watch_time_seconds: metric("Total watch time in seconds."),
    avg_view_duration_seconds: metric("Average view duration in seconds."),
    followers: metric("Follower / subscriber total."),
    followers_gained: metric("Followers gained."),
    followers_lost: metric("Followers lost."),
    profile_views: metric("Profile / Page views."),
    engagements: metric("Platform-reported total engagements (when not broken down)."),
    video_views: metric("Video views as the platform counts them."),
  })
  .describe("Normalized metrics; a missing key means the platform doesn't report it.");
export type Metrics = z.infer<typeof MetricsSchema>;

/** Keys summed into "engagement". `engagements` is used only when none of these are reported. */
export const ENGAGEMENT_KEYS = ["likes", "comments", "shares", "saves", "reposts", "quotes"] as const satisfies readonly MetricKey[];

/** likes+comments+shares+saves+reposts+quotes (those present), else platform `engagements`, else null. */
export function engagementOf(m: Metrics): number | null {
  const parts = ENGAGEMENT_KEYS.map((k) => m[k]).filter((v): v is number => typeof v === "number");
  if (parts.length) return parts.reduce((a, b) => a + b, 0);
  return typeof m.engagements === "number" ? m.engagements : null;
}

/** Denominator for engagement rate: views, else impressions, else reach (labelled in the output). */
export function rateBasisOf(m: Metrics): { basis: "views" | "impressions" | "reach"; value: number } | null {
  for (const basis of ["views", "impressions", "reach"] as const) {
    const value = m[basis];
    if (typeof value === "number" && value > 0) return { basis, value };
  }
  return null;
}

/** Drop undefined/NaN/negative; keep only known keys. */
export function cleanMetrics(input: Partial<Record<MetricKey, number | null | undefined>>): Metrics {
  const out: Record<string, number> = {};
  for (const key of METRIC_KEYS) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out as Metrics;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export const AnalyticsCapabilitySchema = z.object({
  supported: z.boolean().describe("Fannout can read analytics for this platform with the current access."),
  accountMetrics: z.array(z.enum(METRIC_KEYS)).describe("Normalized keys synced per day for the account."),
  postMetrics: z.array(z.enum(METRIC_KEYS)).describe("Normalized keys synced per published post."),
  requiredScopes: z.array(z.string()).describe("OAuth scopes the connection needs; missing → reconnect to enable analytics."),
  note: z.string().optional().describe("Platform note shown on the dashboard."),
});
export type AnalyticsCapability = z.infer<typeof AnalyticsCapabilitySchema>;

// ---------------------------------------------------------------------------
// API inputs
// ---------------------------------------------------------------------------

const IsoDate = z.iso.date().describe("YYYY-MM-DD.");
/** Flat query params (GET/OpenAPI): range=7d|28d|90d, or range=custom&from=…&to=… */
export const RangeFields = {
  range: z.enum(["7d", "28d", "90d", "custom"]).default("28d").describe("Last 7, 28 or 90 days including today, or custom (needs from + to)."),
  from: IsoDate.optional().describe("Custom range start (YYYY-MM-DD, inclusive)."),
  to: IsoDate.optional().describe("Custom range end (YYYY-MM-DD, inclusive; max 366 days)."),
};
export type Range = { range: "7d" | "28d" | "90d" | "custom"; from?: string; to?: string };

const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone")
  .default("UTC")
  .describe("IANA time zone for day buckets and best times (e.g. Asia/Kolkata).");

export const OverviewInputSchema = z.object({
  ...RangeFields,
  connectionId: z.uuid().optional().describe("Limit to one social connection; omit for all."),
  timeZone: TimeZone,
});
export type OverviewInput = z.input<typeof OverviewInputSchema>;

export const TopPostsInputSchema = PaginationInputSchema.extend({
  ...RangeFields,
  connectionId: z.uuid().optional().describe("Limit to one social connection; omit for all."),
  sortBy: z.enum(["views", "engagement", "likes"]).default("views").describe("Sort key (highest first)."),
});
export type TopPostsInput = z.input<typeof TopPostsInputSchema>;

export const PostDetailInputSchema = z.object({ postId: z.uuid().describe("Fannout post ID.") });

export const BestTimesInputSchema = OverviewInputSchema;
export type BestTimesInput = z.input<typeof BestTimesInputSchema>;

export const SyncStatusInputSchema = z.object({
  connectionId: z.uuid().optional().describe("One connection; omit for every active connection."),
});
export const RefreshInputSchema = z.object({ connectionId: z.uuid().describe("Connection to re-sync now.") });

// ---------------------------------------------------------------------------
// API outputs
// ---------------------------------------------------------------------------

const Num = z.number().nullable();
export const KpiSchema = z.object({
  current: Num.describe("Value for the range; null = not reported."),
  previous: Num.describe("Value for the previous period of equal length; null = not reported."),
  deltaPercent: Num.describe("(current − previous) / previous × 100; null when either side is missing or previous is 0."),
});
export type Kpi = z.infer<typeof KpiSchema>;

export const AvailabilitySchema = z.object({
  connectionId: z.uuid().describe("Social connection ID."),
  platform: PlatformSchema.describe("Platform key."),
  username: z.string().nullable().describe("Account handle."),
  status: z
    .enum(["ready", "no_data", "needs_reconnect", "unsupported", "error"])
    .describe("ready = has data; no_data = waiting for the first sync; needs_reconnect = missing scope/token; unsupported = platform gives no analytics; error = last sync failed."),
  missingScopes: z.array(z.string()).describe("Scopes to grant by reconnecting."),
  lastSyncedAt: z.string().nullable().describe("Last successful sync (ISO)."),
  note: z.string().nullable().describe("Platform note."),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const SeriesPointSchema = z.object({
  date: IsoDate,
  platform: PlatformSchema.describe("Platform key."),
  views: Num.describe("Views that day; null = not reported."),
  engagement: Num.describe("Engagement that day; null = not reported."),
  followersNet: Num.describe("Followers gained − lost that day; null = not reported."),
});

export const OverviewSchema = z.object({
  range: z.object({ from: IsoDate, to: IsoDate, previousFrom: IsoDate, previousTo: IsoDate }).describe("Resolved dates."),
  kpis: z
    .object({
      views: KpiSchema.describe("Account views (platform-reported, all content)."),
      engagement: KpiSchema.describe("Account engagement."),
      engagementRate: KpiSchema.describe("Engagement ÷ basis, in percent."),
      engagementRateBasis: z.enum(["views", "impressions", "reach"]).nullable().describe("Denominator used for engagementRate."),
      followersNet: KpiSchema.describe("Followers gained − lost."),
      postsPublished: KpiSchema.describe("Posts published with Fannout (our data)."),
      publishSuccessRate: KpiSchema.describe("published ÷ (published + failed) × 100 (our data)."),
      platform: z.record(z.string(), KpiSchema).describe("Platform-specific tiles keyed by normalized metric (single-connection view only)."),
    })
    .describe("KPI tiles."),
  series: z.array(SeriesPointSchema).describe("One point per day per platform (≤ 366 × 5)."),
  byPlatform: z
    .array(
      z.object({
        platform: PlatformSchema.describe("Platform key."),
        views: Num.describe("Views in range."),
        engagement: Num.describe("Engagement in range."),
      }),
    )
    .describe("Totals per platform (≤ 5)."),
  publishStats: z
    .object({
      published: z.number().int().describe("Published in range."),
      failed: z.number().int().describe("Failed in range."),
      scheduled: z.number().int().describe("Currently scheduled (upcoming)."),
      successRate: Num.describe("published ÷ (published + failed) × 100."),
    })
    .describe("From Fannout's own posts table."),
  upcoming: z
    .array(
      z.object({
        postId: z.uuid().describe("Post ID."),
        name: z.string().describe("Post name."),
        platform: PlatformSchema.nullable().describe("Platform key."),
        scheduledAt: z.string().describe("ISO time."),
      }),
    )
    .describe("Next 5 scheduled posts."),
  recentFailures: z
    .array(
      z.object({
        postId: z.uuid().describe("Post ID."),
        name: z.string().describe("Post name."),
        platform: PlatformSchema.nullable().describe("Platform key."),
        errorMessage: z.string().nullable().describe("Why it failed."),
        failedAt: z.string().describe("ISO time."),
      }),
    )
    .describe("Last 5 failed posts."),
  availability: z.array(AvailabilitySchema).describe("Analytics availability per active connection (≤ connections)."),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const TopPostSchema = z.object({
  postId: z.uuid().describe("Post ID."),
  connectionId: z.uuid().describe("Social connection ID."),
  platform: PlatformSchema.nullable().describe("Platform key."),
  title: z.string().describe("Post name or caption."),
  publishedAt: z.string().nullable().describe("ISO time."),
  postUrl: z.string().nullable().describe("Link on the platform."),
  thumbnailUrl: z.string().nullable().describe("Short-lived preview URL."),
  metrics: MetricsSchema,
  engagement: Num.describe("Engagement (see MetricsSchema); null = not reported."),
  capturedAt: z.string().describe("When these metrics were synced (ISO)."),
});
export const TopPostsPageSchema = paginatedOutput(TopPostSchema);

export const PostDetailSchema = z.object({
  postId: z.uuid().describe("Post ID."),
  platform: PlatformSchema.nullable().describe("Platform key."),
  latest: MetricsSchema.nullable().describe("Most recent snapshot; null before the first sync."),
  engagement: Num.describe("Engagement of the latest snapshot."),
  snapshots: z
    .array(z.object({ capturedAt: z.string().describe("ISO time."), metrics: MetricsSchema }))
    .describe("Snapshot series, oldest first (≤ 200; syncs stop after 90 days)."),
});

export const BestTimesSchema = z.object({
  timeZone: z.string().describe("Zone used for the buckets."),
  cells: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6).describe("0 = Sunday."),
        hour: z.number().int().min(0).max(23).describe("Hour of day in timeZone."),
        posts: z.number().int().describe("Posts published in this slot."),
        avgEngagement: z.number().describe("Average engagement of those posts."),
      }),
    )
    .describe("Only slots with posts (≤ 168)."),
});

export const SyncStatusSchema = z.object({
  connections: z
    .array(
      AvailabilitySchema.extend({
        lastAccountSyncAt: z.string().nullable().describe("ISO time."),
        lastPostSyncAt: z.string().nullable().describe("ISO time."),
        lastError: z.string().nullable().describe("Last sync error."),
        refreshAvailableAt: z.string().nullable().describe("When Refresh can be used again (ISO); null = now."),
      }),
    )
    .describe("One per active connection (≤ connections)."),
});

export const RefreshResultSchema = z.object({
  queued: z.literal(true).describe("A sync was queued."),
  refreshAvailableAt: z.string().describe("Next allowed manual refresh (ISO)."),
});
