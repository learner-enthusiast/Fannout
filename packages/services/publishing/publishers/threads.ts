import type { ThreadsProvider } from "@repo/providers";
import type { ThreadsComposeInput } from "@repo/providers/threads";
import { urlSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

/** Containers expire after ~24 h; re-create them when older than this. */
const CONTAINER_MAX_AGE_MS = 20 * 60 * 60 * 1000;

/**
 * Threads downloads media from URLs, so we hand it presigned links. Storage
 * must be reachable from the internet (S3_PUBLIC_ENDPOINT), not localhost.
 * prepare: create the container(s) and poll until FINISHED.
 * finalize: threads_publish (re-prepares first when the container is too old).
 */
export const threadsPublisher: Publisher<ThreadsProvider> = {
  async prepare(provider, ctx) {
    if (ctx.progress.externalPostId) return;
    await ensureContainer(provider, ctx);
  },

  async finalize(provider, ctx) {
    let mediaId = ctx.progress.externalPostId as string | undefined;
    if (!mediaId) {
      const containerId = await ensureContainer(provider, ctx);
      await ctx.save({}, "Publishing on Threads");
      mediaId = (await provider.publishContainer(containerId)).id;
      await ctx.save({ externalPostId: mediaId }, "Posted");
    }

    let permalink: string | null = null;
    try {
      const post = await provider.getPost({ mediaId, fields: ["permalink"] });
      permalink = typeof post.permalink === "string" ? post.permalink : null;
    } catch {
      // The post exists; a missing permalink isn't worth failing over.
    }
    return { externalPostId: mediaId, postUrl: permalink };
  },
};

async function ensureContainer(provider: ThreadsProvider, ctx: PublishContext): Promise<string> {
  const existing = ctx.progress.containerId as string | undefined;
  const createdAt = ctx.progress.containerCreatedAt as string | undefined;
  const fresh = existing && createdAt && Date.now() - Date.parse(createdAt) < CONTAINER_MAX_AGE_MS;
  if (existing && fresh && ctx.progress.containerReady) return existing;

  let containerId = fresh ? existing : undefined;
  if (!containerId) {
    const input = ctx.input as ThreadsComposeInput;
    const common = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(input.reply_control ? { reply_control: input.reply_control } : {}),
      ...(input.topic_tag ? { topic_tag: input.topic_tag } : {}),
      ...(input.is_spoiler_media ? { is_spoiler_media: true } : {}),
    };
    await ctx.save({}, "Sending media to Threads");
    const urls = await Promise.all(ctx.media.map(urlSource));
    if (ctx.mediaType === "video") {
      containerId = (await provider.createContainer({ ...common, media_type: "VIDEO", video_url: urls[0]!.url })).id;
    } else if (urls.length === 1) {
      containerId = (await provider.createContainer({ ...common, media_type: "IMAGE", image_url: urls[0]!.url })).id;
    } else {
      const children: string[] = [];
      for (const u of urls) children.push((await provider.createCarouselItem({ media_type: "IMAGE", image_url: u.url })).id);
      containerId = (await provider.createContainer({ ...common, media_type: "CAROUSEL", children })).id;
    }
    await ctx.save({ containerId, containerCreatedAt: new Date().toISOString(), containerReady: false });
  }

  await ctx.save({}, "Threads is processing the media");
  await provider.waitForContainer(containerId);
  await ctx.save({ containerReady: true }, ctx.scheduled ? "Ready — waiting for the scheduled time" : "Media processed");
  return containerId;
}
