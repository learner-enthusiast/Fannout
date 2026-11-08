import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";

export const NotificationTypeSchema = z.enum([
  "upload_succeeded",
  "upload_failed",
  "post_published",
  "post_failed",
  "post_scheduled",
  "schedule_failed",
  "schedule_missed",
  "post_deleted",
  "post_delete_failed",
  "post_edited",
  "post_edit_failed",
  "connection_removed",
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** In-app path only ("/media/123"), never an absolute or protocol-relative URL. */
export const InAppLinkSchema = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\s\\]*$/, "link must be an in-app path");

export const CreateNotificationInputSchema = z.object({
  userId: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000),
  link: InAppLinkSchema.nullish(),
  mediaId: z.uuid().nullish(),
  postId: z.uuid().nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type CreateNotificationInput = z.infer<typeof CreateNotificationInputSchema>;

export const NotificationViewSchema = z.object({
  id: z.uuid().describe("Notification ID."),
  type: NotificationTypeSchema.describe("What happened."),
  title: z.string().describe("Short headline."),
  body: z.string().describe("Longer message."),
  link: z.string().nullable().describe("In-app path the notification points to (web UI)."),
  mediaId: z.uuid().nullable().describe("Related media ID, if any."),
  postId: z.uuid().nullable().describe("Related post ID, if any."),
  data: z.record(z.string(), z.unknown()).describe("Extra event details (shape depends on type)."),
  readAt: z.date().nullable().describe("When it was marked read; null when unread."),
  createdAt: z.date().describe("When it was created."),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

export const ListNotificationsInputSchema = PaginationInputSchema.extend({
  unreadOnly: z.boolean().optional().describe("Only unread notifications."),
});
export type ListNotificationsInput = z.input<typeof ListNotificationsInputSchema>;

export const NotificationPageSchema = paginatedOutput(NotificationViewSchema);
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const MarkReadInputSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100).describe("Notification IDs to mark read.") });
