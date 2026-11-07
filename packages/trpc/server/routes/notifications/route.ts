import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@repo/services/notifications";
import {
  ListNotificationsInputSchema,
  MarkReadInputSchema,
  NotificationPageSchema,
} from "@repo/services/notifications/model";
import { z } from "zod";
import { zodUndefinedModel } from "../../schema";
import { router, scoped } from "../../trpc";

const UpdatedSchema = z.object({ updated: z.number().int().nonnegative().describe("Notifications newly marked read.") });

export const notificationsRouter = router({
  /** Newest first; cursor = base64("created_at|id"). */
  list: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/notifications", summary: "List notifications", protect: true } })
    .input(ListNotificationsInputSchema)
    .output(NotificationPageSchema)
    .query(({ ctx, input }) => listNotifications(ctx.dbUserId, input)),

  unreadCount: scoped("posts:read")
    .meta({ openapi: { method: "GET", path: "/notifications/unread-count", summary: "Count unread notifications", protect: true } })
    .input(zodUndefinedModel)
    .output(z.object({ count: z.number().int().nonnegative().describe("Unread notifications.") }))
    .query(async ({ ctx }) => ({ count: await countUnreadNotifications(ctx.dbUserId) })),

  markRead: scoped("posts:write")
    .meta({ openapi: { method: "POST", path: "/notifications/read", summary: "Mark notifications as read", protect: true } })
    .input(MarkReadInputSchema)
    .output(UpdatedSchema)
    .mutation(async ({ ctx, input }) => ({
      updated: await markNotificationsRead(ctx.dbUserId, input.ids),
    })),

  markAllRead: scoped("posts:write")
    .meta({ openapi: { method: "POST", path: "/notifications/read-all", summary: "Mark every notification as read", protect: true } })
    .input(zodUndefinedModel)
    .output(UpdatedSchema)
    .mutation(async ({ ctx }) => ({ updated: await markAllNotificationsRead(ctx.dbUserId) })),
});
