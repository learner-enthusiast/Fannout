import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("posts_user_id_idx").on(table.userId),
    index("posts_social_connection_id_idx").on(table.socialConnectionId),
  ],
);
