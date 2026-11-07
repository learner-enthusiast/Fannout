import { inngest, mediaUploadCompleted, mediaUploadFailed } from "@repo/inngest";
import {
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
} from "@repo/services/media/model";
import { deleteMediaChecked, getMediaDetail, renameMedia } from "@repo/services/media/library";
import {
  completeMediaUpload,
  createMediaUpload,
  failMediaUpload,
} from "@repo/services/media/uploads";
import { listMediaPage, toMediaView } from "@repo/services/media/views";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc";

export const mediaRouter = router({
  /** Starts a multipart upload: returns presigned URLs for every 10 MiB part. */
  createUpload: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/media/uploads", protect: true } })
    .input(CreateUploadInputSchema)
    .output(CreateUploadResultSchema)
    .mutation(({ ctx, input }) => createMediaUpload(ctx.dbUserId, input)),

  /** Finishes the upload and hands processing to Inngest. Returns immediately. */
  completeUpload: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/media/{mediaId}/complete", protect: true } })
    .input(CompleteUploadInputSchema)
    .output(MediaViewSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await completeMediaUpload(ctx.dbUserId, input);
      await inngest.send(mediaUploadCompleted.create({ mediaId: row.id, userId: ctx.dbUserId }));
      return toMediaView(row);
    }),

  /** Cancel or fatal client error: aborts the multipart upload and marks it failed. */
  failUpload: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/media/{mediaId}/fail", protect: true } })
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

  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/media", protect: true } })
    .input(MediaListInputSchema)
    .output(MediaPageSchema)
    .query(({ ctx, input }) => listMediaPage(ctx.dbUserId, input)),

  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/media/{mediaId}", protect: true } })
    .input(z.object({ mediaId: z.uuid() }))
    .output(MediaDetailSchema)
    .query(({ ctx, input }) => getMediaDetail(ctx.dbUserId, input.mediaId)),

  rename: protectedProcedure
    .meta({ openapi: { method: "PATCH", path: "/media/{mediaId}", protect: true } })
    .input(RenameMediaInputSchema)
    .output(MediaViewSchema)
    .mutation(({ ctx, input }) => renameMedia(ctx.dbUserId, input)),

  /** Deletes media + file. If folders use it, returns inUse (folder names) unless force=true. */
  delete: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/media/{mediaId}", protect: true } })
    .input(DeleteMediaInputSchema)
    .output(DeleteMediaResultSchema)
    .mutation(({ ctx, input }) => deleteMediaChecked(ctx.dbUserId, input)),
});
