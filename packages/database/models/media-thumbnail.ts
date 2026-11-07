import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { media } from "./media";

/**
 * Images linked to a video as its thumbnails. `position` orders the set;
 * at most one row per video is primary (partial unique index). Type and
 * ownership checks (video ↔ image, same user) live in the service layer.
 */
export const mediaThumbnails = pgTable(
  "media_thumbnails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoMediaId: uuid("video_media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    imageMediaId: uuid("image_media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("media_thumbnails_video_image_unique").on(table.videoMediaId, table.imageMediaId),
    uniqueIndex("media_thumbnails_one_primary_per_video")
      .on(table.videoMediaId)
      .where(sql`${table.isPrimary}`),
    index("media_thumbnails_image_media_id_idx").on(table.imageMediaId),
  ],
);
