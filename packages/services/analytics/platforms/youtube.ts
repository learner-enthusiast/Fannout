import { YouTubeProvider } from "@repo/providers";
import { createYouTubeAnalyticsForConnection } from "../../provider-factory";
import { cleanMetrics } from "../model";
import { chunk, num, todayUtc, type AccountDay, type PlatformAnalytics, type PostMetricsResult } from "./types";

/**
 * YouTube.
 * - Account: YouTube Analytics API reports.query, ids=channel==MINE, dimensions=day.
 *   https://developers.google.com/youtube/analytics/channel_reports
 *   (metrics views, estimatedMinutesWatched, averageViewDuration, likes, comments, shares,
 *   subscribersGained, subscribersLost). Needs yt-analytics.readonly.
 * - Followers total: Data API channels.list statistics.subscriberCount (today only).
 * - Posts: Data API videos.list part=statistics (≤ 50 ids per call, 1 quota unit), plus
 *   Analytics dimensions=video filters=video==id,… for watch time / avg duration / shares.
 */
const ACCOUNT_METRICS = "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost";
const VIDEO_METRICS = "estimatedMinutesWatched,averageViewDuration,shares";
/** YouTube's launch date: the earliest startDate the Analytics API accepts. */
const LIFETIME_START = "2005-02-14";

function rowsToRecords(res: { columnHeaders?: { name?: string | null }[]; rows?: unknown[][] | null }) {
  const names = (res.columnHeaders ?? []).map((h) => h.name ?? "");
  return (res.rows ?? []).map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
}

function fromAnalytics(r: Record<string, unknown>) {
  const minutes = num(r.estimatedMinutesWatched);
  return {
    views: num(r.views),
    watch_time_seconds: minutes === undefined ? undefined : minutes * 60,
    avg_view_duration_seconds: num(r.averageViewDuration),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    followers_gained: num(r.subscribersGained),
    followers_lost: num(r.subscribersLost),
  };
}

export const youtubeAnalytics: PlatformAnalytics = {
  async accountDays(ctx, from, to) {
    const analytics = await createYouTubeAnalyticsForConnection({ userId: ctx.userId, connectionId: ctx.connectionId });
    const report = await analytics.queryReports({
      ids: "channel==MINE",
      startDate: from,
      endDate: to,
      dimensions: "day",
      metrics: ACCOUNT_METRICS,
      sort: "day",
    });
    const days: AccountDay[] = rowsToRecords(report).map((r) => ({
      date: String(r.day),
      metrics: cleanMetrics(fromAnalytics(r)),
      raw: r,
    }));

    // Subscriber total is only "now": attach it to today's row.
    if (to >= todayUtc() && ctx.provider instanceof YouTubeProvider) {
      const channels = await ctx.provider.listChannels({ part: ["statistics"], mine: true });
      const subscribers = num(channels.items?.[0]?.statistics?.subscriberCount);
      if (subscribers !== undefined) {
        const today = todayUtc();
        const row = days.find((d) => d.date === today);
        if (row) row.metrics = { ...row.metrics, followers: subscribers };
        else days.push({ date: today, metrics: { followers: subscribers }, raw: { subscriberCount: subscribers } });
      }
    }
    return days;
  },

  async posts(ctx, refs) {
    if (!(ctx.provider instanceof YouTubeProvider) || refs.length === 0) return [];
    const youtube = ctx.provider;
    const analytics = await createYouTubeAnalyticsForConnection({ userId: ctx.userId, connectionId: ctx.connectionId });
    const out: PostMetricsResult[] = [];
    for (const batch of chunk(refs, 50)) {
      const ids = batch.map((r) => r.externalPostId);
      const [stats, report] = await Promise.all([
        youtube.listVideo({ part: ["statistics"], id: ids, maxResults: 50 }),
        analytics.queryReports({
          ids: "channel==MINE",
          startDate: LIFETIME_START,
          endDate: todayUtc(),
          dimensions: "video",
          filters: `video==${ids.join(",")}`,
          metrics: VIDEO_METRICS,
          maxResults: 50,
        }),
      ]);
      const byVideo = new Map(rowsToRecords(report).map((r) => [String(r.video), r]));
      for (const ref of batch) {
        const video = stats.items?.find((v) => v.id === ref.externalPostId);
        if (!video) continue; // deleted / private: no snapshot rather than zeros
        const s = video.statistics ?? {};
        const a = byVideo.get(ref.externalPostId) ?? {};
        const watch = fromAnalytics(a);
        out.push({
          postId: ref.postId,
          metrics: cleanMetrics({
            views: num(s.viewCount),
            likes: num(s.likeCount),
            comments: num(s.commentCount),
            watch_time_seconds: watch.watch_time_seconds,
            avg_view_duration_seconds: watch.avg_view_duration_seconds,
            shares: watch.shares,
          }),
          raw: { statistics: s, analytics: a },
          source: "youtube.videos.list+analytics.reports",
        });
      }
    }
    return out;
  },
};
