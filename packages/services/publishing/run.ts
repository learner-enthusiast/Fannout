import { and, asc, db, eq, inArray, isNull, media, postMedia, posts, socialConnections, sql } from "@repo/database";
import { AppError } from "@repo/errors";
import {
  FacebookProvider,
  LinkedInProvider,
  ProviderError,
  ThreadsProvider,
  XProvider,
  YouTubeProvider,
} from "@repo/providers";
import { ZodError } from "zod";
import { MediaRowSchema, type MediaRow } from "../media/model";
import { createProviderForConnection } from "../provider-factory";
import { SocialConnectionRowSchema } from "../social-connections/model";
import { updateSocialConnection } from "../social-connections";
import { PostConfigSchema, TERMINAL_STATUSES } from "./model";
import { PLATFORMS } from "./platforms";
import { failSchedule } from "../scheduling";
import { FacebookPublishError, MISSING_VIDEO_PERMISSION_MESSAGE, facebookPublisher } from "./publishers/facebook";
import { LINKEDIN_MISSING_SHARE_MESSAGE, LinkedInPublishError, linkedinPublisher } from "./publishers/linkedin";
import { threadsPublisher } from "./publishers/threads";
import type { PublishContext, PublishOutcome, Publisher } from "./publishers/types";
import { xPublisher } from "./publishers/x";
import { youtubePublisher } from "./publishers/youtube";

export type ErrorKind = "auth" | "permanent" | "transient";


/** Auth → reconnect + fail; permanent (validation, bad request…) → fail; else retry. */
export function classifyPublishError(error: unknown): { kind: ErrorKind; code: string; message: string } {
  const message = (error instanceof Error && error.message ? error.message : "Publishing failed").slice(0, 500);
  if (error instanceof FacebookPublishError) return { kind: "permanent", code: error.code, message: error.message };
  if (error instanceof LinkedInPublishError) return { kind: "permanent", code: error.code, message: error.message };
  if (error instanceof ProviderError) {
    // "(#100) No permission to publish the video" (also #200 publish_video): permission, not a glitch.
    if (error.provider === "FACEBOOK" && /permission to publish the video|publish_video/i.test(error.message)) {
      return { kind: "permanent", code: "missing_video_permission", message: MISSING_VIDEO_PERMISSION_MESSAGE };
    }
    // "Not enough permissions to access: assets.ACTION-registerUpload…" = token lacks w_member_social.
    if (error.provider === "LINKEDIN" && error.code === "FORBIDDEN" && /not enough permissions/i.test(error.message)) {
      return { kind: "permanent", code: "missing_post_permission", message: LINKEDIN_MISSING_SHARE_MESSAGE };
    }
    if (error.code === "UNAUTHORIZED") return { kind: "auth", code: error.code, message };
    if (error.retryable || ["RATE_LIMITED", "NETWORK", "TIMEOUT"].includes(error.code)) {
      return { kind: "transient", code: error.code, message };
    }
    if (error.code === "PROVIDER_ERROR" && (error.status ?? 500) >= 500) return { kind: "transient", code: error.code, message };
    return { kind: "permanent", code: error.code, message };
  }
  if (error instanceof AppError) {
    const details = error.details as { reason?: string } | undefined;
    if (details?.reason === "reconnect_required") return { kind: "auth", code: "RECONNECT_REQUIRED", message };
    return { kind: "permanent", code: error.code, message };
  }
  if (error instanceof ZodError) return { kind: "permanent", code: "VALIDATION", message };
  return { kind: "transient", code: "UNKNOWN", message };
}

export class PermanentPublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function loadPost(postId: string) {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  return row ?? null;
}

async function saveConfigProgress(postId: string, patch: Record<string, unknown>, step?: string) {
  const row = await loadPost(postId);
  if (!row) return;
  const config = PostConfigSchema.parse(row.config);
  await db
    .update(posts)
    .set({
      config: { ...config, progress: { ...config.progress, ...patch, ...(step ? { step } : {}) } },
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));
}

/**
 * queued/scheduled → publishing. Returns null when the post is already
 * finished or already has a platform id (event replay). A scheduled run only
 * claims when its scheduleVersion is the live, handed_off one — checked in
 * the same UPDATE, so a stale run can't touch a rescheduled post.
 */
export async function claimPost(postId: string, scheduleVersion?: number | null) {
  const [row] = await db
    .update(posts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        inArray(posts.status, scheduleVersion == null ? ["queued", "publishing"] : ["scheduled", "publishing"]),
        isNull(posts.externalPostId),
        scheduleVersion == null
          ? undefined
          : sql`exists (select 1 from scheduled_posts s where s.post_id = ${posts.id} and s.schedule_version = ${scheduleVersion} and s.status = 'handed_off')`,
      ),
    )
    .returning({ id: posts.id, batchId: posts.batchId, userId: posts.userId, socialConnectionId: posts.socialConnectionId });
  return row ?? null;
}

export async function markPostFailed(postId: string, code: string, message: string) {
  await db
    .update(posts)
    .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(posts.id, postId));
  await saveConfigProgress(postId, {}, "Failed");
  await failSchedule(postId, message);
}

/** Status-page step only (e.g. while sleeping until the scheduled time). */
export async function setPostStep(postId: string, step: string) {
  await saveConfigProgress(postId, {}, step);
}

/** Mirrors toSocialConnectionView: no token → "reconnect required". */
export async function markNeedsReconnect(userId: string, connectionId: string) {
  await updateSocialConnection(userId, connectionId, {
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessExpiry: null,
    refreshExpiry: null,
  });
}

async function loadMedia(postId: string): Promise<{ media: MediaRow[]; thumbnail: MediaRow | null }> {
  const rows = await db
    .select({ link: postMedia, row: media })
    .from(postMedia)
    .innerJoin(media, eq(media.id, postMedia.mediaId))
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position));
  const thumb = rows.find((r) => r.link.role === "thumbnail");
  return {
    media: rows.filter((r) => r.link.role !== "thumbnail").map((r) => MediaRowSchema.parse(r.row)),
    thumbnail: thumb ? MediaRowSchema.parse(thumb.row) : null,
  };
}

export type PublishPhase = "prepare" | "finalize";

function publisherFor(provider: unknown): { run: (phase: PublishPhase, ctx: PublishContext) => Promise<PublishOutcome | void> } | null {
  const wrap = <P>(publisher: Publisher<P>, p: P) => ({
    run: (phase: PublishPhase, ctx: PublishContext) => (phase === "prepare" ? publisher.prepare(p, ctx) : publisher.finalize(p, ctx)),
  });
  if (provider instanceof YouTubeProvider) return wrap(youtubePublisher, provider);
  if (provider instanceof XProvider) return wrap(xPublisher, provider);
  if (provider instanceof LinkedInProvider) return wrap(linkedinPublisher, provider);
  if (provider instanceof ThreadsProvider) return wrap(threadsPublisher, provider);
  if (provider instanceof FacebookProvider) return wrap(facebookPublisher, provider);
  return null;
}

/**
 * Runs one publishing phase with the platform's existing provider.
 * prepare = uploads/processing (nothing public); finalize = make it live and
 * mark the post published. Permanent and auth errors mark the post failed
 * and throw PermanentPublishError (don't retry); anything else is rethrown
 * so Inngest retries — resume data in posts.config.progress keeps retries
 * from re-uploading.
 */
export async function runPublishPhase(postId: string, phase: "prepare", options?: { scheduled?: boolean }): Promise<null>;
export async function runPublishPhase(postId: string, phase: "finalize", options?: { scheduled?: boolean }): Promise<PublishOutcome>;
export async function runPublishPhase(postId: string, phase: PublishPhase, options: { scheduled?: boolean } = {}): Promise<PublishOutcome | null> {
  const post = await loadPost(postId);
  if (!post) throw new PermanentPublishError("NOT_FOUND", "Post not found");
  const config = PostConfigSchema.parse(post.config);
  const [connectionRow] = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.id, post.socialConnectionId), eq(socialConnections.userId, post.userId)))
    .limit(1);

  try {
    if (!connectionRow) throw new PermanentPublishError("NOT_FOUND", "The account was removed");
    const connection = SocialConnectionRowSchema.parse(connectionRow);
    const input = PLATFORMS[config.platform].schema.parse(config.input) as Record<string, unknown>;
    const { media: items, thumbnail } = await loadMedia(post.id);
    const ctx: PublishContext = {
      userId: post.userId,
      connection,
      input,
      mediaType: config.mediaType,
      media: items,
      thumbnail,
      progress: config.progress,
      save: async (patch, step) => {
        Object.assign(ctx.progress, patch);
        await saveConfigProgress(post.id, patch, step);
      },
      scheduled: Boolean(options.scheduled),
    };
    const provider = await createProviderForConnection({ userId: post.userId, connectionId: connection.id });
    const publisher = publisherFor(provider);
    if (!publisher) throw new PermanentPublishError("UNSUPPORTED", "This platform can't be published to yet");

    if (phase === "prepare") {
      await publisher.run("prepare", ctx);
      return null;
    }
    const outcome = (await publisher.run("finalize", ctx)) as PublishOutcome;

    await db
      .update(posts)
      .set({
        status: "published",
        externalPostId: outcome.externalPostId,
        postUrl: outcome.postUrl,
        publishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    await saveConfigProgress(post.id, {}, "Published");
    return outcome;
  } catch (error) {
    if (error instanceof PermanentPublishError) {
      await markPostFailed(post.id, error.code, error.message);
      throw error;
    }
    const { kind, code, message } = classifyPublishError(error);
    if (kind === "transient") {
      await saveConfigProgress(post.id, {}, `Retrying: ${message.slice(0, 120)}`);
      throw error;
    }
    if (kind === "auth") await markNeedsReconnect(post.userId, post.socialConnectionId);
    await markPostFailed(post.id, code, kind === "auth" ? `Reconnect this account: ${message}` : message);
    throw new PermanentPublishError(code, message);
  }
}

export async function postSummary(postId: string) {
  const row = await loadPost(postId);
  if (!row) return null;
  const config = PostConfigSchema.safeParse(row.config);
  return {
    id: row.id,
    userId: row.userId,
    batchId: row.batchId,
    status: row.status,
    postUrl: row.postUrl,
    errorMessage: row.errorMessage,
    platform: config.success ? config.data.platform : null,
  };
}

/** Counts for a batch; `finished` once every post is published/failed/cancelled. */
export async function batchProgress(batchId: string) {
  const rows = await db.select({ status: posts.status, userId: posts.userId }).from(posts).where(eq(posts.batchId, batchId));
  const published = rows.filter((r) => r.status === "published").length;
  return {
    userId: rows[0]?.userId ?? null,
    total: rows.length,
    published,
    finished: rows.length > 0 && rows.every((r) => (TERMINAL_STATUSES as readonly string[]).includes(r.status)),
  };
}

export async function queuedPostsInBatch(batchId: string) {
  return db
    .select({ id: posts.id, userId: posts.userId, socialConnectionId: posts.socialConnectionId })
    .from(posts)
    .where(and(eq(posts.batchId, batchId), eq(posts.status, "queued")));
}

// ---------------------------------------------------------------------------
// Read-only lookups for the composer (backend proxies the platform)
// ---------------------------------------------------------------------------

async function youtubeFor(userId: string, connectionId: string) {
  const provider = await createProviderForConnection({ userId, connectionId });
  if (!(provider instanceof YouTubeProvider)) throw new PermanentPublishError("BAD_REQUEST", "Not a YouTube account");
  return provider;
}

export async function listYouTubePlaylists(userId: string, connectionId: string) {
  const youtube = await youtubeFor(userId, connectionId);
  const result = await youtube.listPlaylist({ part: ["snippet"], mine: true, maxResults: 50 });
  return (result.items ?? [])
    .filter((item) => item.id)
    .map((item) => ({ id: item.id!, title: item.snippet?.title ?? "Untitled playlist" }));
}

export async function listYouTubeCategories(userId: string, connectionId: string, regionCode = "US") {
  const youtube = await youtubeFor(userId, connectionId);
  const result = await youtube.listVideoCategories({ part: ["snippet"], regionCode });
  return (result.items ?? [])
    .filter((item) => item.id && item.snippet?.assignable)
    .map((item) => ({ id: item.id!, title: item.snippet?.title ?? item.id! }));
}
