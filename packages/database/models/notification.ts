import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { media } from "./media";
import { posts } from "./post";
import { users } from "./user";

/**
 * In-app notifications. Rows are inserted only by the `create-notification`
 * Inngest function; `dedupe_key` (the Inngest event id) makes retries safe.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** In-app path, e.g. /media/{id}. */
    link: text("link"),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_created_id_idx").on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("notifications_user_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
  ],
);
