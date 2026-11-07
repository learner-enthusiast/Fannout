import type { LinkedInProvider } from "@repo/providers";
import type { LinkedInComposeInput } from "@repo/providers/linkedin";
import { env } from "../../env";
import { streamSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const postUrl = (urn: string) => `https://www.linkedin.com/feed/update/${urn}`;

/**
 * Member post. Default: Share on LinkedIn (UGC, w_member_social) —
 * registerUpload → upload → wait AVAILABLE → /v2/ugcPosts. Asset URNs are
 * saved as they finish so retries never re-upload.
 * LINKEDIN_USE_COMMUNITY_API=true keeps the Community Management (/rest) flow.
 */
export const LINKEDIN_MISSING_SHARE_MESSAGE =
  "LinkedIn didn't grant posting. Reconnect LinkedIn and approve sharing on your behalf.";

/** Raised before calling LinkedIn when the connection can't post. Not retried. */
export class LinkedInPublishError extends Error {
  readonly code = "missing_post_permission";
  constructor() {
    super(LINKEDIN_MISSING_SHARE_MESSAGE);
  }
}

function assertCanPost(ctx: PublishContext) {
  // Connections made before w_member_social was requested can't post: fail before uploading.
  if (!env.LINKEDIN_USE_COMMUNITY_API && ctx.connection.scopes && !ctx.connection.scopes.includes("w_member_social")) {
    throw new LinkedInPublishError();
  }
}

/**
 * prepare: register + upload every asset and wait until AVAILABLE (UGC), or
 * upload video/images (Community API). finalize: create the post.
 */
export const linkedinPublisher: Publisher<LinkedInProvider> = {
  async prepare(provider, ctx) {
    if (ctx.progress.externalPostId) return;
    assertCanPost(ctx);
    if (env.LINKEDIN_USE_COMMUNITY_API) await uploadCommunity(provider, ctx);
    else await uploadUgc(provider, ctx);
  },
  async finalize(provider, ctx) {
    const existing = ctx.progress.externalPostId as string | undefined;
    if (existing) return { externalPostId: existing, postUrl: postUrl(existing) };
    assertCanPost(ctx);
    const created = env.LINKEDIN_USE_COMMUNITY_API ? await postCommunity(provider, ctx) : await postUgc(provider, ctx);
    await ctx.save({ externalPostId: created.id }, "Posted");
    return { externalPostId: created.id, postUrl: postUrl(created.id) };
  },
};

async function uploadUgc(provider: LinkedInProvider, ctx: PublishContext) {
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const kind = ctx.mediaType === "video" ? "video" : "image";
  const assets = [...((ctx.progress.assetUrns as string[] | undefined) ?? [])];

  for (const [index, item] of ctx.media.entries()) {
    if (assets[index]) continue;
    await ctx.save({}, `Uploading ${kind} ${ctx.media.length > 1 ? `${index + 1} of ${ctx.media.length} ` : ""}to LinkedIn`);
    assets[index] = (await provider.uploadUgcAsset({ owner: author, kind, source: await streamSource(item) })).asset;
    await ctx.save({ assetUrns: assets });
  }

  if (!ctx.progress.assetsReady) {
    await ctx.save({}, "Waiting for LinkedIn to process the media");
    for (const asset of assets) await provider.waitForAsset(asset);
    await ctx.save({ assetsReady: true });
  }
  return assets;
}

async function postUgc(provider: LinkedInProvider, ctx: PublishContext) {
  const input = ctx.input as LinkedInComposeInput;
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const kind = ctx.mediaType === "video" ? "video" : "image";
  const assets = await uploadUgc(provider, ctx);
  await ctx.save({}, "Creating post");
  return provider.createUgcPost({
    author,
    commentary: input.commentary ?? "",
    visibility: input.visibility,
    mediaCategory: kind === "video" ? "VIDEO" : "IMAGE",
    media: assets.map((asset) => ({ asset, ...(kind === "video" && input.videoTitle ? { title: input.videoTitle } : {}) })),
  });
}

/** Community Management API (/rest/videos, /rest/images, /rest/posts). Behind LINKEDIN_USE_COMMUNITY_API. */
async function uploadCommunity(provider: LinkedInProvider, ctx: PublishContext): Promise<{ video?: string; images: string[] }> {
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  if (ctx.mediaType === "video") {
    let video = ctx.progress.videoUrn as string | undefined;
    if (!video) {
      await ctx.save({}, "Uploading video to LinkedIn");
      const uploaded = await provider.uploadVideo({
        owner: author,
        source: await streamSource(ctx.media[0]!),
        ...(ctx.thumbnail ? { thumbnail: await streamSource(ctx.thumbnail) } : {}),
      });
      video = uploaded.video;
      await ctx.save({ videoUrn: video }, "Video uploaded");
    }
    return { video, images: [] };
  }

  const images = [...((ctx.progress.imageUrns as string[] | undefined) ?? [])];
  for (const [index, item] of ctx.media.entries()) {
    if (images[index]) continue;
    await ctx.save({}, `Uploading image ${index + 1} of ${ctx.media.length} to LinkedIn`);
    images[index] = (await provider.uploadImage({ owner: author, source: await streamSource(item) })).image;
    await ctx.save({ imageUrns: images });
  }
  return { images };
}

async function postCommunity(provider: LinkedInProvider, ctx: PublishContext) {
  const input = ctx.input as LinkedInComposeInput;
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const common = {
    author,
    commentary: input.commentary ?? "",
    visibility: input.visibility,
    distribution: { feedDistribution: "MAIN_FEED" as const },
    ...(input.isReshareDisabledByAuthor ? { isReshareDisabledByAuthor: true } : {}),
  };
  const { video, images } = await uploadCommunity(provider, ctx);
  await ctx.save({}, "Creating post");
  if (video) {
    return provider.createVideoPost({ ...common, video: { id: video, ...(input.videoTitle ? { title: input.videoTitle } : {}) } });
  }
  return images.length === 1
    ? provider.createImagePost({ ...common, image: { id: images[0]! } })
    : provider.createMultiImagePost({ ...common, multiImage: { images: images.map((id) => ({ id })) } });
}
