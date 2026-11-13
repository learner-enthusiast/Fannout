import {
  inngest,
  postDeleteRequested,
  postEditRequested,
  postPublishCancelled,
  postPublishRequested,
  postsBatchRequested,
  schedulingEffects,
} from "@repo/inngest";
import { cancelSchedule, closeScheduleAfterCancel, publishNow, reschedule } from "@repo/services/scheduling";
import {
  CancelScheduleResultSchema,
  RescheduleInputSchema,
  SchedulePostIdInputSchema,
  ScheduleResultSchema,
} from "@repo/services/scheduling/model";
import {
  getPostDetail,
  requestDelete,
  requestDeleteBatch,
  requestEdit,
  requestRepost,
  type PostActionEvent,
} from "@repo/services/post-actions";
import {
  DeleteBatchInputSchema,
  DeleteBatchResultSchema,
  DeleteResultSchema,
  PostDetailSchema,
  PostIdInputSchema,
  RepostInputSchema,
  UpdatePostInputSchema,
  UpdateResultSchema,
} from "@repo/services/post-actions/model";
import {
  getBatch,
  listBatches,
  publishBatch,
  retryPost,
  validatePublishBatch,
} from "@repo/services/publishing";
import {
  BatchPageSchema,
  BatchViewSchema,
  ListBatchesInputSchema,
  PublishBatchInputSchema,
  PublishBatchResultSchema,
  ValidationResultSchema,
} from "@repo/services/publishing/model";
import { z } from "zod";
import { rateLimited, router, scoped } from "../../trpc";

/** Send the event a post action asked for (dedup ids are per request). */
async function sendActionEvent(event: PostActionEvent | undefined) {
  if (!event) return;
  const id = `${event.name}:${event.data.postId}:${Date.now()}`;
  if (event.name === "post/publish.cancelled") await inngest.send(postPublishCancelled.create(event.data, { id }));
  else if (event.name === "post/delete.requested") await inngest.send(postDeleteRequested.create(event.data, { id }));
  else await inngest.send(postEditRequested.create(event.data, { id }));
}

export const postsRouter = router({
  /**
   * Not yet published → cancelled; published → deleting (Inngest) or
   * {mode:"manual"} when the platform can't delete; repeated calls are no-ops.
   */
  delete: rateLimited(scoped("posts:delete"), "delete")
    .meta({ openapi: { method: "DELETE", path: "/posts/{postId}", summary: "Cancel or delete a post (idempotent)", protect: true } })
    .input(PostIdInputSchema)
    .output(DeleteResultSchema)
    .mutation(async ({ ctx, input }) => {
      const { result, event } = await requestDelete(ctx.dbUserId, input.postId);
      await sendActionEvent(event);
      // A scheduled post's delete = cancel its schedule (job removed, run stopped).
      if (result.mode === "cancelled") await closeScheduleAfterCancel(input.postId, schedulingEffects);
      return result;
    }),

  deleteBatch: rateLimited(scoped("posts:delete"), "delete")
    .meta({ openapi: { method: "POST", path: "/posts/batches/{batchId}/delete", summary: "Cancel or delete the posts of a batch", protect: true } })
    .input(DeleteBatchInputSchema)
    .output(DeleteBatchResultSchema)
    .mutation(async ({ ctx, input }) => {
      const { results, events } = await requestDeleteBatch(ctx.dbUserId, input.batchId, input.socialConnectionIds);
      for (const event of events) await sendActionEvent(event);
      for (const result of results) {
        if (result.mode === "cancelled") await closeScheduleAfterCancel(result.postId, schedulingEffects);
      }
      return { results };
    }),

  /** Edit a live post (only the platform's editableFields; media never). Runs in Inngest. */
  update: rateLimited(scoped("posts:write"), "edit")
    .meta({ openapi: { method: "PATCH", path: "/posts/{postId}", summary: "Edit a published post", protect: true } })
    .input(UpdatePostInputSchema)
    .output(UpdateResultSchema)
    .mutation(async ({ ctx, input }) => {
      const { result, event } = await requestEdit(ctx.dbUserId, input.postId, input.changes);
      await sendActionEvent(event);
      return result;
    }),

  /** New post with the same media (same batch). deleteOriginal deletes the old one only after the new one is live. */
  repost: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/{postId}/repost", summary: "Publish a post again as a new post", protect: true } })
    .input(RepostInputSchema)
    .output(PublishBatchResultSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await requestRepost(ctx.dbUserId, input);
      await inngest.send(
        postsBatchRequested.create({ batchId: result.batchId, userId: ctx.dbUserId }, { id: `posts-batch:${result.batchId}:repost:${result.posts[0]?.id}` }),
      );
      return result;
    }),

  /** Dry run: the same checks as publishBatch (platform schemas + media rules), nothing written. */
  validate: scoped("posts:write")
    .meta({ openapi: { method: "POST", path: "/posts/validate", summary: "Check a publish batch without publishing", protect: true } })
    .input(PublishBatchInputSchema)
    .output(ValidationResultSchema)
    .mutation(({ ctx, input }) => validatePublishBatch(ctx.dbUserId, input)),

  /**
   * Creates the batch: instant targets are queued and handed to Inngest now;
   * scheduled targets (targets[].schedule ?? scheduleAll) wait in BullMQ.
   */
  publishBatch: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/batches", summary: "Publish media to one or more accounts", protect: true } })
    .input(PublishBatchInputSchema)
    .output(PublishBatchResultSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await publishBatch(ctx.dbUserId, input, { scheduling: schedulingEffects });
      // Event id = batch id: a replayed submit can't start a second fan-out.
      await inngest.send(
        postsBatchRequested.create({ batchId: result.batchId, userId: ctx.dbUserId }, { id: `posts-batch:${result.batchId}` }),
      );
      return result;
    }),

  /** New time for a scheduled (or uploading) post that isn't published. ISO time + IANA timezone, ≥ 2 min ahead. */
  reschedule: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/{postId}/reschedule", summary: "Move a scheduled post to a new time", protect: true } })
    .input(RescheduleInputSchema)
    .output(ScheduleResultSchema)
    .mutation(({ ctx, input }) => reschedule(ctx.dbUserId, input, schedulingEffects)),

  /** Cancel a scheduled post (idempotent). The post becomes cancelled. */
  cancelSchedule: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/{postId}/cancel-schedule", summary: "Cancel a scheduled post before it publishes", protect: true } })
    .input(SchedulePostIdInputSchema)
    .output(CancelScheduleResultSchema)
    .mutation(({ ctx, input }) => cancelSchedule(ctx.dbUserId, input.postId, schedulingEffects)),

  /** Publish a scheduled or missed post right away (uploads already done are reused). */
  publishNow: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/{postId}/publish-now", summary: "Publish a scheduled or missed post right away", protect: true } })
    .input(SchedulePostIdInputSchema)
    .output(ScheduleResultSchema)
    .mutation(({ ctx, input }) => publishNow(ctx.dbUserId, input.postId, schedulingEffects)),

  batch: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/posts/batches/{batchId}", summary: "Get a batch and the status of each post", protect: true } })
    .input(z.object({ batchId: z.uuid().describe("Batch ID.") }))
    .output(BatchViewSchema)
    .query(({ ctx, input }) => getBatch(ctx.dbUserId, input.batchId)),

  batches: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/posts/batches", summary: "List publish batches", protect: true } })
    .input(ListBatchesInputSchema)
    .output(BatchPageSchema)
    .query(({ ctx, input }) => listBatches(ctx.dbUserId, input)),

  /** Failed posts only: re-queue and re-send post/publish.requested. */
  retry: rateLimited(scoped("posts:write"), "publish")
    .meta({ openapi: { method: "POST", path: "/posts/{postId}/retry", summary: "Retry a failed post", protect: true } })
    .input(z.object({ postId: z.uuid().describe("ID of a failed post to retry.") }))
    .output(z.object({ postId: z.uuid().describe("Post ID."), queued: z.literal(true).describe("Always true: the retry was queued.") }))
    .mutation(async ({ ctx, input }) => {
      const retry = await retryPost(ctx.dbUserId, input.postId);
      await inngest.send(
        postPublishRequested.create(
          {
            postId: retry.postId,
            userId: ctx.dbUserId,
            socialConnectionId: retry.socialConnectionId,
            batchId: retry.batchId,
            attempt: retry.attempt,
          },
          { id: `post-publish:${retry.postId}:${retry.attempt}` },
        ),
      );
      return { postId: retry.postId, queued: true as const };
    }),

  get: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/posts/{postId}", summary: "Get one post with its edit history and capabilities", protect: true } })
    .input(PostIdInputSchema)
    .output(PostDetailSchema)
    .query(({ ctx, input }) => getPostDetail(ctx.dbUserId, input.postId)),
});
