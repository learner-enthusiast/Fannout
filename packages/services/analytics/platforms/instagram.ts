import { InstagramProvider, ProviderError } from "@repo/providers";
import { INSTAGRAM_ACCOUNT_METRICS, INSTAGRAM_MEDIA_METRICS, instagramPostType, type InstagramInsight, type InstagramPostType } from "@repo/providers/instagram";
import { cleanMetrics, type MetricKey } from "../model";
import { eachDay, num, todayUtc, type AccountDay, type PlatformAnalytics, type PostMetricsResult } from "./types";

/**
 * Instagram insights (needs instagram_manage_insights).
 * https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights
 * - Metrics are chosen from OUR stored post type: an unsupported metric fails the WHOLE request.
 *   Never impressions. ig_reels_avg_watch_time is reels only (ms → seconds).
 * - An empty `data` array means "no data yet", not zero (left absent). Data can lag 48 h.
 * - Account level is best effort: a failure must not fail the sync. Followers come from the profile field.
 */
const KEY: Record<string, MetricKey> = {
  views: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  saved: "saves",
  shares: "shares",
  total_interactions: "engagements",
  ig_reels_avg_watch_time: "avg_view_duration_seconds",
};

function insightValue(insight: InstagramInsight): number | undefined {
  if (insight.total_value?.value !== undefined) return num(insight.total_value.value);
  const first = insight.values?.[0]?.value;
  return typeof first === "number" ? first : undefined;
}

function toMetrics(insights: InstagramInsight[]) {
  const metrics: Partial<Record<MetricKey, number>> = {};
  const raw: Record<string, unknown> = {};
  for (const insight of insights) {
    const value = insightValue(insight);
    raw[insight.name] = value;
    const key = KEY[insight.name];
    if (!key || value === undefined) continue;
    // ig_reels_avg_watch_time is milliseconds.
    metrics[key] = insight.name === "ig_reels_avg_watch_time" ? Math.round(value) / 1000 : value;
  }
  return { metrics: cleanMetrics(metrics), raw };
}

const unix = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

export const instagramAnalytics: PlatformAnalytics = {
  async accountDays(ctx, from, to) {
    if (!(ctx.provider instanceof InstagramProvider)) return [];
    const instagram = ctx.provider;
    const days: AccountDay[] = [];
    try {
      for (const date of eachDay(from, to)) {
        const since = unix(date);
        const insights = await instagram.getAccountInsights(INSTAGRAM_ACCOUNT_METRICS, { since, until: since + 86_400 });
        if (insights.length === 0) continue; // no data yet, not zero
        const { metrics, raw } = toMetrics(insights);
        days.push({ date, metrics, raw });
      }
    } catch (error) {
      // Best effort: keep what we have. Auth problems still surface through the post sync / health check.
      if (!(error instanceof ProviderError)) throw error;
    }
    if (to >= todayUtc()) {
      try {
        const followers = (await instagram.getProfile()).followers_count;
        if (followers !== undefined) {
          const today = todayUtc();
          const row = days.find((d) => d.date === today);
          if (row) row.metrics = { ...row.metrics, followers };
          else days.push({ date: today, metrics: { followers }, raw: { followers_count: followers } });
        }
      } catch {
        // Profile read is best effort.
      }
    }
    return days;
  },

  async posts(ctx, refs) {
    if (!(ctx.provider instanceof InstagramProvider)) return [];
    const instagram = ctx.provider;
    const out: PostMetricsResult[] = [];
    for (const ref of refs) {
      const type: InstagramPostType = (ref.postType as InstagramPostType | null | undefined) ?? instagramPostType(ref.mediaType === "video" ? "video" : "photos", 1);
      let insights: InstagramInsight[];
      try {
        insights = await instagram.getMediaInsights(ref.externalPostId, INSTAGRAM_MEDIA_METRICS[type]);
      } catch (error) {
        // One post Instagram can't report on (too old, removed in the app) must not fail the batch.
        if (error instanceof ProviderError && (error.status === 400 || error.status === 404)) continue;
        throw error;
      }
      if (insights.length === 0) continue; // no data yet
      const { metrics, raw } = toMetrics(insights);
      out.push({ postId: ref.postId, metrics, raw, source: `instagram.media.insights.${type}` });
    }
    return out;
  },
};
