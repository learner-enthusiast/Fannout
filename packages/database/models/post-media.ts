import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { media } from "./media";
import { posts } from "./post";

export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references((): AnyPgColumn => posts.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),

    role: text("role").notNull().default("attachment"),
    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("post_media_post_id_idx").on(table.postId),
    index("post_media_media_id_idx").on(table.mediaId),
    uniqueIndex("post_media_post_media_unique").on(table.postId, table.mediaId),
  ],
);
