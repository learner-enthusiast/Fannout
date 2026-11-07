import { z } from "zod";

export const NotificationTypeSchema = z.enum([
  "upload_succeeded",
  "upload_failed",
  "post_published",
  "post_failed",
  "post_scheduled",
  "schedule_failed",
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
  id: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  postId: z.uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: z.date().nullable(),
  createdAt: z.date(),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;

export const ListNotificationsInputSchema = z.object({
  cursor: z.string().min(1).max(200).nullish(),
  limit: z.number().int().min(1).max(50).default(20),
  unreadOnly: z.boolean().optional(),
});
export type ListNotificationsInput = z.input<typeof ListNotificationsInputSchema>;

export const NotificationPageSchema = z.object({
  items: z.array(NotificationViewSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

export const MarkReadInputSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
