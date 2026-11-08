import { analyticsAccountSyncRequested, analyticsPostSyncRequested, inngest } from "@repo/inngest";
import {
  analyticsBestTimes,
  analyticsOverview,
  analyticsPostDetail,
  analyticsSyncStatus,
  analyticsTopPosts,
  claimManualRefresh,
} from "@repo/services/analytics";
import {
  BestTimesInputSchema,
  BestTimesSchema,
  OverviewInputSchema,
  OverviewSchema,
  PostDetailInputSchema,
  PostDetailSchema,
  RefreshInputSchema,
  RefreshResultSchema,
  SyncStatusInputSchema,
  SyncStatusSchema,
  TopPostsInputSchema,
  TopPostsPageSchema,
} from "@repo/services/analytics/model";
import { ACCOUNT_SYNC_DAYS } from "@repo/services/analytics/sync";
import { rateLimited, router, scoped } from "../../trpc";

/**
 * Dashboard analytics. Every read comes from Fannout's analytics tables (synced by
 * Inngest); no procedure here calls a platform. `refresh` only queues a sync.
 */
export const analyticsRouter = router({
  overview: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/analytics/overview", summary: "Analytics overview (KPIs, daily series, publish stats)", protect: true } })
    .input(OverviewInputSchema)
    .output(OverviewSchema)
    .query(({ ctx, input }) => analyticsOverview(ctx.dbUserId, input)),

  /** Highest first by sortBy; cursor = base64url("sortValue|postId"). */
  topPosts: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/analytics/top-posts", summary: "Top posts by views, engagement or likes", protect: true } })
    .input(TopPostsInputSchema)
    .output(TopPostsPageSchema)
    .query(({ ctx, input }) => analyticsTopPosts(ctx.dbUserId, input)),

  postDetail: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/analytics/posts/{postId}", summary: "Latest metrics and snapshot history for one post", protect: true } })
    .input(PostDetailInputSchema)
    .output(PostDetailSchema)
    .query(({ ctx, input }) => analyticsPostDetail(ctx.dbUserId, input.postId)),

  bestTimes: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/analytics/best-times", summary: "Average engagement by weekday × hour", protect: true } })
    .input(BestTimesInputSchema)
    .output(BestTimesSchema)
    .query(({ ctx, input }) => analyticsBestTimes(ctx.dbUserId, input)),

  syncStatus: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/analytics/sync-status", summary: "Analytics sync status per connection", protect: true } })
    .input(SyncStatusInputSchema)
    .output(SyncStatusSchema)
    .query(({ ctx, input }) => analyticsSyncStatus(ctx.dbUserId, input.connectionId)),

  /** Queue an account + post sync now. One per connection per 15 minutes (TOO_MANY_REQUESTS otherwise). */
  refresh: rateLimited(scoped("posts:read"), "api")
    .meta({ openapi: { method: "POST", path: "/analytics/{connectionId}/refresh", summary: "Refresh analytics for a connection now", protect: true } })
    .input(RefreshInputSchema)
    .output(RefreshResultSchema)
    .mutation(async ({ ctx, input }) => {
      const { refreshAvailableAt, platform } = await claimManualRefresh(ctx.dbUserId, input.connectionId);
      const stamp = refreshAvailableAt.toISOString();
      await inngest.send([
        analyticsAccountSyncRequested.create(
          { connectionId: input.connectionId, platform, days: ACCOUNT_SYNC_DAYS },
          { id: `analytics-refresh-account:${input.connectionId}:${stamp}` },
        ),
        analyticsPostSyncRequested.create({ connectionId: input.connectionId, platform }, { id: `analytics-refresh-posts:${input.connectionId}:${stamp}` }),
      ]);
      return { queued: true as const, refreshAvailableAt: stamp };
    }),
});
