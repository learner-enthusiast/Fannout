import { FacebookProvider } from "@repo/providers";
import type { FacebookInsight } from "@repo/providers/facebook";
import { cleanMetrics, type MetricKey } from "../model";
import { num, type AccountDay, type PlatformAnalytics, type PostMetricsResult } from "./types";

/**
 * Facebook Page insights (Graph API).
 * https://developers.facebook.com/docs/graph-api/reference/insights
 * Needs read_insights + pages_read_engagement (Page token, ANALYZE task).
 * page_impressions_unique / post_impressions_unique are deprecated above v25 and are NOT
 * requested; Page reach comes from page_total_media_view_unique, post reach stays absent.
 */
const PAGE_METRICS: Record<string, MetricKey> = {
  page_media_view: "views",
  page_total_media_view_unique: "reach",
  page_impressions: "impressions",
  page_post_engagements: "engagements",
  page_follows: "followers",
  page_daily_follows_unique: "followers_gained",
  page_daily_unfollows_unique: "followers_lost",
  page_video_views: "video_views",
  page_views_total: "profile_views",
};

const POST_METRICS: Record<string, MetricKey> = {
  post_media_view: "views",
  post_clicks: "clicks",
  post_reactions_by_type_total: "likes",
  post_video_views: "video_views",
};

/** Number, or the sum of a breakdown object (post_reactions_by_type_total = { like, love, … }). */
const valueOf = (value: unknown): number | undefined =>
  typeof value === "object" && value !== null
    ? Object.values(value as Record<string, unknown>).reduce<number>((sum, v) => sum + (num(v) ?? 0), 0)
    : num(value);

/** Graph day values end at the next day's boundary: end_time 2026-11-09T08:00 → 2026-11-08. */
const dayOf = (endTime: string) => new Date(Date.parse(endTime) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const facebookAnalytics: PlatformAnalytics = {
  async accountDays(ctx, from, to) {
    if (!(ctx.provider instanceof FacebookProvider)) return [];
    const page = await ctx.provider.getPageInsights({ metric: Object.keys(PAGE_METRICS), period: "day", since: from, until: nextDay(to) });
    const days = new Map<string, { metrics: Partial<Record<MetricKey, number>>; raw: Record<string, unknown> }>();
    for (const insight of page.items as FacebookInsight[]) {
      const key = PAGE_METRICS[insight.name];
      for (const point of insight.values ?? []) {
        const endTime = (point as { end_time?: string }).end_time;
        if (!endTime) continue;
        const date = dayOf(endTime);
        if (date < from || date > to) continue;
        const day = days.get(date) ?? { metrics: {}, raw: {} };
        const value = valueOf(point.value);
        day.raw[insight.name] = point.value;
        if (key && value !== undefined) day.metrics[key] = value;
        days.set(date, day);
      }
    }
    return [...days].map(([date, d]): AccountDay => ({ date, metrics: cleanMetrics(d.metrics), raw: d.raw }));
  },

  async posts(ctx, refs) {
    if (!(ctx.provider instanceof FacebookProvider)) return [];
    const provider: FacebookProvider = ctx.provider;
    const out: PostMetricsResult[] = [];
    for (const ref of refs) {
      // Insights need "{page-id}_{post-id}"; video publishes may have stored the bare video id.
      const postId = /^\d+_\d+$/.test(ref.externalPostId) ? ref.externalPostId : `${ctx.providerAccountId}_${ref.externalPostId}`;
      const metric = Object.keys(POST_METRICS).filter((m) => m !== "post_video_views" || ref.mediaType === "video");
      const insights = await provider.getPostInsights({ postId, metric, period: "lifetime" });
      const metrics: Partial<Record<MetricKey, number>> = {};
      const raw: Record<string, unknown> = {};
      for (const insight of insights.items as FacebookInsight[]) {
        const value = insight.values?.[0]?.value;
        raw[insight.name] = value;
        const key = POST_METRICS[insight.name];
        const n = valueOf(value);
        if (key && n !== undefined) metrics[key] = n;
      }
      out.push({ postId: ref.postId, metrics: cleanMetrics(metrics), raw, source: "facebook.post.insights" });
    }
    return out;
  },
};
