import { randomBytes } from "node:crypto";
import {
  analyticsAccountDaily,
  analyticsPostSnapshots,
  analyticsSyncState,
  and,
  dataDeletionRequests,
  db,
  desc,
  eq,
  gte,
  inArray,
  or,
  posts,
  scheduledPosts,
  socialConnections,
  sql,
} from "@repo/database";
import { logger } from "@repo/logger";
import { z } from "zod";
import { env } from "../env";
import type { NotificationType } from "../notifications/model";
import { cancelSchedule, type SchedulingEffects } from "../scheduling";

/**
 * Meta app-removal and data-deletion callbacks (Facebook + Threads).
 * - Facebook deauthorize / data deletion:
 *   https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 *   https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow (deauthorize callback)
 * - Threads uninstall / delete callbacks are configured in the Threads use case settings and
 *   verified with the THREADS app secret (https://developers.facebook.com/docs/threads/get-started).
 *   The Threads docs we checked don't spell out the payload; it is handled as the same
 *   signed_request format (user_id = Threads user id).
 */

export const MetaProviderSchema = z.enum(["facebook", "threads"]);
export type MetaProvider = z.infer<typeof MetaProviderSchema>;

export const DeletionStatusSchema = z.enum(["received", "processing", "completed", "no_data"]);

/** Secret that signs this provider's signed_request. */
export function metaAppSecret(provider: MetaProvider): string | undefined {
  return provider === "facebook" ? (env.META_APP_SECRET ?? env.FACEBOOK_CLIENT_SECRET) : (env.THREADS_APP_SECRET ?? env.THREADS_CLIENT_SECRET);
}

export const PROVIDER_LABEL: Record<MetaProvider, string> = { facebook: "Facebook", threads: "Threads" };

/** Side effects owned by the caller (API route / Inngest), so services never import Inngest. */
export type MetaEffects = {
  scheduling: SchedulingEffects;
  /** post/publish.cancelled for an in-flight immediate publish. */
  publishCancelled(postId: string): Promise<void>;
  notify(notification: { userId: string; type: NotificationType; title: string; body: string; link?: string; dedupeId: string }): Promise<void>;
};

/**
 * Connections that belong to this Meta user.
 * Facebook: user_id is the app-scoped Facebook USER id (not a Page id) — stored per Page
 * connection in config.facebookUserId (and config.facebookUser.id for older rows).
 * Threads: user_id = the Threads user id = provider_account_id.
 */
export async function findMetaConnections(provider: MetaProvider, platformUserId: string) {
  const match =
    provider === "facebook"
      ? and(
          eq(socialConnections.provider, "FACEBOOK"),
          or(
            sql`${socialConnections.config}->>'facebookUserId' = ${platformUserId}`,
            sql`${socialConnections.config}->'facebookUser'->>'id' = ${platformUserId}`,
          ),
        )
      : and(eq(socialConnections.provider, "THREADS"), eq(socialConnections.providerAccountId, platformUserId));
  return db
    .select({ id: socialConnections.id, userId: socialConnections.userId, isActive: socialConnections.isActive, config: socialConnections.config })
    .from(socialConnections)
    .where(match);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** 16 random alphanumeric characters. */
function confirmationCode(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function recordDeletionRequest(input: {
  provider: MetaProvider;
  platformUserId: string;
  kind: "deauthorize" | "deletion";
  matchedConnectionIds: string[];
  status?: z.infer<typeof DeletionStatusSchema>;
}) {
  const [row] = await db
    .insert(dataDeletionRequests)
    .values({
      provider: input.provider,
      platformUserId: input.platformUserId,
      kind: input.kind,
      confirmationCode: confirmationCode(),
      status: input.status ?? "received",
      matchedConnectionIds: input.matchedConnectionIds,
      ...(input.status === "completed" || input.status === "no_data" ? { completedAt: new Date() } : {}),
    })
    .returning();
  return row!;
}

/** Same provider + user within 24 h → reuse that deletion request (Meta may retry). */
export async function recentDeletionRequest(provider: MetaProvider, platformUserId: string) {
  const [row] = await db
    .select()
    .from(dataDeletionRequests)
    .where(
      and(
        eq(dataDeletionRequests.provider, provider),
        eq(dataDeletionRequests.platformUserId, platformUserId),
        eq(dataDeletionRequests.kind, "deletion"),
        gte(dataDeletionRequests.requestedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(dataDeletionRequests.requestedAt))
    .limit(1);
  return row ?? null;
}

/** Stop everything not yet live on this connection: scheduled → cancelSchedule; queued/publishing → cancelled + cancel event. */
async function cancelPendingPosts(connectionId: string, userId: string, effects: MetaEffects): Promise<number> {
  const pending = await db
    .select({ id: posts.id, scheduleId: scheduledPosts.id })
    .from(posts)
    .leftJoin(scheduledPosts, and(eq(scheduledPosts.postId, posts.id), inArray(scheduledPosts.status, ["scheduled", "handed_off", "missed"])))
    .where(and(eq(posts.socialConnectionId, connectionId), inArray(posts.status, ["scheduled", "queued", "publishing"])));
  let cancelled = 0;
  for (const post of pending) {
    try {
      if (post.scheduleId) {
        await cancelSchedule(userId, post.id, effects.scheduling);
      } else {
        await db
          .update(posts)
          .set({ status: "cancelled", errorCode: "user_removed_app", errorMessage: "The account was disconnected from Fannout.", updatedAt: new Date() })
          .where(and(eq(posts.id, post.id), inArray(posts.status, ["queued", "publishing"])));
        await effects.publishCancelled(post.id);
      }
      cancelled += 1;
    } catch (error) {
      // Already published/finished meanwhile: nothing to cancel.
      logger.warn("meta.cancel_post_skipped", { postId: post.id, message: (error as Error).message });
    }
  }
  return cancelled;
}

/**
 * The user removed Fannout in Facebook/Threads: tokens gone, connection disconnected
 * (reason user_removed_app), pending posts cancelled, the Fannout user notified.
 */
export async function handleDeauthorize(provider: MetaProvider, platformUserId: string, effects: MetaEffects) {
  const matches = await findMetaConnections(provider, platformUserId);
  const request = await recordDeletionRequest({
    provider,
    platformUserId,
    kind: "deauthorize",
    matchedConnectionIds: matches.map((m) => m.id),
    status: matches.length ? "processing" : "no_data",
  });
  let postsCancelled = 0;
  for (const conn of matches) {
    await db
      .update(socialConnections)
      .set({
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessExpiry: null,
        refreshExpiry: null,
        isActive: false,
        config: sql`coalesce(${socialConnections.config}, '{}'::jsonb) || ${JSON.stringify({ disconnectReason: "user_removed_app", disconnectedAt: new Date().toISOString() })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(socialConnections.id, conn.id));
    postsCancelled += await cancelPendingPosts(conn.id, conn.userId, effects);
  }
  // One notification per Fannout user (a Facebook user may have connected several Pages).
  for (const userId of new Set(matches.map((m) => m.userId))) {
    await effects.notify({
      userId,
      type: "connection_removed",
      title: `${PROVIDER_LABEL[provider]} disconnected`,
      body: `You removed Fannout from ${PROVIDER_LABEL[provider]}. Reconnect to keep posting.`,
      link: "/connections",
      dedupeId: `meta-deauthorize:${request.id}:${userId}`,
    });
  }
  if (matches.length) {
    await db
      .update(dataDeletionRequests)
      .set({ status: "completed", completedAt: new Date(), summary: { connections: matches.length, postsCancelled } })
      .where(eq(dataDeletionRequests.id, request.id));
  }
  logger.info("meta.deauthorize", { provider, requestId: request.id, connections: matches.length, postsCancelled });
  return { requestId: request.id, connections: matches.length };
}

/**
 * Data deletion (Inngest job). Deletes what came from Meta for the matched connections;
 * the user's Fannout account, captions and media library are NOT Meta data and stay.
 */
export async function runDataDeletion(requestId: string, effects: MetaEffects) {
  const [request] = await db.select().from(dataDeletionRequests).where(eq(dataDeletionRequests.id, z.uuid().parse(requestId))).limit(1);
  if (!request || request.status === "completed" || request.status === "no_data") return { skipped: true };
  const provider = MetaProviderSchema.parse(request.provider);
  // Re-match: connections made between the callback and now count too.
  const matches = await findMetaConnections(provider, request.platformUserId);
  const ids = [...new Set([...request.matchedConnectionIds, ...matches.map((m) => m.id)])];
  if (ids.length === 0) {
    await db.update(dataDeletionRequests).set({ status: "no_data", completedAt: new Date() }).where(eq(dataDeletionRequests.id, request.id));
    return { status: "no_data" as const };
  }
  await db.update(dataDeletionRequests).set({ status: "processing", matchedConnectionIds: ids }).where(eq(dataDeletionRequests.id, request.id));

  const summary = { connections: 0, postsCancelled: 0, postsCleared: 0, analyticsDailyRows: 0, analyticsSnapshots: 0 };
  const rows = await db.select().from(socialConnections).where(inArray(socialConnections.id, ids));
  for (const conn of rows) {
    summary.postsCancelled += await cancelPendingPosts(conn.id, conn.userId, effects);

    // Analytics obtained from Meta.
    summary.analyticsSnapshots += (await db.delete(analyticsPostSnapshots).where(eq(analyticsPostSnapshots.socialConnectionId, conn.id)).returning({ id: analyticsPostSnapshots.id })).length;
    summary.analyticsDailyRows += (await db.delete(analyticsAccountDaily).where(eq(analyticsAccountDaily.socialConnectionId, conn.id)).returning({ id: analyticsAccountDaily.id })).length;
    await db.delete(analyticsSyncState).where(eq(analyticsSyncState.socialConnectionId, conn.id));

    // Posts: keep the user's own content (name, caption, media); drop platform ids, links
    // and the raw platform responses kept in config.progress.
    summary.postsCleared += (
      await db
        .update(posts)
        .set({
          externalPostId: null,
          postUrl: null,
          externalStatus: "unknown",
          lastCheckedAt: null,
          config: sql`coalesce(${posts.config}, '{}'::jsonb) - 'progress'`,
          updatedAt: new Date(),
        })
        .where(eq(posts.socialConnectionId, conn.id))
        .returning({ id: posts.id })
    ).length;

    // Connection: tokens, scopes, profile and platform config gone; ids kept for audit; soft-deleted.
    const config = (conn.config ?? {}) as { facebookUser?: { id?: string }; facebookUserId?: string; page?: { id?: string } };
    const facebookUserId = config.facebookUserId ?? config.facebookUser?.id;
    await db
      .update(socialConnections)
      .set({
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessExpiry: null,
        refreshExpiry: null,
        scopes: null,
        username: null,
        displayName: null,
        profilePictureUrl: null,
        isActive: false,
        config: {
          ...(facebookUserId ? { facebookUserId } : {}),
          disconnectReason: "data_deleted",
          deletedAt: new Date().toISOString(),
          dataDeletionRequestId: request.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(socialConnections.id, conn.id));
    summary.connections += 1;
  }

  await db.update(dataDeletionRequests).set({ status: "completed", completedAt: new Date(), summary }).where(eq(dataDeletionRequests.id, request.id));
  logger.info("meta.data_deletion_completed", { provider, requestId: request.id, ...summary });
  return { status: "completed" as const, summary };
}

/** Public status page lookup — no personal data. */
export async function deletionStatusByCode(code: string) {
  if (!/^[A-Za-z0-9]{16}$/.test(code)) return null;
  const [row] = await db
    .select({
      provider: dataDeletionRequests.provider,
      status: dataDeletionRequests.status,
      requestedAt: dataDeletionRequests.requestedAt,
      completedAt: dataDeletionRequests.completedAt,
    })
    .from(dataDeletionRequests)
    .where(and(eq(dataDeletionRequests.confirmationCode, code), eq(dataDeletionRequests.kind, "deletion")))
    .limit(1);
  if (!row) return null;
  return {
    provider: MetaProviderSchema.catch("facebook").parse(row.provider),
    status: DeletionStatusSchema.catch("received").parse(row.status),
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export { verifySignedRequest } from "./signed-request";
