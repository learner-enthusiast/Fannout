import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./user";

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),

    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),

    s3Bucket: text("s3_bucket").notNull(),
    s3Key: text("s3_key").notNull().unique(),
    s3Region: text("s3_region").notNull(),

    width: integer("width"),
    height: integer("height"),
    durationSeconds: numeric("duration_seconds", { mode: "number" }),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("media_user_id_idx").on(table.userId)],
);
