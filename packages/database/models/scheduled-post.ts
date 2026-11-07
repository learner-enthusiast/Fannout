import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { posts } from "./post";
import { users } from "./user";

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .unique()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** UTC. The final publish call happens at this time. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** scheduled_at − lead time: when the worker hands off to Inngest (upload/prepare starts). */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** IANA name, display only. */
    timezone: text("timezone").notNull(),

    /** scheduled | handed_off | completed | cancelled | missed | failed */
    status: text("status").notNull().default("scheduled"),

    queueJobId: text("queue_job_id"),
    scheduleVersion: integer("schedule_version").notNull().default(1),

    lockedAt: timestamp("locked_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    missedAt: timestamp("missed_at", { withTimezone: true }),
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("scheduled_posts_user_id_idx").on(table.userId),
    index("scheduled_posts_status_scheduled_at_idx").on(table.status, table.scheduledAt),
    index("scheduled_posts_status_start_at_idx").on(table.status, table.startAt),
  ],
);
