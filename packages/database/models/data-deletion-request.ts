import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Meta deauthorize / data-deletion callbacks (Facebook + Threads). One row per
 * callback we accept; the confirmation code backs the public status page.
 * No PII: platform_user_id is the app-scoped id Meta sent; summary holds counts only.
 */
export const dataDeletionRequests = pgTable(
  "data_deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** facebook | threads */
    provider: text("provider").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    /** deauthorize | deletion */
    kind: text("kind").notNull(),
    confirmationCode: text("confirmation_code").notNull().unique(),
    /** received | processing | completed | no_data */
    status: text("status").notNull().default("received"),
    matchedConnectionIds: jsonb("matched_connection_ids").$type<string[]>().notNull().default([]),
    summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("data_deletion_requests_provider_user_idx").on(table.provider, table.platformUserId)],
);
