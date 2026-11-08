import { ThreadsProvider } from "@repo/providers";
import { THREADS_INSIGHTS_MIN_SINCE, type ThreadsInsight } from "@repo/providers/threads";
import { cleanMetrics, type MetricKey } from "../model";
import { eachDay, num, todayUtc, type AccountDay, type PlatformAnalytics, type PostMetricsResult } from "./types";

/**
 * Threads insights.
 * https://developers.facebook.com/docs/threads/insights
 * Needs threads_manage_insights. User insights: `views` is a daily time series
 * (values[]); likes/replies/reposts/quotes are totals (total_value) for since–until,
 * so each day is its own request. clicks = link_total_values. followers_count has no
 * since/until (today only). Earliest since = 1712991600 (2024-04-13).
 */
const USER_METRICS = ["views", "likes", "replies", "reposts", "quotes", "clicks"] as const;
const MEDIA_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
const KEY: Record<string, MetricKey> = {
  views: "views",
  likes: "likes",
  replies: "comments",
  reposts: "reposts",
  quotes: "quotes",
  clicks: "clicks",
  shares: "shares",
  followers_count: "followers",
};

function insightValue(insight: ThreadsInsight): number | undefined {
  if (insight.total_value?.value !== undefined) return num(insight.total_value.value);
  if (insight.link_total_values?.length) return insight.link_total_values.reduce((s, l) => s + (num(l.value) ?? 0), 0);
  if (insight.values?.length) return insight.values.reduce((s, v) => s + (num(v.value) ?? 0), 0);
  return undefined;
}

const unix = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

export const threadsAnalytics: PlatformAnalytics = {
  async accountDays(ctx, from, to) {
    if (!(ctx.provider instanceof ThreadsProvider)) return [];
    const threads = ctx.provider;
    const days: AccountDay[] = [];
    for (const date of eachDay(from, to)) {
      const since = unix(date);
      if (since < THREADS_INSIGHTS_MIN_SINCE) continue;
      const insights = await threads.getUserInsights({ metric: [...USER_METRICS], since, until: since + 86_400 });
      const metrics: Partial<Record<MetricKey, number>> = {};
      const raw: Record<string, unknown> = {};
      for (const insight of insights) {
        const value = insightValue(insight);
        raw[insight.name] = value;
        const key = KEY[insight.name];
        if (key && value !== undefined) metrics[key] = value;
      }
      days.push({ date, metrics: cleanMetrics(metrics), raw });
    }
    if (to >= todayUtc()) {
      const [followers] = await threads.getUserInsights({ metric: ["followers_count"] });
      const value = followers ? insightValue(followers) : undefined;
      if (value !== undefined) {
        const today = todayUtc();
        const row = days.find((d) => d.date === today);
        if (row) row.metrics = { ...row.metrics, followers: value };
        else days.push({ date: today, metrics: { followers: value }, raw: { followers_count: value } });
      }
    }
    return days;
  },

  async posts(ctx, refs) {
    if (!(ctx.provider instanceof ThreadsProvider)) return [];
    const provider: ThreadsProvider = ctx.provider;
    const out: PostMetricsResult[] = [];
    for (const ref of refs) {
      const insights = await provider.getMediaInsights({ mediaId: ref.externalPostId, metric: [...MEDIA_METRICS] });
      const metrics: Partial<Record<MetricKey, number>> = {};
      const raw: Record<string, unknown> = {};
      for (const insight of insights) {
        const value = insightValue(insight);
        raw[insight.name] = value;
        const key = KEY[insight.name];
        if (key && value !== undefined) metrics[key] = value;
      }
      out.push({ postId: ref.postId, metrics: cleanMetrics(metrics), raw, source: "threads.media.insights" });
    }
    return out;
  },
};
