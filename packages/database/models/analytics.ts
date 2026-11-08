import { sql } from "drizzle-orm";
import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { posts } from "./post";
import { socialConnections } from "./social-connection";

/**
 * Analytics are written ONLY by the Inngest sync jobs (packages/inngest/functions/analytics.ts);
 * dashboard requests read these tables and never call a platform.
 * `metrics` = normalized keys (services/analytics/model.ts → MetricsSchema); absent key = unsupported.
 * `raw` = the platform's own metric names/values, kept for later mapping.
 */

/** Point-in-time lifetime metrics for one published post (one row per sync). */
export const analyticsPostSnapshots = pgTable(
  "analytics_post_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    socialConnectionId: uuid("social_connection_id")
      .notNull()
      .references(() => socialConnections.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    /** Which API produced it, e.g. youtube.videos.list, x.tweets.lookup. */
    source: text("source").notNull(),
  },
  (table) => [
    index("analytics_post_snapshots_post_captured_idx").on(table.postId, table.capturedAt.desc()),
    index("analytics_post_snapshots_connection_idx").on(table.socialConnectionId),
  ],
);

/** One row per connection per day (platform-reported account metrics). Re-synced days are upserted. */
export const analyticsAccountDaily = pgTable(
  "analytics_account_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    socialConnectionId: uuid("social_connection_id")
      .notNull()
      .references(() => socialConnections.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("analytics_account_daily_connection_date_unique").on(table.socialConnectionId, table.date)],
);

/** Sync bookkeeping per connection. No row yet = never synced → the next hourly run backfills it. */
export const analyticsSyncState = pgTable(
  "analytics_sync_state",
  {
    socialConnectionId: uuid("social_connection_id")
      .primaryKey()
      .references(() => socialConnections.id, { onDelete: "cascade" }),
    /** ok | needs_reconnect | error */
    status: text("status").notNull().default("ok"),
    lastAccountSyncAt: timestamp("last_account_sync_at", { withTimezone: true }),
    lastPostSyncAt: timestamp("last_post_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    /** "Refresh now" is limited to one per 15 minutes per connection. */
    lastManualRefreshAt: timestamp("last_manual_refresh_at", { withTimezone: true }),
    backfilledAt: timestamp("backfilled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("analytics_sync_state_status_idx").on(table.status).where(sql`${table.status} <> 'ok'`)],
);
