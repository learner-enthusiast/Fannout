import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

/**
 * One AI copy-generation request from Compose. Source text is never stored —
 * only the source media ids, the request (`input`), the result and usage.
 */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** queued | running | succeeded | failed */
    status: text("status").notNull().default("queued"),
    /** [{ connectionId, field }] or "all". */
    scope: jsonb("scope").$type<unknown>().notNull(),
    sourceMediaIds: jsonb("source_media_ids").$type<string[]>().notNull().default([]),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>(),
    issues: jsonb("issues").$type<unknown[]>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    model: text("model"),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("ai_generations_user_created_idx").on(table.userId, table.createdAt)],
);
