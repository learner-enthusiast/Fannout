import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

/** Saved @-mention destinations, scoped to a Fannout user and platform. */
export const mentionContacts = pgTable(
  "mention_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    platformRef: text("platform_ref"),
    avatarUrl: text("avatar_url"),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("mention_contacts_user_platform_idx").on(table.userId, table.platform),
    uniqueIndex("mention_contacts_user_platform_target_unique").on(
      table.userId,
      table.platform,
      sql`coalesce(${table.handle}, ${table.platformRef})`,
    ),
  ],
);