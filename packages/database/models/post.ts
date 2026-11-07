import {
  type AnyPgColumn,
  index,
  uniqueIndex,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { postMedia } from "./post-media";
import { socialConnections } from "./social-connection";
import { users } from "./user";

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    socialConnectionId: uuid("social_connection_id")
      .notNull()
      .references(() => socialConnections.id, { onDelete: "cascade" }),

    /** Short display name (≤100 chars), written by AI from the social JSON or the post titles. */
    name: text("name").notNull(),
    caption: text("caption"),
    config: jsonb("config").$type<Record<string, unknown>>(),

    status: text("status").notNull().default("draft"),

    externalPostId: text("external_post_id"),
    postUrl: text("post_url"),
    /** The post's primary/cover entry in post_media. */
    postMediaId: uuid("post_media").references((): AnyPgColumn => postMedia.id, {
      onDelete: "set null",
    }),

    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** Posts created together from the composer share a batch id. */
    batchId: uuid("batch_id"),
    /** Per-target key derived from the composer's idempotency key (one batch per submit). */
    idempotencyKey: text("idempotency_key"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    /** Delete (via Inngest). deleted_by: app | external. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    deleteErrorCode: text("delete_error_code"),
    deleteErrorMessage: text("delete_error_message"),
    /** live | hidden | deleted_externally | removed_by_platform | unknown */
    externalStatus: text("external_status").notNull().default("live"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),

    /** Edit (via Inngest). edit_status: editing | failed | null. */
    editStatus: text("edit_status"),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    editErrorCode: text("edit_error_code"),
    editErrorMessage: text("edit_error_message"),
    /** Last 10 edits: { at, before, after, by }. */
    revisions: jsonb("revisions").$type<unknown[]>().notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("posts_user_id_idx").on(table.userId),
    index("posts_social_connection_id_idx").on(table.socialConnectionId),
    index("posts_batch_id_idx").on(table.batchId),
    uniqueIndex("posts_user_idempotency_key_unique")
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);
