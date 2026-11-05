import { z } from "zod";

export const SocialConnectionRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  provider: z.string().min(1),
  providerAccountId: z.string().min(1),
  accountType: z.string().nullable(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  accessTokenEncrypted: z.string().nullable(),
  refreshTokenEncrypted: z.string().nullable(),
  accessExpiry: z.date().nullable(),
  refreshExpiry: z.date().nullable(),
  scopes: z.array(z.string()).nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
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
  status: SocialConnectionStatusSchema,
});

export type SocialConnectionView = z.infer<typeof SocialConnectionViewSchema>;
