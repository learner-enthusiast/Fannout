import { db, eq, posts, sql } from "@repo/database";
import { logger } from "@repo/logger";
import { z } from "zod";
import type { MediaRow } from "../../media/model";
import { PermanentPublishError } from "../errors";
import type { PublishContext } from "../publishers/types";
import { storedSize } from "./chunk-reader";

export const UploadPlatformSchema = z.enum(["youtube", "linkedin", "x"]);
export type UploadPlatform = z.infer<typeof UploadPlatformSchema>;

export const UploadPhaseSchema = z.enum(["init", "uploading", "processing", "ready", "posted", "failed"]);
export type UploadPhase = z.infer<typeof UploadPhaseSchema>;

/**
 * Resume state for one large upload, at posts.config.progress[platform].
 * Every network step loads it, acts, and saves it before returning, so an
 * Inngest retry continues where the last one stopped.
 */
export const UploadProgressSchema = z.object({
  platform: UploadPlatformSchema,
  mediaId: z.string(),
  totalBytes: z.number().int().positive(),
  mimeType: z.string(),
  /** YouTube session URI | LinkedIn asset URN | X media_id. */
  sessionRef: z.string().nullable().default(null),
  /** LinkedIn: part URLs + inclusive byte ranges (a single upload is one "part"). */
  uploadUrls: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        url: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        headers: z.record(z.string(), z.string()).default({}),
        /** LinkedIn part URL expiry (epoch ms), when given. */
        urlExpiresAt: z.number().nullable().optional(),
      }),
    )
    .optional(),
  /** LinkedIn completion data from registerUpload. */
  uploadKind: z.enum(["single", "multipart"]).nullable().optional(),
  mediaArtifact: z.string().nullable().optional(),
  uploadMetadata: z.string().nullable().optional(),
  /** YouTube: bytes the server confirmed (from its Range header). */
  confirmedBytes: z.number().int().nonnegative().default(0),
  /** X: next APPEND segment_index and the segment size used for this media_id. */
  nextSegmentIndex: z.number().int().nonnegative().default(0),
  segmentBytes: z.number().int().positive().optional(),
  /** LinkedIn: ETag per uploaded part, sorted by partNumber. */
  partEtags: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string() })).default([]),
  /** YouTube videoId / LinkedIn asset / X media_id once the bytes are complete. */
  externalVideoId: z.string().nullable().optional(),
  /** X media_key (used to find a post whose create response was lost). */
  mediaKey: z.string().nullable().optional(),
  phase: UploadPhaseSchema.default("init"),
  pollCount: z.number().int().nonnegative().default(0),
  processingStartedAt: z.string().nullable().default(null),
  startedAt: z.string(),
  updatedAt: z.string(),
  sessionCreatedAt: z.string().nullable().default(null),
  attemptsNewSession: z.number().int().nonnegative().default(0),
  /** YouTube extras. */
  uploadedPrivacy: z.string().optional(),
  thumbnailSet: z.boolean().optional(),
  playlistAdded: z.boolean().optional(),
  warning: z.string().optional(),
});
export type UploadProgress = z.infer<typeof UploadProgressSchema>;
export type UploadProgressPatch = Partial<Omit<UploadProgress, "platform" | "updatedAt">>;

/** Current progress from the context (null when absent or unreadable). */
export function readUploadProgress(ctx: PublishContext, platform: UploadPlatform): UploadProgress | null {
  const parsed = UploadProgressSchema.safeParse(ctx.progress[platform]);
  return parsed.success ? parsed.data : null;
}

/**
 * Atomic JSONB merge into posts.config.progress[platform] (no read-modify-
 * write of the whole config). Returns the merged, parsed progress and mirrors
 * it into ctx.progress.
 */
export async function saveUploadProgress(
  ctx: PublishContext,
  platform: UploadPlatform,
  patch: UploadProgressPatch & { platform?: UploadPlatform },
): Promise<UploadProgress> {
  const json = JSON.stringify({ ...patch, platform, updatedAt: new Date().toISOString() });
  const [row] = await db
    .update(posts)
    .set({
      config: sql`jsonb_set(
        coalesce(${posts.config}, '{}'::jsonb),
        '{progress}',
        coalesce(${posts.config}->'progress', '{}'::jsonb)
          || jsonb_build_object(${platform}::text, coalesce(${posts.config}->'progress'->${platform}::text, '{}'::jsonb) || ${json}::jsonb)
      )`,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, ctx.postId))
    .returning({ progress: sql<unknown>`${posts.config}->'progress'->${platform}::text` });
  const progress = UploadProgressSchema.parse(row?.progress);
  ctx.progress[platform] = progress;
  return progress;
}

/** Start (or restart after a failed attempt / different media) the progress for `item`. */
export async function ensureUploadProgress(ctx: PublishContext, platform: UploadPlatform, item: MediaRow): Promise<UploadProgress> {
  const current = readUploadProgress(ctx, platform);
  if (current && current.phase !== "failed" && current.mediaId === item.id) return current;
  const now = new Date().toISOString();
  const fresh: UploadProgress = UploadProgressSchema.parse({
    platform,
    mediaId: item.id,
    totalBytes: await storedSize(item),
    mimeType: item.mimeType,
    startedAt: now,
    updatedAt: now,
  });
  // Replace wholesale so no stale session/ETags from a failed attempt survive.
  await db
    .update(posts)
    .set({
      config: sql`jsonb_set(
        coalesce(${posts.config}, '{}'::jsonb),
        '{progress}',
        coalesce(${posts.config}->'progress', '{}'::jsonb) || jsonb_build_object(${platform}::text, ${JSON.stringify(fresh)}::jsonb)
      )`,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, ctx.postId));
  ctx.progress[platform] = fresh;
  logUploadEvent(ctx, platform, "upload_started", { totalBytes: fresh.totalBytes, restartedAfterFailure: Boolean(current) });
  return fresh;
}

/**
 * The platform lost our session (expired / unknown). Allowed once per post;
 * the second time the upload fails for good.
 */
export async function restartUploadSession(ctx: PublishContext, progress: UploadProgress, reason: string): Promise<UploadProgress> {
  if (progress.attemptsNewSession >= 1) {
    await saveUploadProgress(ctx, progress.platform, { phase: "failed" });
    logUploadEvent(ctx, progress.platform, "upload_failed", { reason: "session_lost_twice" });
    throw new PermanentPublishError("upload_session_lost", "The upload session was lost twice. Try publishing again later.");
  }
  logUploadEvent(ctx, progress.platform, "session_restarted", { reason });
  return saveUploadProgress(ctx, progress.platform, {
    sessionRef: null,
    sessionCreatedAt: null,
    uploadUrls: [],
    uploadKind: null,
    mediaArtifact: null,
    uploadMetadata: null,
    confirmedBytes: 0,
    nextSegmentIndex: 0,
    partEtags: [],
    externalVideoId: null,
    mediaKey: null,
    phase: "init",
    pollCount: 0,
    processingStartedAt: null,
    attemptsNewSession: progress.attemptsNewSession + 1,
  });
}

/** Mark the upload failed (so a manual retry starts clean) and stop without retrying. */
export async function failUpload(ctx: PublishContext, platform: UploadPlatform, code: string, message: string): Promise<never> {
  await saveUploadProgress(ctx, platform, { phase: "failed" });
  logUploadEvent(ctx, platform, "upload_failed", { code });
  throw new PermanentPublishError(code, message);
}

/**
 * Structured phase/cost event. There is no post_events table yet, so these go
 * to the log (ids and counts only — never tokens or signed URLs).
 */
export function logUploadEvent(ctx: PublishContext, platform: UploadPlatform, event: string, data: Record<string, unknown> = {}) {
  logger.info(`publish.${platform}.${event}`, { postId: ctx.postId, platform, event, ...data });
}

/** Result of one prepare step: done, or the id of the next step (and an optional sleep before it). */
export type PrepareStep = { done: true } | { done: false; next: string; waitSeconds?: number };

export const elapsedSince = (iso: string | null | undefined) => (iso ? Date.now() - Date.parse(iso) : 0);
