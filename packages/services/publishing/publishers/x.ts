import { ProviderError, type XProvider } from "@repo/providers";
import {
  X_MAX_SEGMENTS,
  X_MAX_SEGMENT_BYTES,
  X_MEDIA_TTL_SECONDS,
  X_VIDEO_MAX_BYTES,
  X_VIDEO_MAX_SECONDS,
  type XComposeInput,
} from "@repo/providers/x";
import { PermanentPublishError } from "../errors";
import { readRange } from "../upload/chunk-reader";
import { UPLOAD_CONFIG } from "../upload/config";
import {
  elapsedSince,
  ensureUploadProgress,
  failUpload,
  logUploadEvent,
  readUploadProgress,
  restartUploadSession,
  saveUploadProgress,
  type PrepareStep,
  type UploadProgress,
} from "../upload/progress";
import { streamSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const X_MEDIA_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "image/jpeg", "image/gif", "image/png", "image/webp"]);
const X_WRITE_SCOPES = ["tweet.write", "media.write"] as const;
export const X_RECONNECT_MESSAGE = "Reconnect X to allow posting";

/** Stored grants made before write scopes were requested can never publish. */
export class XWriteScopeError extends Error {
  readonly code = "missing_write_scope";
  constructor() {
    super(X_RECONNECT_MESSAGE);
  }
}

function assertCanPost(ctx: PublishContext) {
  const scopes = ctx.connection.scopes ?? [];
  if (X_WRITE_SCOPES.some((scope) => !scopes.includes(scope))) throw new XWriteScopeError();
}
/** Re-initialize a media id this close to its expiry rather than post with it. */
const MEDIA_ID_SAFETY_MS = 4 * 60 * 60 * 1000;

const statusUrl = (id: string, username: string | null | undefined) =>
  username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;

/**
 * Videos: INITIALIZE (media_id saved first) → APPEND one segment per request,
 * as many per step as fit the step budget → FINALIZE → STATUS polls as their
 * own steps. Images/GIFs keep the one-step upload. finalize: create the post
 * exactly once (it costs money), recovering a lost create response by
 * looking the post up instead of posting blindly again.
 */
export const xPublisher: Publisher<XProvider> = {
  async prepare(provider, ctx): Promise<PrepareStep | void> {
    assertCanPost(ctx);
    if (ctx.progress.externalPostId) return;
    if (ctx.mediaType !== "video") {
      await uploadAll(provider, ctx);
      return;
    }
    // Uploaded by the pre-chunking flow.
    if ((ctx.progress.mediaIds as string[] | undefined)?.[0] && !ctx.progress.x) return;
    return videoStep(provider, ctx);
  },

  async finalize(provider, ctx) {
    assertCanPost(ctx);
    const input = ctx.input as XComposeInput;
    const username = ctx.connection.username;
    const existing = ctx.progress.externalPostId as string | undefined;
    if (existing) return { externalPostId: existing, postUrl: statusUrl(existing, username) };

    let mediaIds: string[];
    let mediaKey: string | null = null;
    if (ctx.mediaType === "video") {
      const progress = readUploadProgress(ctx, "x");
      if (progress) {
        if (progress.phase !== "ready" && progress.phase !== "posted") throw new Error("X video upload hasn't finished yet");
        mediaIds = [progress.externalVideoId ?? progress.sessionRef!];
        mediaKey = progress.mediaKey ?? null;
      } else {
        mediaIds = (ctx.progress.mediaIds as string[] | undefined) ?? [];
        if (!mediaIds[0]) throw new Error("X video upload hasn't finished yet");
      }
    } else {
      // X media ids expire (~24 h): if the upload is older than 20 h, upload again.
      const uploadedAt = ctx.progress.mediaUploadedAt as string | undefined;
      if (uploadedAt && Date.now() - Date.parse(uploadedAt) > 20 * 60 * 60 * 1000) await ctx.save({ mediaIds: [], mediaUploadedAt: null });
      mediaIds = await uploadAll(provider, ctx);
    }

    // A previous attempt may have created the post and lost the response: look before posting again.
    const attempts = Number(ctx.progress.createAttempts ?? 0);
    if (attempts >= 1) {
      const found = await findCreatedPost(provider, ctx, input, mediaKey);
      if (found) {
        await ctx.save({ externalPostId: found }, "Posted");
        logUploadEvent(ctx, "x", "post_recovered", { tweetId: found });
        return { externalPostId: found, postUrl: statusUrl(found, username) };
      }
      if (attempts >= 2) {
        throw new PermanentPublishError("possible_duplicate", "X didn't confirm the post twice. Check your profile before retrying.");
      }
    }

    await ctx.save({ createAttempts: attempts + 1, createAttemptedAt: new Date().toISOString() }, "Creating post");
    let id: string;
    try {
      const created = await provider.createPost({
        ...(input.text?.trim() ? { text: input.text } : {}),
        media: { mediaIds },
        ...(input.replySettings && input.replySettings !== "everyone" ? { replySettings: input.replySettings } : {}),
        ...(input.madeWithAi ? { madeWithAi: true } : {}),
        ...(input.paidPartnership ? { paidPartnership: true } : {}),
      });
      id = created.data.id;
    } catch (error) {
      // Definite rejection (4xx incl. 429): nothing was created, so it doesn't count as an attempt.
      if (error instanceof ProviderError && error.status !== null && error.status < 500) await ctx.save({ createAttempts: attempts });
      throw error;
    }
    // Saved before anything else: createPost isn't idempotent.
    await ctx.save({ externalPostId: id }, "Posted");
    logUploadEvent(ctx, "x", "cost_post_created", { tweetId: id, mediaCount: mediaIds.length });
    if (readUploadProgress(ctx, "x")) await saveUploadProgress(ctx, "x", { phase: "posted" });
    return { externalPostId: id, postUrl: statusUrl(id, username) };
  },
};

/** Recent posts since the first create attempt, matched by attached media key (video) or exact text. */
async function findCreatedPost(provider: XProvider, ctx: PublishContext, input: XComposeInput, mediaKey: string | null): Promise<string | null> {
  const since = Date.parse((ctx.progress.createAttemptedAt as string | undefined) ?? new Date(Date.now() - 60 * 60_000).toISOString());
  const page = await provider.getUserPosts({
    maxResults: 5,
    postFields: ["attachments", "created_at", "text"],
    startTime: new Date(since - 2 * 60_000).toISOString(),
  });
  const text = input.text?.trim();
  const match = page.items.find((post) => {
    const keys = (post as { attachments?: { mediaKeys?: string[] } }).attachments?.mediaKeys ?? [];
    if (mediaKey) return keys.includes(mediaKey);
    return Boolean(text) && post.text?.trim() === text && keys.length > 0;
  });
  return match?.id ?? null;
}

async function videoStep(provider: XProvider, ctx: PublishContext): Promise<PrepareStep> {
  const item = ctx.media[0]!;
  if (!X_MEDIA_TYPES.has(item.mimeType)) throw new PermanentPublishError("VALIDATION", `X can't take ${item.mimeType} files`);
  let progress = await ensureUploadProgress(ctx, "x", item);

  // Fail fast, before INITIALIZE: X's ceiling (Premium) and what 1 000 segments of ≤ 5 MB can carry.
  if (progress.totalBytes > Math.min(X_VIDEO_MAX_BYTES, X_MAX_SEGMENTS * X_MAX_SEGMENT_BYTES)) {
    return failUpload(ctx, "x", "VALIDATION", "This video is too large for X.");
  }
  if (item.durationSeconds && item.durationSeconds > X_VIDEO_MAX_SECONDS) {
    return failUpload(ctx, "x", "VALIDATION", "This video is longer than X allows (125 minutes).");
  }

  // Media ids live ~24 h. A long-lived scheduled upload re-initializes (once) instead of posting a dead id.
  if (progress.sessionRef && elapsedSince(progress.sessionCreatedAt) > X_MEDIA_TTL_SECONDS * 1000 - MEDIA_ID_SAFETY_MS) {
    progress = await restartUploadSession(ctx, progress, "x_media_id_expiring");
  }

  if (progress.phase === "init") progress = await initialize(provider, ctx, progress);
  if (progress.phase === "uploading") return appendSegments(provider, ctx, progress);
  if (progress.phase === "processing") return pollStatus(provider, ctx, progress);
  return { done: true };
}

async function initialize(provider: XProvider, ctx: PublishContext, progress: UploadProgress): Promise<UploadProgress> {
  await ctx.save({}, "Uploading video to X");
  // Smallest segment size (≥ 4 MiB) that keeps segment_index ≤ 999.
  const segmentBytes = Math.max(UPLOAD_CONFIG.X_SEGMENT_BYTES, Math.ceil(progress.totalBytes / X_MAX_SEGMENTS));
  const init = await provider.initializeMediaUpload({
    mediaType: progress.mimeType as never,
    totalBytes: progress.totalBytes,
    mediaCategory: "tweet_video",
  });
  const mediaId = init.data?.id;
  if (!mediaId) throw new Error("X returned no media id");
  const saved = await saveUploadProgress(ctx, "x", {
    sessionRef: mediaId,
    mediaKey: init.data?.mediaKey ?? null,
    sessionCreatedAt: new Date().toISOString(),
    segmentBytes,
    nextSegmentIndex: 0,
    phase: "uploading",
  });
  logUploadEvent(ctx, "x", "cost_media_initialized", { mediaId, totalBytes: progress.totalBytes });
  return saved;
}

/** Unknown/expired media id. */
const isLostMedia = (error: unknown) => error instanceof ProviderError && error.status === 404;

async function appendSegments(provider: XProvider, ctx: PublishContext, start: UploadProgress): Promise<PrepareStep> {
  let progress = start;
  const segmentBytes = progress.segmentBytes ?? UPLOAD_CONFIG.X_SEGMENT_BYTES;
  const segments = Math.ceil(progress.totalBytes / segmentBytes);
  const began = Date.now();

  while (progress.nextSegmentIndex < segments) {
    if (Date.now() - began > UPLOAD_CONFIG.STEP_BUDGET_MS) {
      await ctx.save({}, `Uploading video to X (${Math.floor((progress.nextSegmentIndex / segments) * 100)}%)`);
      return { done: false, next: `x-segment-${progress.nextSegmentIndex}` };
    }
    const index = progress.nextSegmentIndex;
    const startByte = index * segmentBytes;
    const data = await readRange(ctx.media[0]!, startByte, Math.min(startByte + segmentBytes, progress.totalBytes) - 1);
    try {
      // Re-sending an index after a lost response replaces that segment (same bytes), so retries are safe.
      await provider.appendMediaUpload({ mediaId: progress.sessionRef!, segmentIndex: index, data });
    } catch (error) {
      if (!isLostMedia(error)) throw error; // transient → the step retries from nextSegmentIndex
      progress = await restartUploadSession(ctx, progress, "x_media_id_unknown");
      return { done: false, next: `x-init-${progress.attemptsNewSession}` };
    }
    progress = await saveUploadProgress(ctx, "x", { nextSegmentIndex: index + 1 });
  }

  let status;
  try {
    status = await provider.finalizeMediaUpload(progress.sessionRef!);
  } catch (error) {
    if (isLostMedia(error)) {
      progress = await restartUploadSession(ctx, progress, "x_media_id_unknown");
      return { done: false, next: `x-init-${progress.attemptsNewSession}` };
    }
    // FINALIZE may have succeeded with the response lost; STATUS tells us where it is.
    if (!(error instanceof ProviderError && (error.status === 400 || error.status === 409))) throw error;
    status = await provider.getMediaUploadStatus(progress.sessionRef!);
  }
  logUploadEvent(ctx, "x", "cost_media_uploaded", { mediaId: progress.sessionRef, segments });
  return afterStatus(ctx, progress, status.data?.processingInfo, true);
}

async function pollStatus(provider: XProvider, ctx: PublishContext, progress: UploadProgress): Promise<PrepareStep> {
  let status;
  try {
    status = await provider.getMediaUploadStatus(progress.sessionRef!);
  } catch (error) {
    if (!isLostMedia(error)) throw error;
    const restarted = await restartUploadSession(ctx, progress, "x_media_id_unknown");
    return { done: false, next: `x-init-${restarted.attemptsNewSession}` };
  }
  return afterStatus(ctx, progress, status.data?.processingInfo, false);
}

async function afterStatus(
  ctx: PublishContext,
  progress: UploadProgress,
  info: { state?: string; checkAfterSecs?: number; error?: { message?: string } } | undefined,
  justFinalized: boolean,
): Promise<PrepareStep> {
  const base = { externalVideoId: progress.sessionRef, ...(justFinalized ? { processingStartedAt: new Date().toISOString(), pollCount: 0 } : {}) };
  if (!info || info.state === "succeeded") {
    await saveUploadProgress(ctx, "x", { ...base, phase: "ready" });
    await ctx.save({ mediaIds: [progress.sessionRef], mediaUploadedAt: progress.sessionCreatedAt }, "Video uploaded to X");
    return { done: true };
  }
  if (info.state === "failed") {
    return failUpload(ctx, "x", "x_processing_failed", `X couldn't process the video${info.error?.message ? `: ${info.error.message}` : "."}`);
  }
  const startedAt = justFinalized ? new Date().toISOString() : progress.processingStartedAt;
  if (!justFinalized && elapsedSince(startedAt) > UPLOAD_CONFIG.PROCESSING_CAP_MS.x) {
    return failUpload(ctx, "x", "x_processing_timeout", "X processing timeout: X took too long to process the video.");
  }
  const pollCount = justFinalized ? 0 : progress.pollCount + 1;
  await saveUploadProgress(ctx, "x", { ...base, phase: "processing", pollCount });
  await ctx.save({}, "X is processing the video");
  const wait = Math.min(60, Math.max(1, info.checkAfterSecs ?? 5));
  return { done: false, next: `x-processing-${pollCount}`, waitSeconds: wait };
}

async function uploadAll(provider: XProvider, ctx: PublishContext): Promise<string[]> {
  const mediaIds = [...((ctx.progress.mediaIds as string[] | undefined) ?? [])];
  for (const [index, item] of ctx.media.entries()) {
    if (mediaIds[index]) continue;
    if (!X_MEDIA_TYPES.has(item.mimeType)) throw new Error(`X can't take ${item.mimeType} files`);
    await ctx.save({}, `Uploading media ${index + 1} of ${ctx.media.length} to X`);
    const uploaded = await provider.uploadMediaChunked({
      source: await streamSource(item),
      mediaType: item.mimeType as never,
      mediaCategory: item.type === "video" ? "tweet_video" : item.mimeType === "image/gif" ? "tweet_gif" : "tweet_image",
    });
    mediaIds[index] = uploaded.mediaId;
    await ctx.save({ mediaIds, ...(ctx.progress.mediaUploadedAt ? {} : { mediaUploadedAt: new Date().toISOString() }) }, `Uploaded media ${index + 1} of ${ctx.media.length}`);
  }
  return mediaIds;
}
