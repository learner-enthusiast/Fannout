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
import { protectedProcedure, router } from "../../trpc";

const UpdatedSchema = z.object({ updated: z.number().int().nonnegative() });

export const notificationsRouter = router({
  /** Newest first; cursor = base64("created_at|id"). */
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/notifications", protect: true } })
    .input(ListNotificationsInputSchema)
    .output(NotificationPageSchema)
    .query(({ ctx, input }) => listNotifications(ctx.dbUserId, input)),

  unreadCount: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/notifications/unread-count", protect: true } })
    .input(zodUndefinedModel)
    .output(z.object({ count: z.number().int().nonnegative() }))
    .query(async ({ ctx }) => ({ count: await countUnreadNotifications(ctx.dbUserId) })),

  markRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/notifications/read", protect: true } })
    .input(MarkReadInputSchema)
    .output(UpdatedSchema)
    .mutation(async ({ ctx, input }) => ({
      updated: await markNotificationsRead(ctx.dbUserId, input.ids),
    })),

  markAllRead: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/notifications/read-all", protect: true } })
    .input(zodUndefinedModel)
    .output(UpdatedSchema)
    .mutation(async ({ ctx }) => ({ updated: await markAllNotificationsRead(ctx.dbUserId) })),
});
