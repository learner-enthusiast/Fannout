import { InstagramProvider, ProviderError } from "@repo/providers";
import {
  INSTAGRAM_CAROUSEL_MAX,
  INSTAGRAM_CAROUSEL_MIN,
  INSTAGRAM_CONTAINER_MAX_AGE_MS,
  INSTAGRAM_CONTAINER_POLL,
  INSTAGRAM_IMAGE,
  INSTAGRAM_REEL,
  instagramPostType,
  type InstagramComposeInput,
  type InstagramPostType,
} from "@repo/providers/instagram";
import { PermanentPublishError } from "../errors";
import type { PrepareStep } from "../upload/progress";
import { urlSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const MB = 1024 * 1024;
export const INSTAGRAM_JPEG_ONLY_MESSAGE = "Instagram accepts JPEG images only";

/** Meta subcodes that mean "this container can't be published; build a fresh one". */
export const INSTAGRAM_NEW_CONTAINER_SUBCODES = new Set(["2207020", "2207006", "2207008"]);
export const instagramSubcode = (error: unknown): string | null =>
  error instanceof ProviderError && error.provider === "INSTAGRAM" ? (/:(\d{7})$/.exec(error.providerCode ?? "")?.[1] ?? null) : null;

type Progress = {
  postType?: InstagramPostType;
  quotaChecked?: boolean;
  /** Reel / image container, or the carousel parent. */
  containerId?: string | null;
  containerCreatedAt?: string | null;
  containerReady?: boolean;
  /** Carousel children containers, in order. */
  childIds?: string[];
  childrenReady?: boolean;
  pollCount?: number;
  rebuilds?: number;
  publishAttempts?: number;
  publishAttemptedAt?: string;
  externalPostId?: string;
};

const fail = (message: string) => new PermanentPublishError("VALIDATION", message);
const mb = (bytes: number) => `${Math.round(bytes / MB)} MB`;

/** Checks everything we can before the first API call (class "validation"). */
export function assertInstagramPublishable(ctx: Pick<PublishContext, "media" | "mediaType" | "thumbnail">, type: InstagramPostType) {
  if (type === "reel") {
    const video = ctx.media[0];
    if (!video) throw fail("Pick a video");
    if (!(INSTAGRAM_REEL.mimeTypes as readonly string[]).includes(video.mimeType)) throw fail("Instagram accepts MP4 or MOV videos only");
    if ((video.sizeBytes ?? 0) > INSTAGRAM_REEL.maxBytes) throw fail(`Instagram reels can be at most ${mb(INSTAGRAM_REEL.maxBytes)}`);
    const seconds = video.durationSeconds;
    if (seconds != null && seconds < INSTAGRAM_REEL.minSeconds) throw fail(`Instagram reels must be at least ${INSTAGRAM_REEL.minSeconds} seconds long`);
    if (seconds != null && seconds > INSTAGRAM_REEL.maxSeconds) throw fail(`Instagram reels can be at most ${INSTAGRAM_REEL.maxSeconds / 60} minutes long`);
    const cover = ctx.thumbnail;
    if (cover) {
      if (!(INSTAGRAM_IMAGE.mimeTypes as readonly string[]).includes(cover.mimeType)) throw fail(`The cover image: ${INSTAGRAM_JPEG_ONLY_MESSAGE}`);
      if ((cover.sizeBytes ?? 0) > INSTAGRAM_IMAGE.maxBytes) throw fail(`The cover image can be at most ${mb(INSTAGRAM_IMAGE.maxBytes)}`);
    }
    return;
  }
  if (type === "carousel" && (ctx.media.length < INSTAGRAM_CAROUSEL_MIN || ctx.media.length > INSTAGRAM_CAROUSEL_MAX)) {
    throw fail(`A carousel needs ${INSTAGRAM_CAROUSEL_MIN} to ${INSTAGRAM_CAROUSEL_MAX} photos`);
  }
  for (const photo of ctx.media) {
    if (photo.type !== "image") throw fail("Photo posts can only contain images");
    if (!(INSTAGRAM_IMAGE.mimeTypes as readonly string[]).includes(photo.mimeType)) throw fail(INSTAGRAM_JPEG_ONLY_MESSAGE);
    if ((photo.sizeBytes ?? 0) > INSTAGRAM_IMAGE.maxBytes) throw fail(`Instagram photos can be at most ${mb(INSTAGRAM_IMAGE.maxBytes)}`);
  }
}

/**
 * Meta downloads the media from presigned URLs, so storage must be reachable from the internet.
 * prepare (resumable, one Inngest step per unit): validate → quota preflight → create container(s)
 * → poll status_code once a minute (≤ 10 checks) → carousel parent once every child is FINISHED.
 * finalize: media_publish once (write-ahead guard), then permalink.
 */
export const instagramPublisher: Publisher<InstagramProvider> = {
  async prepare(provider, ctx): Promise<PrepareStep | void> {
    const p = ctx.progress as Progress;
    if (p.externalPostId) return;
    const type = instagramPostType(ctx.mediaType, ctx.media.length);
    if (p.postType !== type) await ctx.save({ postType: type });

    // A ready container that is still fresh needs nothing more (scheduled posts re-run prepare before finalize).
    if (p.containerReady && isFresh(p)) return;
    if (p.containerReady || (p.containerId && !isFresh(p))) await resetContainer(ctx, true);

    if (!p.containerId && !(type === "carousel" && p.childIds?.length)) {
      assertInstagramPublishable(ctx, type);
      if (!p.quotaChecked) {
        // Preflight: token + account health, then the live publishing quota.
        await provider.getHealth();
        await checkQuota(provider);
        await ctx.save({ quotaChecked: true });
      }
    }

    if (type === "carousel") return carouselUnit(provider, ctx);
    if (!p.containerId) {
      await ctx.save({}, "Sending media to Instagram");
      const id = await createSingleContainer(provider, ctx, type);
      await ctx.save({ containerId: id, containerCreatedAt: new Date().toISOString(), containerReady: false, pollCount: 0 });
    }
    return pollContainer(provider, ctx, (ctx.progress as Progress).containerId!, "container");
  },

  async finalize(provider, ctx) {
    const p = ctx.progress as Progress;
    if (p.externalPostId) return { externalPostId: p.externalPostId, postUrl: await permalink(provider, p.externalPostId) };
    if (!p.containerId || !p.containerReady || !isFresh(p)) {
      // Not prepared (or expired while waiting): never publish blind. A retry rebuilds from scratch.
      await resetContainer(ctx, true);
      throw new PermanentPublishError("instagram_container_not_ready", "Instagram needs a fresh media container. Retry the post.");
    }

    const attempts = Number(p.publishAttempts ?? 0);
    if (attempts >= 1) {
      // A previous attempt may have published and lost the response: look before publishing again.
      const status = await provider.getContainerStatus(p.containerId);
      if (status.status_code === "PUBLISHED") {
        const found = await findPublished(provider, p);
        if (found) {
          await ctx.save({ externalPostId: found }, "Posted");
          return { externalPostId: found, postUrl: await permalink(provider, found) };
        }
        throw new PermanentPublishError("possible_duplicate", "Instagram says this post is already published. Check your profile before retrying.");
      }
      if (attempts >= 2) {
        throw new PermanentPublishError("possible_duplicate", "Instagram didn't confirm the post twice. Check your profile before retrying.");
      }
    }

    await ctx.save({ publishAttempts: attempts + 1, publishAttemptedAt: new Date().toISOString() }, "Publishing on Instagram");
    let mediaId: string;
    try {
      mediaId = (await provider.publishContainer(p.containerId)).id;
    } catch (error) {
      // Definite rejection (4xx): nothing was published, so it doesn't count as an attempt.
      if (error instanceof ProviderError && error.status !== null && error.status < 500) {
        await ctx.save({ publishAttempts: attempts });
        const sub = instagramSubcode(error);
        if (sub && INSTAGRAM_NEW_CONTAINER_SUBCODES.has(sub)) await resetContainer(ctx, true);
      }
      throw error;
    }
    // Saved before anything else: media_publish isn't idempotent.
    await ctx.save({ externalPostId: mediaId }, "Posted");
    return { externalPostId: mediaId, postUrl: await permalink(provider, mediaId) };
  },
};

function isFresh(p: Progress) {
  return Boolean(p.containerCreatedAt && Date.now() - Date.parse(p.containerCreatedAt) < INSTAGRAM_CONTAINER_MAX_AGE_MS);
}

async function resetContainer(ctx: PublishContext, includeChildren: boolean) {
  await ctx.save({
    containerId: null,
    containerCreatedAt: null,
    containerReady: false,
    pollCount: 0,
    publishAttempts: 0,
    ...(includeChildren ? { childIds: [], childrenReady: false } : {}),
  });
}

/** Live quota (never hardcoded): quota_usage >= config.quota_total → rate limit. */
async function checkQuota(provider: InstagramProvider) {
  const limit = await provider.getPublishingLimit();
  const total = limit?.config?.quota_total;
  if (limit && total !== undefined && limit.quota_usage >= total) {
    throw new ProviderError({
      provider: "INSTAGRAM",
      code: "RATE_LIMITED",
      message: `Instagram's 24-hour publishing limit is reached (${limit.quota_usage} of ${total}). Try again later.`,
      retryable: true,
    });
  }
}

async function createSingleContainer(provider: InstagramProvider, ctx: PublishContext, type: InstagramPostType): Promise<string> {
  const input = ctx.input as InstagramComposeInput;
  const caption = input.caption?.trim() ? { caption: input.caption } : {};
  if (type === "reel") {
    const video = await urlSource(ctx.media[0]!);
    const cover = ctx.thumbnail ? await urlSource(ctx.thumbnail) : null;
    return (
      await provider.createReelContainer({
        media_type: "REELS",
        video_url: video.url,
        ...caption,
        share_to_feed: input.shareToFeed ?? true,
        // cover_url wins over thumb_offset.
        ...(cover ? { cover_url: cover.url } : input.thumbOffsetMs !== undefined ? { thumb_offset: input.thumbOffsetMs } : {}),
        ...(input.collaborators?.length ? { collaborators: input.collaborators } : {}),
      })
    ).id;
  }
  const image = await urlSource(ctx.media[0]!);
  return (await provider.createImageContainer({ image_url: image.url, ...caption, ...(input.altText?.trim() ? { alt_text: input.altText } : {}) })).id;
}

/** Carousel: children first (each id saved immediately), then the parent once every child is FINISHED. */
async function carouselUnit(provider: InstagramProvider, ctx: PublishContext): Promise<PrepareStep | void> {
  const p = ctx.progress as Progress;
  const children = [...(p.childIds ?? [])];
  if (children.length < ctx.media.length) {
    await ctx.save({}, "Sending photos to Instagram");
    for (const [index, item] of ctx.media.entries()) {
      if (children[index]) continue;
      children[index] = (await provider.createCarouselItem({ image_url: (await urlSource(item)).url })).id;
      await ctx.save({ childIds: children, containerCreatedAt: (ctx.progress as Progress).containerCreatedAt ?? new Date().toISOString(), pollCount: 0 });
    }
  }
  if (!(ctx.progress as Progress).childrenReady) {
    const pending = await firstUnfinished(provider, children);
    if (pending === "wait") return nextPoll(ctx, "children");
    await ctx.save({ childrenReady: true, pollCount: 0 });
  }
  if (!(ctx.progress as Progress).containerId) {
    const input = ctx.input as InstagramComposeInput;
    const parent = await provider.createCarouselContainer({ children, ...(input.caption?.trim() ? { caption: input.caption } : {}) });
    await ctx.save({ containerId: parent.id, containerCreatedAt: new Date().toISOString(), containerReady: false, pollCount: 0 });
  }
  return pollContainer(provider, ctx, (ctx.progress as Progress).containerId!, "container");
}

/** "wait" while any child is IN_PROGRESS; throws on ERROR/EXPIRED. */
async function firstUnfinished(provider: InstagramProvider, ids: string[]): Promise<"wait" | "done"> {
  let waiting = false;
  for (const id of ids) {
    const status = (await provider.getContainerStatus(id)).status_code;
    if (status === "FINISHED") continue;
    if (status === "IN_PROGRESS") waiting = true;
    else throw failedContainer(status);
  }
  return waiting ? "wait" : "done";
}

/** One status check per step; ≤ 10 checks, 60 s apart. */
async function pollContainer(provider: InstagramProvider, ctx: PublishContext, containerId: string, label: string): Promise<PrepareStep | void> {
  const status = (await provider.getContainerStatus(containerId)).status_code;
  if (status === "FINISHED" || status === "PUBLISHED") {
    await ctx.save({ containerReady: true, pollCount: 0 }, ctx.scheduled ? "Ready — waiting for the scheduled time" : "Media processed");
    return;
  }
  if (status === "IN_PROGRESS") return nextPoll(ctx, label);
  if (status === "EXPIRED" && Number((ctx.progress as Progress).rebuilds ?? 0) < 1) {
    // A fresh container is needed: rebuild once.
    await ctx.save({ rebuilds: 1 });
    await resetContainer(ctx, true);
    return { done: false, next: "ig-rebuild" };
  }
  throw failedContainer(status);
}

async function nextPoll(ctx: PublishContext, label: string): Promise<PrepareStep> {
  const count = Number((ctx.progress as Progress).pollCount ?? 0) + 1;
  if (count > INSTAGRAM_CONTAINER_POLL.maxChecks) {
    throw new PermanentPublishError("instagram_processing_timeout", "Instagram took too long to process the media. Retry the post.");
  }
  await ctx.save({ pollCount: count }, "Instagram is processing the media");
  return { done: false, next: `ig-poll-${label}-${count}`, waitSeconds: INSTAGRAM_CONTAINER_POLL.intervalSeconds };
}

function failedContainer(status: string) {
  return status === "EXPIRED"
    ? new PermanentPublishError("instagram_container_expired", "Instagram's media container expired. Retry the post.")
    : new PermanentPublishError("instagram_processing_failed", "Instagram couldn't process the media. Check the format (MP4/MOV H.264 + AAC for video, JPEG for photos) and retry.");
}

async function findPublished(provider: InstagramProvider, p: Progress): Promise<string | null> {
  const since = Date.parse(p.publishAttemptedAt ?? "") - 2 * 60_000;
  const recent = await provider.getRecentMedia(5);
  const hit = recent.find((m) => !m.timestamp || Date.parse(m.timestamp) >= since);
  return hit?.id ?? null;
}

async function permalink(provider: InstagramProvider, mediaId: string): Promise<string | null> {
  try {
    const media = await provider.getMedia(mediaId);
    return media.permalink ?? null;
  } catch {
    // The post exists; a missing permalink isn't worth failing over.
    return null;
  }
}
