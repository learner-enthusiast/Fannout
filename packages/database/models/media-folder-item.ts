import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { media } from "./media";
import { mediaFolders } from "./media-folder";

/**
 * Media placed in a folder under a role (main_landscape, thumbnail, …).
 * Role ↔ media type and same-user rules live in services/media-folders.
 */
export const mediaFolderItems = pgTable(
  "media_folder_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => mediaFolders.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** Required when role = other. */
    label: text("label"),
    position: integer("position").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("media_folder_items_folder_media_unique").on(table.folderId, table.mediaId),
    uniqueIndex("media_folder_items_one_primary_per_role")
      .on(table.folderId, table.role)
      .where(sql`${table.isPrimary}`),
    index("media_folder_items_media_id_idx").on(table.mediaId),
  ],
);
