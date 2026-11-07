import type { FacebookProvider } from "@repo/providers";
import type { FacebookComposeInput } from "@repo/providers/facebook";
import { inspectFacebookToken } from "./facebook-token";
import { streamSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const fbUrl = (id: string) => `https://www.facebook.com/${id}`;

/**
 * Feed video upload publishes on finish, so it can't be split: prepare only
 * checks the token (fails early, before the scheduled time); finalize does
 * the upload / photos → Page post.
 */
export const facebookPublisher: Publisher<FacebookProvider> = {
  async prepare(_provider, ctx) {
    if (ctx.progress.externalPostId || ctx.progress.tokenChecked) return;
    await checkToken(ctx);
    await ctx.save({ tokenChecked: true });
  },
  async finalize(provider, ctx) {
    const existing = ctx.progress.externalPostId as string | undefined;
    if (existing) return { externalPostId: existing, postUrl: fbUrl(existing) };
    if (!ctx.progress.tokenChecked) await checkToken(ctx);
    return publish(provider, ctx);
  },
};

async function checkToken(ctx: PublishContext) {
  // Diagnostics before publishing: PAGE vs USER token, granted scopes, page id (no token values).
  const token = await inspectFacebookToken(ctx.userId, ctx.connection.id, ctx.connection.providerAccountId);
  if (token && token.tokenType && token.tokenType !== "PAGE") {
    throw new FacebookPublishError("wrong_token_type", "Facebook gave us a user token instead of a Page token. Reconnect Facebook and pick the Page.");
  }
  // Fail before uploading anything Facebook would reject anyway.
  if (token && ctx.mediaType === "video" && token.missing.includes("pages_manage_posts")) {
    throw new FacebookPublishError("missing_video_permission", MISSING_VIDEO_PERMISSION_MESSAGE);
  }
}

async function publish(provider: FacebookProvider, ctx: PublishContext) {
  const input = ctx.input as FacebookComposeInput;
  let id: string;
  if (ctx.mediaType === "video") {
    await ctx.save({}, "Uploading video to Facebook");
    const uploaded = await provider.uploadVideo({
      media: await streamSource(ctx.media[0]!),
      ...(input.title ? { title: input.title } : {}),
      ...(input.message ? { description: input.message } : {}),
      ...(input.content_category ? { content_category: input.content_category } : {}),
    });
    id = uploaded.post_id ?? uploaded.video_id ?? uploaded.id ?? "";
    if (!id) throw new Error("Facebook did not return a video id");
  } else if (ctx.media.length === 1) {
    await ctx.save({}, "Uploading photo to Facebook");
    const photo = await provider.uploadPhoto({ media: await streamSource(ctx.media[0]!), ...(input.message ? { caption: input.message } : {}) });
    id = photo.post_id ?? photo.id;
  } else {
    const photoIds = [...((ctx.progress.photoIds as string[] | undefined) ?? [])];
    for (const [index, item] of ctx.media.entries()) {
      if (photoIds[index]) continue;
      await ctx.save({}, `Uploading photo ${index + 1} of ${ctx.media.length} to Facebook`);
      photoIds[index] = (await provider.uploadPhoto({ media: await streamSource(item), published: false })).id;
      await ctx.save({ photoIds });
    }
    await ctx.save({}, "Creating post");
    id = (
      await provider.createPost({
        ...(input.message ? { message: input.message } : {}),
        attached_media: photoIds.map((media_fbid) => ({ media_fbid })),
      })
    ).id;
  }
  await ctx.save({ externalPostId: id }, "Posted");
  return { externalPostId: id, postUrl: fbUrl(id) };
}

export const MISSING_VIDEO_PERMISSION_MESSAGE =
  "Facebook didn't grant video publishing. Reconnect Facebook and approve all permissions.";

/** Raised before calling Facebook when the stored token can't publish. Not retried. */
export class FacebookPublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
