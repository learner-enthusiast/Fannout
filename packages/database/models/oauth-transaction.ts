import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

/**
 * Server-side state for an in-flight OAuth connection. One row per
 * authorization attempt; `state` is stored only as a SHA-256 hash and each
 * row can be consumed exactly once (status transition is atomic).
 */
export const oauthTransactions = pgTable(
  "oauth_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),

    /** pending → consumed | awaiting_selection → completed */
    status: text("status").notNull().default("pending"),

    codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
    nonce: text("nonce"),
    /** SHA-256 of the browser-binding cookie set when the flow started. */
    browserBindingHash: text("browser_binding_hash").notNull(),
    /** Validated relative path on the web app to return to. */
    returnTo: text("return_to").notNull(),

    /** Encrypted tokens + identity awaiting a YouTube channel choice. */
    pendingPayloadEncrypted: text("pending_payload_encrypted"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("oauth_transactions_user_id_idx").on(table.userId),
    index("oauth_transactions_expires_at_idx").on(table.expiresAt),
  ],
);
