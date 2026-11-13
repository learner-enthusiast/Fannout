import { z } from "zod";

export const SocialConnectionRowSchema = z.object({
  id: z.uuid().describe("Connection ID; use as socialConnectionId when publishing."),
  userId: z.uuid().describe("Owner's user ID."),
  provider: z.string().min(1).describe("LINKEDIN, X, YOUTUBE, FACEBOOK, THREADS or INSTAGRAM."),
  providerAccountId: z.string().min(1).describe("Account/page/channel ID on the platform."),
  accountType: z.string().nullable().describe("Kind of account, e.g. person, organization, page or channel."),
  username: z.string().nullable().describe("Account handle."),
  displayName: z.string().nullable().describe("Account display name."),
  profilePictureUrl: z.string().nullable().describe("Account avatar URL."),
  config: z.record(z.string(), z.unknown()).nullable().describe("Provider-specific settings for this account."),
  accessTokenEncrypted: z.string().nullable(),
  refreshTokenEncrypted: z.string().nullable(),
  accessExpiry: z.date().nullable().describe("When the platform access token expires."),
  refreshExpiry: z.date().nullable().describe("When the platform refresh token expires."),
  scopes: z.array(z.string()).nullable().describe("Platform permissions granted."),
  isActive: z.boolean().describe("False once disconnected."),
  createdAt: z.date().describe("When the account was connected."),
  updatedAt: z.date().describe("When the connection last changed."),
});

export type SocialConnectionRow = z.infer<typeof SocialConnectionRowSchema>;

/** Safe to return to clients: token fields stripped. */
export const SocialConnectionPublicSchema = SocialConnectionRowSchema.omit({
  accessTokenEncrypted: true,
  refreshTokenEncrypted: true,
});

export type SocialConnectionPublic = z.infer<typeof SocialConnectionPublicSchema>;

export const UpsertSocialConnectionInputSchema = z.object({
  userId: z.uuid(),
  provider: z.string().min(1),
  providerAccountId: z.string().min(1),
  accountType: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  profilePictureUrl: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  accessTokenEncrypted: z.string().nullable().optional(),
  refreshTokenEncrypted: z.string().nullable().optional(),
  accessExpiry: z.coerce.date().nullable().optional(),
  refreshExpiry: z.coerce.date().nullable().optional(),
  scopes: z.array(z.string()).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpsertSocialConnectionInput = z.input<typeof UpsertSocialConnectionInputSchema>;

export const UpdateSocialConnectionInputSchema = UpsertSocialConnectionInputSchema.omit({
  userId: true,
  provider: true,
  providerAccountId: true,
}).partial();

export type UpdateSocialConnectionInput = z.input<typeof UpdateSocialConnectionInputSchema>;

export const ListSocialConnectionsInputSchema = z.object({
  provider: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListSocialConnectionsInput = z.input<typeof ListSocialConnectionsInputSchema>;

export const SocialConnectionStatusSchema = z.enum(["connected", "reconnect", "disconnected"]);
export type SocialConnectionStatus = z.infer<typeof SocialConnectionStatusSchema>;

/** What clients see: no token fields, plus a derived status. */
export const SocialConnectionViewSchema = SocialConnectionPublicSchema.extend({
  status: SocialConnectionStatusSchema.describe("connected = ready to publish; reconnect = the human must reconnect in the web app; disconnected."),
});

export type SocialConnectionView = z.infer<typeof SocialConnectionViewSchema>;
