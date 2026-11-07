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

export const mediaUploadFailed = eventType("media/upload.failed", {
  schema: z.object({ mediaId: z.uuid(), userId: z.uuid(), error: z.string() }),
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
