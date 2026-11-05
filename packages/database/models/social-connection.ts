import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./user";

export const socialConnections = pgTable(
  "social_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accountType: text("account_type"),

    username: text("username"),
    displayName: text("display_name"),
    profilePictureUrl: text("profile_picture_url"),

    config: jsonb("config").$type<Record<string, unknown>>(),

    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessExpiry: timestamp("access_expiry", { withTimezone: true }),
    refreshExpiry: timestamp("refresh_expiry", { withTimezone: true }),

    scopes: jsonb("scopes").$type<string[]>(),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("social_connections_user_id_idx").on(table.userId),
    uniqueIndex("social_connections_user_provider_account_unique").on(
      table.userId,
      table.provider,
      table.providerAccountId,
    ),
  ],
);
