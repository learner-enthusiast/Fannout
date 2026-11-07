import type { XProvider } from "@repo/providers";
import type { XComposeInput } from "@repo/providers/x";
import { streamSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const X_MEDIA_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "image/jpeg", "image/gif", "image/png", "image/webp"]);

const statusUrl = (id: string) => `https://x.com/i/web/status/${id}`;

/** prepare: chunked media uploads until processed (saved one by one). finalize: create the post. */
export const xPublisher: Publisher<XProvider> = {
  async prepare(provider, ctx) {
    if (ctx.progress.externalPostId) return;
    await uploadAll(provider, ctx);
  },
  async finalize(provider, ctx) {
    const input = ctx.input as XComposeInput;
    const existing = ctx.progress.externalPostId as string | undefined;
    if (existing) return { externalPostId: existing, postUrl: statusUrl(existing) };
    // X media ids expire (~24 h): if the upload is older than 20 h, upload again.
    const uploadedAt = ctx.progress.mediaUploadedAt as string | undefined;
    if (uploadedAt && Date.now() - Date.parse(uploadedAt) > 20 * 60 * 60 * 1000) await ctx.save({ mediaIds: [], mediaUploadedAt: null });
    const mediaIds = await uploadAll(provider, ctx);

    await ctx.save({}, "Creating post");
    const created = await provider.createPost({
      ...(input.text?.trim() ? { text: input.text } : {}),
      media: { mediaIds },
      ...(input.replySettings ? { replySettings: input.replySettings } : {}),
      ...(input.madeWithAi ? { madeWithAi: true } : {}),
      ...(input.paidPartnership ? { paidPartnership: true } : {}),
    });
    const id = created.data.id;
    // Saved before returning: createPost isn't idempotent, so a retry must not post twice.
    await ctx.save({ externalPostId: id }, "Posted");
    return { externalPostId: id, postUrl: statusUrl(id) };
  },
};

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
