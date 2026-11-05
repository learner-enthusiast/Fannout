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

    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),

    status: text("status").notNull().default("pending"),

    queueJobId: text("queue_job_id"),
    scheduleVersion: integer("schedule_version").notNull().default(1),

    lockedAt: timestamp("locked_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("scheduled_posts_user_id_idx").on(table.userId),
    index("scheduled_posts_status_scheduled_at_idx").on(table.status, table.scheduledAt),
  ],
);
