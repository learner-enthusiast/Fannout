import { XProvider } from "@repo/providers";
import { cleanMetrics } from "../model";
import { chunk, num, todayUtc, type PlatformAnalytics, type PostMetricsResult } from "./types";

/**
 * X API v2 metrics (paid reads — the post sync only polls at 1 h / 24 h / 7 d / 30 d).
 * https://docs.x.com/x-api/fundamentals/metrics
 * - Posts: GET /2/tweets?ids=… (≤ 100 ids) with tweet.fields=public_metrics, plus
 *   non_public_metrics (user context, own posts, only for posts < 30 days old).
 * - Account: users/me public_metrics.followers_count (today only). X has no daily account views.
 * XDK returns camelCase (likeCount); snake_case is read too in case of raw payloads.
 */
const NON_PUBLIC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const pick = (obj: Record<string, unknown> | undefined, camel: string, snake: string) => num(obj?.[camel] ?? obj?.[snake]);

export const xAnalytics: PlatformAnalytics = {
  async accountDays(ctx, _from, to) {
    if (!(ctx.provider instanceof XProvider) || to < todayUtc()) return [];
    const me = await ctx.provider.getMe({ userFields: ["public_metrics"] });
    const metrics = (me.data as { publicMetrics?: Record<string, unknown>; public_metrics?: Record<string, unknown> } | undefined) ?? {};
    const followers = pick(metrics.publicMetrics ?? metrics.public_metrics, "followersCount", "followers_count");
    return followers === undefined ? [] : [{ date: todayUtc(), metrics: { followers }, raw: { followers_count: followers } }];
  },

  async posts(ctx, refs) {
    if (!(ctx.provider instanceof XProvider) || refs.length === 0) return [];
    const x = ctx.provider;
    const young = refs.filter((r) => Date.now() - r.publishedAt.getTime() < NON_PUBLIC_MAX_AGE_MS);
    const old = refs.filter((r) => !young.includes(r));
    const out: PostMetricsResult[] = [];

    const run = async (batch: typeof refs, withNonPublic: boolean) => {
      const res = await x.getPosts({
        ids: batch.map((r) => r.externalPostId),
        postFields: withNonPublic ? ["public_metrics", "non_public_metrics"] : ["public_metrics"],
      });
      for (const post of res.data ?? []) {
        const ref = batch.find((r) => r.externalPostId === post.id);
        if (!ref) continue;
        const p = post as Record<string, unknown>;
        const pub = (p.publicMetrics ?? p.public_metrics) as Record<string, unknown> | undefined;
        const priv = (p.nonPublicMetrics ?? p.non_public_metrics) as Record<string, unknown> | undefined;
        out.push({
          postId: ref.postId,
          metrics: cleanMetrics({
            impressions: pick(priv, "impressionCount", "impression_count") ?? pick(pub, "impressionCount", "impression_count"),
            likes: pick(pub, "likeCount", "like_count"),
            comments: pick(pub, "replyCount", "reply_count"),
            reposts: pick(pub, "retweetCount", "retweet_count"),
            quotes: pick(pub, "quoteCount", "quote_count"),
            bookmarks: pick(pub, "bookmarkCount", "bookmark_count"),
            clicks: pick(priv, "urlLinkClicks", "url_link_clicks"),
            profile_views: pick(priv, "userProfileClicks", "user_profile_clicks"),
          }),
          raw: { public_metrics: pub ?? null, non_public_metrics: priv ?? null },
          source: withNonPublic ? "x.tweets.lookup+non_public" : "x.tweets.lookup",
        });
      }
    };
    for (const batch of chunk(young, 100)) await run(batch, true);
    for (const batch of chunk(old, 100)) await run(batch, false);
    return out;
  },
};
