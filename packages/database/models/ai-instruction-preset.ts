import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

/** Reusable global/per-account instructions shown in the composer. */
export const aiInstructionPresets = pgTable(
  "ai_instruction_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_instruction_presets_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc())],
);