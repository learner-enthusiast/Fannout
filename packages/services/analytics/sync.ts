import { analyticsAccountDaily, analyticsPostSnapshots, analyticsSyncState, and, db, eq, gt, isNotNull, isNull, posts, socialConnections, sql } from "@repo/database";
import { errors } from "@repo/errors";
import { logger } from "@repo/logger";
import { ProviderError } from "@repo/providers";
import { z } from "zod";
import { invalidate } from "../cache";
import { createProviderForConnection } from "../provider-factory";
import { platformForProvider, type Platform } from "../publishing/platforms";
import { classifyPublishError } from "../publishing/run";
export { resetAnalyticsSyncAfterReconnect } from "./reconnect";
import { ANALYTICS_CAPABILITIES, missingScopes } from "./capabilities";
import { facebookAnalytics } from "./platforms/facebook";
import { instagramAnalytics } from "./platforms/instagram";
import { threadsAnalytics } from "./platforms/threads";
import type { AnalyticsContext, PlatformAnalytics, PostRef } from "./platforms/types";
import { xAnalytics } from "./platforms/x";
import { youtubeAnalytics } from "./platforms/youtube";

/**
 * Analytics sync. Runs ONLY inside Inngest (packages/inngest/functions/analytics.ts);
 * dashboard requests read the tables this writes.
 */
const PLATFORM_ANALYTICS: Partial<Record<Platform, PlatformAnalytics>> = {
  youtube: youtubeAnalytics,
  facebook: facebookAnalytics,
  threads: threadsAnalytics,
  x: xAnalytics,
  instagram: instagramAnalytics,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const ACCOUNT_SYNC_DAYS = 3;
export const BACKFILL_DAYS = 28;
export const MANUAL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_POSTS_PER_RUN = 200;

/** Refresh cadence by post age: <24 h → 2 h; 1–7 d → 12 h; 7–30 d → daily; 30–90 d → weekly; >90 d → stop. */
export function postSyncInterval(ageMs: number): number | null {
  if (ageMs < DAY) return 2 * HOUR;
  if (ageMs < 7 * DAY) return 12 * HOUR;
  if (ageMs < 30 * DAY) return DAY;
  if (ageMs < 90 * DAY) return 7 * DAY;
  return null;
}

/** X reads are paid: only at these ages (one snapshot after each checkpoint). */
export const X_CHECKPOINTS_MS = [HOUR, DAY, 7 * DAY, 30 * DAY];

export function isPostDue(platform: Platform, publishedAt: Date, lastCapturedAt: Date | null, now = new Date()): boolean {
  const age = now.getTime() - publishedAt.getTime();
  if (platform === "x") {
    const reached = X_CHECKPOINTS_MS.filter((c) => age >= c).at(-1);
    if (reached === undefined || age > 31 * DAY) return false;
    return !lastCapturedAt || lastCapturedAt.getTime() < publishedAt.getTime() + reached;
  }
  const interval = postSyncInterval(age);
  if (interval === null) return false;
  return !lastCapturedAt || now.getTime() - lastCapturedAt.getTime() >= interval;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

type ConnectionRow = typeof socialConnections.$inferSelect;

async function loadConnection(connectionId: string): Promise<ConnectionRow | null> {
  const [row] = await db.select().from(socialConnections).where(eq(socialConnections.id, z.uuid().parse(connectionId))).limit(1);
  return row ?? null;
}

async function setState(connectionId: string, patch: Partial<typeof analyticsSyncState.$inferInsert>) {
  await db
    .insert(analyticsSyncState)
    .values({ socialConnectionId: connectionId, ...patch })
    .onConflictDoUpdate({ target: analyticsSyncState.socialConnectionId, set: { ...patch, updatedAt: new Date() } });
  // Every sync outcome (rows written, error, needs_reconnect) goes through here: the dashboard must re-read.
  const [owner] = await db.select({ userId: socialConnections.userId }).from(socialConnections).where(eq(socialConnections.id, connectionId)).limit(1);
  if (owner) await invalidate(owner.userId, "analytics");
}

/**
 * Auth / missing permission → needs_reconnect (publishing tokens are NOT touched);
 * rate limit and transient → rethrow so Inngest retries; other permanent → error, no retry.
 */
async function handleSyncError(connectionId: string, error: unknown): Promise<void> {
  const { kind, code, message } = classifyPublishError(error);
  const forbidden = error instanceof ProviderError && (error.code === "FORBIDDEN" || /permission|scope|insufficient/i.test(error.message));
  if (kind === "auth" || forbidden) {
    await setState(connectionId, { status: "needs_reconnect", lastError: message.slice(0, 300) });
    logger.warn("analytics.needs_reconnect", { connectionId, code });
    return;
  }
  await setState(connectionId, { lastError: message.slice(0, 300), ...(kind === "transient" ? {} : { status: "error" }) });
  if (kind === "transient") throw error;
  logger.warn("analytics.sync_failed", { connectionId, code });
}

type Prepared = { ctx: AnalyticsContext; platform: Platform; analytics: PlatformAnalytics };

/** Connection + provider, or null after recording why analytics can't run. */
async function prepare(connectionId: string): Promise<Prepared | null> {
  const row = await loadConnection(connectionId);
  if (!row || !row.isActive || !row.accessTokenEncrypted) return null;
  const platform = platformForProvider(row.provider);
  const analytics = platform ? PLATFORM_ANALYTICS[platform] : undefined;
  if (!platform || !analytics || !ANALYTICS_CAPABILITIES[platform].supported) return null;
  if (missingScopes(platform, row.scopes).length) {
    // No API call when a required scope is missing.
    await setState(connectionId, { status: "needs_reconnect", lastError: "Missing analytics permission" });
    return null;
  }
  const provider = await createProviderForConnection({ userId: row.userId, connectionId: row.id });
  return {
    platform,
    analytics,
    ctx: { userId: row.userId, connectionId: row.id, providerAccountId: row.providerAccountId, provider },
  };
}

/** Account metrics for the last `days` days (late data is re-upserted). */
export async function syncAccountMetrics(connectionId: string, days = ACCOUNT_SYNC_DAYS): Promise<{ days: number } | { skipped: true }> {
  let prepared: Prepared | null;
  try {
    prepared = await prepare(connectionId);
  } catch (error) {
    await handleSyncError(connectionId, error);
    return { skipped: true };
  }
  if (!prepared) return { skipped: true };
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * DAY);
  try {
    const rows = await prepared.analytics.accountDays(prepared.ctx, ymd(from), ymd(to));
    for (const row of rows) {
      await db
        .insert(analyticsAccountDaily)
        .values({ socialConnectionId: connectionId, date: row.date, metrics: row.metrics, raw: row.raw })
        .onConflictDoUpdate({
          target: [analyticsAccountDaily.socialConnectionId, analyticsAccountDaily.date],
          // Keep values only the earlier sync had (e.g. today's follower total) unless re-reported.
          set: { metrics: sql`${analyticsAccountDaily.metrics} || excluded.metrics`, raw: sql`${analyticsAccountDaily.raw} || excluded.raw`, capturedAt: new Date() },
        });
    }
    await setState(connectionId, {
      status: "ok",
      lastError: null,
      lastAccountSyncAt: new Date(),
      nextSyncAt: new Date(Date.now() + DAY),
      ...(days >= BACKFILL_DAYS ? { backfilledAt: new Date() } : {}),
    });
    return { days: rows.length };
  } catch (error) {
    await handleSyncError(connectionId, error);
    return { skipped: true };
  }
}

/** Published Fannout posts on this connection that are due a snapshot. */
export async function duePosts(connectionId: string, platform: Platform, now = new Date()): Promise<PostRef[]> {
  const rows = await db
    .select({
      postId: posts.id,
      externalPostId: posts.externalPostId,
      publishedAt: posts.publishedAt,
      mediaType: sql<string | null>`${posts.config}->>'mediaType'`,
      postType: sql<string | null>`${posts.config}->'progress'->>'postType'`,
      lastCapturedAt: sql<string | null>`(select max(s.captured_at) from ${analyticsPostSnapshots} s where s.post_id = ${posts.id})`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.socialConnectionId, connectionId),
        eq(posts.status, "published"),
        isNotNull(posts.externalPostId),
        isNull(posts.deletedAt),
        gt(posts.publishedAt, new Date(now.getTime() - 91 * DAY)),
      ),
    );
  return rows
    .filter((r) => r.publishedAt && isPostDue(platform, r.publishedAt, r.lastCapturedAt ? new Date(r.lastCapturedAt) : null, now))
    .slice(0, MAX_POSTS_PER_RUN)
    .map((r) => ({ postId: r.postId, externalPostId: r.externalPostId!, publishedAt: r.publishedAt!, mediaType: r.mediaType, postType: r.postType }));
}

export async function syncPostMetrics(connectionId: string): Promise<{ posts: number } | { skipped: true }> {
  let prepared: Prepared | null;
  try {
    prepared = await prepare(connectionId);
  } catch (error) {
    await handleSyncError(connectionId, error);
    return { skipped: true };
  }
  if (!prepared) return { skipped: true };
  const due = await duePosts(connectionId, prepared.platform);
  if (due.length === 0) {
    await setState(connectionId, { lastPostSyncAt: new Date() });
    return { posts: 0 };
  }
  try {
    const results = await prepared.analytics.posts(prepared.ctx, due);
    if (results.length) {
      await db.insert(analyticsPostSnapshots).values(
        results.map((r) => ({ postId: r.postId, socialConnectionId: connectionId, metrics: r.metrics, raw: r.raw, source: r.source })),
      );
    }
    await setState(connectionId, { status: "ok", lastError: null, lastPostSyncAt: new Date() });
    if (prepared.platform === "x") logger.info("analytics.x.cost", { connectionId, postsRead: results.length });
    return { posts: results.length };
  } catch (error) {
    await handleSyncError(connectionId, error);
    return { skipped: true };
  }
}

/** Active connections whose platform supports analytics (for the crons). */
export async function analyticsConnections() {
  const rows = await db
    .select({
      id: socialConnections.id,
      provider: socialConnections.provider,
      backfilledAt: analyticsSyncState.backfilledAt,
      hasState: sql<boolean>`${analyticsSyncState.socialConnectionId} is not null`,
    })
    .from(socialConnections)
    .leftJoin(analyticsSyncState, eq(analyticsSyncState.socialConnectionId, socialConnections.id))
    .where(and(eq(socialConnections.isActive, true), isNotNull(socialConnections.accessTokenEncrypted)));
  return rows.flatMap((r) => {
    const platform = platformForProvider(r.provider);
    if (!platform || !ANALYTICS_CAPABILITIES[platform].supported) return [];
    return [{ connectionId: r.id, platform, needsBackfill: !r.backfilledAt }];
  });
}

/** "Refresh now": one per 15 min per connection. Returns when it can be used again. */
export async function claimManualRefresh(userId: string, connectionId: string): Promise<{ refreshAvailableAt: Date; platform: Platform }> {
  const [row] = await db
    .select({ id: socialConnections.id, provider: socialConnections.provider, last: analyticsSyncState.lastManualRefreshAt })
    .from(socialConnections)
    .leftJoin(analyticsSyncState, eq(analyticsSyncState.socialConnectionId, socialConnections.id))
    .where(and(eq(socialConnections.id, z.uuid().parse(connectionId)), eq(socialConnections.userId, userId)))
    .limit(1);
  if (!row) return errors.notFound("Social connection");
  const platform = platformForProvider(row.provider);
  if (!platform || !ANALYTICS_CAPABILITIES[platform].supported) return errors.badRequest("Analytics aren't available for this account");
  if (row.last && Date.now() - row.last.getTime() < MANUAL_REFRESH_INTERVAL_MS) {
    const at = new Date(row.last.getTime() + MANUAL_REFRESH_INTERVAL_MS);
    return errors.tooManyRequests("Analytics were refreshed recently. Try again later.", { refreshAvailableAt: at.toISOString() });
  }
  const now = new Date();
  // Conditional update so two clicks can't both pass.
  const claimed = await db
    .insert(analyticsSyncState)
    .values({ socialConnectionId: row.id, lastManualRefreshAt: now })
    .onConflictDoUpdate({
      target: analyticsSyncState.socialConnectionId,
      set: { lastManualRefreshAt: now, updatedAt: now },
      setWhere: sql`${analyticsSyncState.lastManualRefreshAt} is null or ${analyticsSyncState.lastManualRefreshAt} < ${new Date(now.getTime() - MANUAL_REFRESH_INTERVAL_MS)}`,
    })
    .returning({ id: analyticsSyncState.socialConnectionId });
  if (claimed.length === 0) return errors.tooManyRequests("Analytics were refreshed recently. Try again later.");
  return { refreshAvailableAt: new Date(now.getTime() + MANUAL_REFRESH_INTERVAL_MS), platform };
}
