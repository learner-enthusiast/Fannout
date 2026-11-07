import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { media } from "./media";
import { users } from "./user";

/** A named group of media (e.g. one video's main cuts, trailers, thumbnails, subtitles). */
export const mediaFolders = pgTable(
  "media_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    coverMediaId: uuid("cover_media_id").references(() => media.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("media_folders_user_name_unique").on(table.userId, sql`lower(${table.name})`),
    index("media_folders_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
    index("media_folders_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
  ],
);
