import { allCapabilities, PlatformCapabilitiesSchema } from "@repo/services/publishing/capabilities";
import { YouTubeUploadSchema, YouTubeUploadsInputSchema, YouTubeUploadsPageSchema } from "@repo/services/publishing/model";
import { getYouTubeVideoByUrl, listYouTubeCategories, listYouTubePlaylists, listYouTubeUploads } from "@repo/services/publishing/run";
import { z } from "zod";
import { zodUndefinedModel } from "../../schema";
import { publicProcedure, router, scoped } from "../../trpc";

const OptionListSchema = z.array(z.object({ id: z.string().describe("Option ID to put in the compose field."), title: z.string().describe("Human-readable name.") }));

export const platformsRouter = router({
  /** Per-platform composer capabilities + fields, derived from each provider's compose model. */
  capabilities: publicProcedure
    .meta({ openapi: { method: "GET", path: "/platforms/capabilities", summary: "Compose fields, limits and delete/edit support for every platform" } })
    .input(zodUndefinedModel)
    .output(z.array(PlatformCapabilitiesSchema))
    .query(() => allCapabilities()),

  /** The channel's playlists (backend calls YouTube; the browser never sees tokens). */
  youtubePlaylists: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/platforms/youtube/{socialConnectionId}/playlists", summary: "List a YouTube channel's playlists", protect: true } })
    .input(z.object({ socialConnectionId: z.uuid().describe("A connected YouTube account.") }))
    .output(OptionListSchema)
    .query(({ ctx, input }) => listYouTubePlaylists(ctx.dbUserId, input.socialConnectionId)),

  /** The channel's own videos, newest first — for the "Related video" picker. */
  youtubeUploads: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/platforms/youtube/{socialConnectionId}/uploads", summary: "List a YouTube channel's uploaded videos, newest first", protect: true } })
    .input(YouTubeUploadsInputSchema)
    .output(YouTubeUploadsPageSchema)
    .query(({ ctx, input }) => listYouTubeUploads(ctx.dbUserId, input.socialConnectionId, input)),

  /** Validates a pasted YouTube link and returns the video it points to. */
  youtubeVideo: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/platforms/youtube/{socialConnectionId}/video", summary: "Look up a YouTube video by its URL or ID", protect: true } })
    .input(z.object({ socialConnectionId: z.uuid().describe("A connected YouTube account."), url: z.string().trim().min(1).max(300).describe("A YouTube video URL (watch, youtu.be, shorts) or a video ID.") }))
    .output(YouTubeUploadSchema)
    .query(({ ctx, input }) => getYouTubeVideoByUrl(ctx.dbUserId, input.socialConnectionId, input.url)),

  youtubeCategories: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/platforms/youtube/{socialConnectionId}/categories", summary: "List YouTube video categories for a channel", protect: true } })
    .input(z.object({ socialConnectionId: z.uuid().describe("A connected YouTube account."), regionCode: z.string().regex(/^[A-Z]{2}$/).optional().describe("ISO 3166-1 alpha-2 region, e.g. US.") }))
    .output(OptionListSchema)
    .query(({ ctx, input }) => listYouTubeCategories(ctx.dbUserId, input.socialConnectionId, input.regionCode)),
});
