import { inngest, mediaDeleteRequested, mediaUploadCompleted, mediaUploadFailed } from "@repo/inngest";
import {
  BulkDeleteMediaInputSchema,
  CompleteUploadInputSchema,
  CreateUploadInputSchema,
  CreateUploadResultSchema,
  DeleteMediaInputSchema,
  DeleteMediaResultSchema,
  FailUploadInputSchema,
  MediaDetailSchema,
  MediaListInputSchema,
  MediaPageSchema,
  MediaViewSchema,
  RenameMediaInputSchema,
  SignUploadPartsInputSchema,
  SignUploadPartsResultSchema,
} from "@repo/services/media/model";
import { getMediaDetail, planMediaDeleteJob, renameMedia } from "@repo/services/media/library";
import {
  completeMediaUpload,
  createMediaUpload,
  failMediaUpload,
  signMediaUploadParts,
} from "@repo/services/media/uploads";
import { listMediaPage, toMediaView } from "@repo/services/media/views";
import { ZipMediaInputSchema, ZipMediaResultSchema, zipMedia } from "@repo/services/media/zip";
import { z } from "zod";
import { router, scoped } from "../../trpc";

async function queueMediaDelete(userId: string, input: z.input<typeof BulkDeleteMediaInputSchema>) {
  const { mediaIdsToQueue, ...result } = await planMediaDeleteJob(userId, input);
  if (mediaIdsToQueue.length > 0) {
    await inngest.send(
      mediaDeleteRequested.create(
        { userId, jobId: result.jobId, mediaIds: mediaIdsToQueue },
        { id: `media-delete:${result.jobId}` },
      ),
    );
  }
  return result;
}

export const mediaRouter = router({
  /** Images of a manual post, zipped in slide order (read from storage on the server). */
  zip: scoped("media:read")
    .meta({ openapi: { method: "POST", path: "/media/zip", summary: "Download several of your images as one zip, in the given order", protect: true } })
    .input(ZipMediaInputSchema)
    .output(ZipMediaResultSchema)
    .mutation(({ ctx, input }) => zipMedia(ctx.dbUserId, input)),

  /** Starts a multipart upload (media row status "uploading" from now on) or reuses an identical ready file. */
  createUpload: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/media/uploads", summary: "Start a multipart upload and get presigned part URLs", protect: true } })
    .input(CreateUploadInputSchema)
    .output(CreateUploadResultSchema)
    .mutation(({ ctx, input }) => createMediaUpload(ctx.dbUserId, input)),

  /** Fresh presigned part URLs: expired URLs, the rest of a large file, or resuming after a reload. */
  signUploadParts: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/media/{mediaId}/parts", summary: "Presign (or re-sign) part URLs for an upload in progress", protect: true } })
    .input(SignUploadPartsInputSchema)
    .output(SignUploadPartsResultSchema)
    .mutation(({ ctx, input }) => signMediaUploadParts(ctx.dbUserId, input)),

  /** Finishes the upload and hands processing to Inngest. Returns immediately. */
  completeUpload: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/media/{mediaId}/complete", summary: "Finish a multipart upload with the part ETags", protect: true } })
    .input(CompleteUploadInputSchema)
    .output(MediaViewSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await completeMediaUpload(ctx.dbUserId, input);
      await inngest.send(mediaUploadCompleted.create({ mediaId: row.id, userId: ctx.dbUserId }));
      return toMediaView(row);
    }),

  /** Cancel or fatal client error: aborts the multipart upload and marks it failed. */
  failUpload: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/media/{mediaId}/fail", summary: "Mark an upload as failed", protect: true } })
    .input(FailUploadInputSchema)
    .output(MediaViewSchema)
    .mutation(async ({ ctx, input }) => {
      const { row, changed } = await failMediaUpload(ctx.dbUserId, input);
      if (changed) {
        await inngest.send(
          mediaUploadFailed.create({ mediaId: row.id, userId: ctx.dbUserId, error: input.error }),
        );
      }
      return toMediaView(row);
    }),

  list: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/media", summary: "List media in the library", protect: true } })
    .input(MediaListInputSchema)
    .output(MediaPageSchema)
    .query(({ ctx, input }) => listMediaPage(ctx.dbUserId, input)),

  get: scoped("media:read")
    .meta({ openapi: { method: "GET", path: "/media/{mediaId}", summary: "Get one media item with its folders and usage", protect: true } })
    .input(z.object({ mediaId: z.uuid().describe("Media ID.") }))
    .output(MediaDetailSchema)
    .query(({ ctx, input }) => getMediaDetail(ctx.dbUserId, input.mediaId)),

  rename: scoped("media:write")
    .meta({ openapi: { method: "PATCH", path: "/media/{mediaId}", summary: "Rename a media item", protect: true } })
    .input(RenameMediaInputSchema)
    .output(MediaViewSchema)
    .mutation(({ ctx, input }) => renameMedia(ctx.dbUserId, input)),

  /** Queues a background delete (Inngest). Media still used by unpublished posts is rejected with MEDIA_IN_USE. */
  delete: scoped("media:write")
    .meta({ openapi: { method: "DELETE", path: "/media/{mediaId}", summary: "Queue delete for one media item", protect: true } })
    .input(DeleteMediaInputSchema)
    .output(DeleteMediaResultSchema)
    .mutation(({ ctx, input }) => queueMediaDelete(ctx.dbUserId, { mediaIds: [input.mediaId] })),

  /** Queues one background job for many items (one failure notification for the batch). */
  bulkDelete: scoped("media:write")
    .meta({ openapi: { method: "POST", path: "/media/bulk-delete", summary: "Queue delete for many media items in one job", protect: true } })
    .input(BulkDeleteMediaInputSchema)
    .output(DeleteMediaResultSchema)
    .mutation(({ ctx, input }) => queueMediaDelete(ctx.dbUserId, input)),
});
