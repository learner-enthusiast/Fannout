import { and, count, db, desc, eq, inArray, isNotNull, isNull, lt, notifications } from "@repo/database";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { afterCursor, cursorTimestamp, toPage } from "../lib/cursor";
import {
  CreateNotificationInputSchema,
  ListNotificationsInputSchema,
  NotificationPageSchema,
  NotificationViewSchema,
  type CreateNotificationInput,
  type ListNotificationsInput,
  type NotificationPage,
  type NotificationView,
} from "./model";

const UuidSchema = z.uuid();
const FOREIGN_KEY_VIOLATION = "23503";

function isForeignKeyViolation(error: unknown) {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === FOREIGN_KEY_VIOLATION || cause?.code === FOREIGN_KEY_VIOLATION;
}

/**
 * Inserts a notification. `dedupeKey` (the Inngest event id) is unique, so a
 * retried event never creates a second row: returns null when it already exists.
 * Only the create-notification Inngest function should call this.
 */
export async function createNotification(
  input: CreateNotificationInput,
  dedupeKey: string,
): Promise<NotificationView | null> {
  const data = CreateNotificationInputSchema.parse(input);
  const values = {
    userId: data.userId,
    type: data.type,
    title: data.title,
    body: data.body,
    link: data.link ?? null,
    mediaId: data.mediaId ?? null,
    postId: data.postId ?? null,
    data: data.data ?? {},
    dedupeKey: z.string().min(1).max(200).parse(dedupeKey),
  };
  const insert = (row: typeof values) =>
    db
      .insert(notifications)
      .values(row)
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning();

  let rows;
  try {
    rows = await insert(values);
  } catch (error) {
    // The media/post was deleted before the notification landed: keep the message, drop the reference.
    if (!isForeignKeyViolation(error)) throw error;
    rows = await insert({ ...values, mediaId: null, postId: null });
  }
  if (!rows[0]) return null;
  await invalidate(data.userId, "notifications");
  return NotificationViewSchema.parse(rows[0]);
}

export async function listNotifications(
  userId: string,
  input: ListNotificationsInput = {},
): Promise<NotificationPage> {
  const { cursor, limit, unreadOnly } = ListNotificationsInputSchema.parse(input);
  return cached({
    userId,
    group: "notifications",
    key: "listNotifications",
    input: { cursor: cursor ?? null, limit, unreadOnly: Boolean(unreadOnly) },
    schema: NotificationPageSchema,
    load: () => loadNotifications(userId, { cursor, limit, unreadOnly }),
  });
}

async function loadNotifications(
  userId: string,
  { cursor, limit, unreadOnly }: { cursor?: string | null; limit: number; unreadOnly?: boolean },
): Promise<NotificationPage> {
  const rows = await db
    .select({ row: notifications, cursorTs: cursorTimestamp(notifications.createdAt) })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, UuidSchema.parse(userId)),
        unreadOnly ? isNull(notifications.readAt) : undefined,
        afterCursor(notifications.createdAt, notifications.id, cursor ?? undefined),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = toPage(
    rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row })),
    limit,
  );
  return {
    items: page.items.map((item) => NotificationViewSchema.parse(item.row)),
    nextCursor: page.nextCursor,
  };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return cached({
    userId,
    group: "notifications",
    key: "countUnreadNotifications",
    schema: z.number().int().nonnegative(),
    load: () => loadUnreadCount(userId),
  });
}

async function loadUnreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, UuidSchema.parse(userId)), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  const parsed = z.array(UuidSchema).min(1).parse(ids);
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, UuidSchema.parse(userId)),
        inArray(notifications.id, parsed),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  if (rows.length) await invalidate(userId, "notifications");
  return rows.length;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, UuidSchema.parse(userId)), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (rows.length) await invalidate(userId, "notifications");
  return rows.length;
}

/** Deletes read notifications created before `before`. */
export async function pruneReadNotifications(before: Date): Promise<number> {
  const rows = await db
    .delete(notifications)
    .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, before)))
    .returning({ id: notifications.id, userId: notifications.userId });
  for (const userId of new Set(rows.map((row) => row.userId))) await invalidate(userId, "notifications");
  return rows.length;
}
