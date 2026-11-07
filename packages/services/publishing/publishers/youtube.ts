import type { YouTubeProvider } from "@repo/providers";
import type { YouTubeComposeInput } from "@repo/providers/youtube";
import { streamSource } from "./media-source";
import type { Publisher } from "./types";

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * prepare: resumable upload (+ thumbnail). Scheduled posts upload as PRIVATE
 * so nothing is public before the time; instant posts upload with the chosen
 * privacy (unchanged behavior).
 * finalize: flip privacy to the chosen value (full status resent — videos.update
 * replaces the whole part), then the playlist insert. Each step is saved.
 */
export const youtubePublisher: Publisher<YouTubeProvider> = {
  async prepare(provider, ctx) {
    const input = ctx.input as YouTubeComposeInput;
    let videoId = ctx.progress.videoId as string | undefined;
    if (!videoId) {
      const privacyStatus = ctx.scheduled ? "private" : input.privacyStatus;
      await ctx.save({}, ctx.scheduled ? "Uploading video to YouTube (private until the scheduled time)" : "Uploading video to YouTube");
      const created = await provider.insertVideo({
        part: ["snippet", "status"],
        notifySubscribers: input.notifySubscribers ?? true,
        requestBody: {
          snippet: {
            title: input.title,
            description: input.description ?? "",
            ...(input.tags?.length ? { tags: input.tags } : {}),
            ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          },
          status: { privacyStatus, selfDeclaredMadeForKids: input.madeForKids },
        },
        media: await streamSource(ctx.media[0]!),
      });
      if (!created.id) throw new Error("YouTube did not return a video id");
      videoId = created.id;
      await ctx.save({ videoId, uploadedPrivacy: privacyStatus }, "Video uploaded");
    }

    if (ctx.thumbnail && !ctx.progress.thumbnailSet) {
      await ctx.save({}, "Setting thumbnail");
      await provider.setThumbnail({ videoId, media: await streamSource(ctx.thumbnail) });
      await ctx.save({ thumbnailSet: true }, "Thumbnail set");
    }
  },

  async finalize(provider, ctx) {
    const input = ctx.input as YouTubeComposeInput;
    const videoId = ctx.progress.videoId as string | undefined;
    if (!videoId) throw new Error("YouTube upload hasn't finished yet");

    // Older progress (before scheduling) has no uploadedPrivacy: it was uploaded with the chosen value.
    const uploaded = (ctx.progress.uploadedPrivacy as string | undefined) ?? input.privacyStatus;
    if (uploaded !== input.privacyStatus) {
      await ctx.save({}, `Making the video ${input.privacyStatus}`);
      await provider.updateVideo({
        part: ["status"],
        requestBody: { id: videoId, status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: input.madeForKids } },
      });
      await ctx.save({ uploadedPrivacy: input.privacyStatus }, `Video is ${input.privacyStatus}`);
    }

    if (input.playlistId && !ctx.progress.playlistAdded) {
      await ctx.save({}, "Adding to playlist");
      await provider.insertPlaylistItem({
        part: ["snippet"],
        requestBody: { snippet: { playlistId: input.playlistId, resourceId: { kind: "youtube#video", videoId } } },
      });
      await ctx.save({ playlistAdded: true }, "Added to playlist");
    }

    return { externalPostId: videoId, postUrl: watchUrl(videoId) };
  },
};
