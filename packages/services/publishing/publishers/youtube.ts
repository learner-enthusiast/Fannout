import { utf8Length, type YouTubeProvider } from "@repo/providers";
import { YOUTUBE_COMPOSE, type YouTubeComposeInput, type YouTubeRelatedVideo } from "@repo/providers/youtube";
import { readRange } from "../upload/chunk-reader";
import { UPLOAD_CONFIG, pollDelaySeconds } from "../upload/config";
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

/** Same limit as the compose model's description field. */
const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
const shortUrl = (videoId: string) => `https://youtu.be/${videoId}`;
const CHUNK = UPLOAD_CONFIG.YOUTUBE_CHUNK_BYTES;

/**
 * prepare (one Inngest step per call):
 *   init → open a resumable session (saved before any bytes)
 *   uploading → ask the server how much it has, then PUT 8 MiB chunks until the step budget is used
 *   processing → poll videos.list with backoff (cap 30 min; never re-upload)
 * Scheduled posts upload as PRIVATE so nothing is public before the time.
 * finalize: privacy flip (full status resent), thumbnail + playlist as warnings.
 */
/** Vertical and at most the Shorts length: YouTube publishes it as a Short. */
export function isYouTubeShort(ctx: Pick<PublishContext, "media">): boolean {
  const video = ctx.media[0];
  const max = YOUTUBE_COMPOSE.mediaRules.shortMaxSeconds;
  return Boolean(video && max && video.metadata?.orientation === "portrait" && (video.durationSeconds ?? Infinity) <= max);
}

export const watchNextLine = (related: Pick<YouTubeRelatedVideo, "videoId" | "title">) =>
  `Watch next: ${related.title.replace(/[<>]/g, "")} https://youtu.be/${related.videoId}`;

/**
 * Long-form only: "Watch next: <title> https://youtu.be/<id>" just above the hashtags line.
 * Never on Shorts (description links aren't clickable there), never twice, and never when it
 * would push the description over the limit — the follow-up task covers that case.
 */
export function withWatchNext(description: string, related: YouTubeRelatedVideo | undefined, short: boolean): { description: string; added: boolean } {
  if (!related || related.watchNext === false || short) return { description, added: false };
  if (description.includes(`youtu.be/${related.videoId}`) || description.includes(`v=${related.videoId}`)) return { description, added: true };
  const lines = description.trimEnd().split("\n");
  const hashtags = lines.length && /^(#[\p{L}\p{N}_]+\s*)+$/u.test(lines.at(-1)!.trim()) ? lines.pop()! : null;
  const next = [lines.join("\n").trimEnd(), watchNextLine(related), ...(hashtags ? [hashtags] : [])].filter(Boolean).join("\n\n");
  return utf8Length(next) <= YOUTUBE_DESCRIPTION_MAX_BYTES ? { description: next, added: true } : { description, added: false };
}

export const youtubePublisher: Publisher<YouTubeProvider> = {
  async prepare(provider, ctx): Promise<PrepareStep> {
    // Uploaded by the pre-chunking flow: nothing left to prepare.
    if (ctx.progress.videoId && !ctx.progress.youtube) return { done: true };
    const progress = await ensureUploadProgress(ctx, "youtube", ctx.media[0]!);
    switch (progress.phase) {
      case "init":
      case "uploading":
        return uploadStep(provider, ctx, progress);
      case "processing":
        return processingStep(provider, ctx, progress);
      default:
        return { done: true };
    }
  },

  async finalize(provider, ctx) {
    const input = ctx.input as YouTubeComposeInput;
    const progress = readUploadProgress(ctx, "youtube");
    const videoId = progress?.externalVideoId ?? (ctx.progress.videoId as string | undefined);
    if (!videoId) throw new Error("YouTube upload hasn't finished yet");
    const saveYt = async (patch: Partial<UploadProgress>) => {
      if (progress) await saveUploadProgress(ctx, "youtube", patch);
      else await ctx.save(patch);
    };

    // Legacy progress without uploadedPrivacy was uploaded with the chosen value.
    const uploaded = progress?.uploadedPrivacy ?? (ctx.progress.uploadedPrivacy as string | undefined) ?? input.privacyStatus;
    if (uploaded !== input.privacyStatus) {
      await ctx.save({}, `Making the video ${input.privacyStatus}`);
      // videos.update replaces the whole status part: resend every field we set.
      await provider.updateVideo({
        part: ["status"],
        requestBody: { id: videoId, status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: input.madeForKids } },
      });
      await saveYt({ uploadedPrivacy: input.privacyStatus });
    }

    const thumbnailSet = progress?.thumbnailSet ?? Boolean(ctx.progress.thumbnailSet);
    if (ctx.thumbnail && !thumbnailSet) {
      await ctx.save({}, "Setting thumbnail");
      try {
        await provider.setThumbnail({ videoId, media: await streamSource(ctx.thumbnail) });
        await saveYt({ thumbnailSet: true });
      } catch (error) {
        logUploadEvent(ctx, "youtube", "thumbnail_warning", { message: (error as Error).message });
        await saveYt({ thumbnailSet: true, warning: "The thumbnail couldn't be set" });
      }
    }

    const playlistAdded = progress?.playlistAdded ?? Boolean(ctx.progress.playlistAdded);
    if (input.playlistId && !playlistAdded) {
      await ctx.save({}, "Adding to playlist");
      try {
        await provider.insertPlaylistItem({
          part: ["snippet"],
          requestBody: { snippet: { playlistId: input.playlistId, resourceId: { kind: "youtube#video", videoId } } },
        });
        await saveYt({ playlistAdded: true });
      } catch (error) {
        logUploadEvent(ctx, "youtube", "playlist_warning", { message: (error as Error).message });
        await saveYt({ playlistAdded: true, warning: "The video couldn't be added to the playlist" });
      }
    }

    if (progress) await saveUploadProgress(ctx, "youtube", { phase: "posted" });
    return { externalPostId: videoId, postUrl: shortUrl(videoId) };
  },
};

async function uploadStep(provider: YouTubeProvider, ctx: PublishContext, start: UploadProgress): Promise<PrepareStep> {
  const input = ctx.input as YouTubeComposeInput;
  let progress = start;

  if (!progress.sessionRef) {
    const short = isYouTubeShort(ctx);
    const watchNext = withWatchNext(input.description ?? "", input.relatedVideo, short);
    // Remembered for the "Set related video in YouTube Studio" task shown after publishing.
    if (input.relatedVideo) await ctx.save({ isShort: short, watchNextAdded: watchNext.added });
    const privacyStatus = ctx.scheduled ? "private" : input.privacyStatus;
    await ctx.save({}, ctx.scheduled ? "Uploading video to YouTube (private until the scheduled time)" : "Uploading video to YouTube");
    const { sessionUrl } = await provider.createResumableUpload({
      part: ["snippet", "status"],
      notifySubscribers: input.notifySubscribers ?? true,
      totalBytes: progress.totalBytes,
      mimeType: progress.mimeType,
      requestBody: {
        snippet: {
          title: input.title,
          description: watchNext.description,
          ...(input.tags?.length ? { tags: input.tags } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        },
        status: { privacyStatus, selfDeclaredMadeForKids: input.madeForKids },
      },
    });
    // Saved before any bytes: a retry resumes this session instead of creating a new video.
    progress = await saveUploadProgress(ctx, "youtube", {
      sessionRef: sessionUrl,
      sessionCreatedAt: new Date().toISOString(),
      uploadedPrivacy: privacyStatus,
      confirmedBytes: 0,
      phase: "uploading",
    });
    logUploadEvent(ctx, "youtube", "session_created", { totalBytes: progress.totalBytes });
  }

  // Always ask the server first (start of a step = possibly a retry after a cut request).
  let state = await provider.queryResumableUpload(progress.sessionRef!, progress.totalBytes);
  const began = Date.now();
  for (;;) {
    if (state.state === "expired") {
      progress = await restartUploadSession(ctx, progress, "youtube_session_expired");
      return { done: false, next: `youtube-session-${progress.attemptsNewSession}` };
    }
    if (state.state === "complete") {
      await saveUploadProgress(ctx, "youtube", {
        confirmedBytes: progress.totalBytes,
        externalVideoId: state.video.id,
        phase: "processing",
        processingStartedAt: new Date().toISOString(),
        pollCount: 0,
      });
      await ctx.save({ videoId: state.video.id }, "Video uploaded — YouTube is processing it");
      logUploadEvent(ctx, "youtube", "upload_complete", { videoId: state.video.id });
      return { done: false, next: "youtube-processing-0", waitSeconds: pollDelaySeconds(0) };
    }

    const confirmed = state.confirmedBytes;
    if (confirmed !== progress.confirmedBytes) progress = await saveUploadProgress(ctx, "youtube", { confirmedBytes: confirmed });
    if (Date.now() - began > UPLOAD_CONFIG.STEP_BUDGET_MS) break;

    const end = Math.min(confirmed + CHUNK, progress.totalBytes) - 1;
    const data = await readRange(ctx.media[0]!, confirmed, end);
    state = await provider.uploadResumableChunk(progress.sessionRef!, {
      start: confirmed,
      data,
      totalBytes: progress.totalBytes,
      timeoutMs: UPLOAD_CONFIG.CHUNK_TIMEOUT_MS,
    });
    if (state.state === "incomplete" && state.confirmedBytes <= confirmed) {
      // Server kept nothing from this chunk: retry the step (it re-queries status first).
      throw new Error("YouTube did not accept the uploaded chunk");
    }
  }

  const percent = Math.floor((progress.confirmedBytes / progress.totalBytes) * 100);
  await ctx.save({}, `Uploading video to YouTube (${percent}%)`);
  return { done: false, next: `youtube-chunk-${Math.floor(progress.confirmedBytes / CHUNK)}` };
}

async function processingStep(provider: YouTubeProvider, ctx: PublishContext, progress: UploadProgress): Promise<PrepareStep> {
  const videoId = progress.externalVideoId!;
  const result = await provider.listVideo({ part: ["status", "processingDetails"], id: [videoId] });
  const video = result.items?.[0];
  const status = video?.status?.uploadStatus;

  if (status === "processed") {
    await saveUploadProgress(ctx, "youtube", { phase: "ready" });
    logUploadEvent(ctx, "youtube", "processing_done", { videoId, polls: progress.pollCount });
    return { done: true };
  }
  if (status === "failed" || status === "rejected" || status === "deleted") {
    const reason = video?.status?.failureReason ?? video?.status?.rejectionReason ?? status;
    return failUpload(ctx, "youtube", "youtube_processing_failed", `YouTube couldn't process the video (${reason}).`);
  }
  if (elapsedSince(progress.processingStartedAt) > UPLOAD_CONFIG.PROCESSING_CAP_MS.youtube) {
    // The upload is complete; processing just takes long. Not a failure, never re-upload.
    const warning = "YouTube is still processing the video; it will appear once processing finishes.";
    await saveUploadProgress(ctx, "youtube", { phase: "ready", warning });
    await ctx.save({}, warning);
    logUploadEvent(ctx, "youtube", "processing_cap_reached", { videoId });
    return { done: true };
  }

  const pollCount = progress.pollCount + 1;
  await saveUploadProgress(ctx, "youtube", { pollCount });
  await ctx.save({}, "YouTube is processing the video");
  return { done: false, next: `youtube-processing-${pollCount}`, waitSeconds: pollDelaySeconds(pollCount) };
}
