import { NotificationTypeSchema } from "@repo/services/notifications/model";
import { eventType } from "inngest";
import { z } from "zod";

/**
 * Typed event definitions (inngest v4 `eventType`). Zod schemas are used for
 * runtime validation; they must not use transforms.
 *
 * send: await inngest.send(mediaUploadCompleted.create({ mediaId, userId }));
 */

export const mediaUploadCompleted = eventType("media/upload.completed", {
  schema: z.object({ mediaId: z.uuid(), userId: z.uuid() }),
});

/** One Inngest run per job — single or bulk library delete. */
export const mediaDeleteRequested = eventType("media/delete.requested", {
  schema: z.object({
    userId: z.uuid(),
    jobId: z.uuid(),
    mediaIds: z.array(z.uuid()).min(1).max(100),
  }),
});

export const mediaUploadFailed = eventType("media/upload.failed", {
  schema: z.object({ mediaId: z.uuid(), userId: z.uuid(), error: z.string() }),
});

/** process-media finished: the media is "ready". publish-post waits on it (step.waitForEvent). */
export const mediaReady = eventType("media/ready", {
  schema: z.object({ mediaId: z.uuid(), userId: z.uuid() }),
});

/** The media will never become ready (bad file, cancelled, expired). */
export const mediaFailed = eventType("media/failed", {
  schema: z.object({ mediaId: z.uuid(), userId: z.uuid(), reason: z.string() }),
});

export const NotificationEventSchema = z.object({
  userId: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().optional(),
  mediaId: z.uuid().optional(),
  postId: z.uuid().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type NotificationEventData = z.infer<typeof NotificationEventSchema>;

/** The only way to create a notification (handled by `create-notification`). */
export const notificationCreate = eventType("notification/create", {
  schema: NotificationEventSchema,
});

/** Composer submit: fan out one publish per queued post in the batch. */
export const postsBatchRequested = eventType("posts/batch.requested", {
  schema: z.object({ batchId: z.uuid(), userId: z.uuid() }),
});

/**
 * Publish one post (also sent by "Retry"; `attempt` keeps event ids unique).
 * Scheduled posts (sent by apps/worker's hand-off) add scheduleVersion +
 * publishAt: prepare runs now, the final publish call waits until publishAt.
 */
export const postPublishRequested = eventType("post/publish.requested", {
  schema: z.object({
    postId: z.uuid(),
    userId: z.uuid(),
    socialConnectionId: z.uuid(),
    batchId: z.uuid().nullable(),
    attempt: z.number().int().nonnegative(),
    scheduleVersion: z.number().int().positive().optional(),
    publishAt: z.iso.datetime({ offset: true }).optional(),
  }),
});

/** A schedule was rescheduled / cancelled / published now: cancels the in-flight publish-post run. */
export const postScheduleChanged = eventType("post/schedule.changed", {
  schema: z.object({ postId: z.uuid() }),
});

/** Compose "Generate with AI": run one ai_generations row. */
export const aiContentGenerateRequested = eventType("ai/content.generate.requested", {
  schema: z.object({ generationId: z.uuid(), userId: z.uuid() }),
});

/** Ask AI to name every post in a batch (after publishing starts; also used for backfills). */
export const postsBatchNameRequested = eventType("posts/batch.name.requested", {
  schema: z.object({ batchId: z.uuid(), userId: z.uuid() }),
});

/** Cancels an in-flight publish (publish-post declares cancelOn for it). */
export const postPublishCancelled = eventType("post/publish.cancelled", {
  schema: z.object({ postId: z.uuid() }),
});

const PostActionSchema = z.object({ postId: z.uuid(), userId: z.uuid(), socialConnectionId: z.uuid() });

/** Delete a published post on its platform. */
export const postDeleteRequested = eventType("post/delete.requested", { schema: PostActionSchema });

/** Apply posts.config.pendingEdit on the platform. */
export const postEditRequested = eventType("post/edit.requested", { schema: PostActionSchema });

/** Analytics: sync one connection's account metrics (days back; 28 = backfill). Sent by the crons and analytics.refresh. */
export const analyticsAccountSyncRequested = eventType("analytics/account.sync.requested", {
  schema: z.object({ connectionId: z.uuid(), platform: z.string(), days: z.number().int().min(1).max(90) }),
});

/** Analytics: snapshot the connection's due published posts. */
export const analyticsPostSyncRequested = eventType("analytics/posts.sync.requested", {
  schema: z.object({ connectionId: z.uuid(), platform: z.string() }),
});

/** Meta (Facebook/Threads) data-deletion callback accepted → delete that user's Meta data. */
export const metaDataDeletionRequested = eventType("meta/data-deletion.requested", {
  schema: z.object({ requestId: z.uuid() }),
});
