import { z } from "zod";

// ---------- providers ----------

/** URL segment used by /api/oauth/:provider/... */
export const OAuthProviderSlugSchema = z.enum(["linkedin", "x", "youtube", "facebook", "threads", "instagram"]);
export type OAuthProviderSlug = z.infer<typeof OAuthProviderSlugSchema>;

/** Value stored in social_connections.provider. */
export const SocialProviderSchema = z.enum(["LINKEDIN", "X", "YOUTUBE", "FACEBOOK", "THREADS", "INSTAGRAM"]);
export type SocialProvider = z.infer<typeof SocialProviderSchema>;

export const PROVIDER_BY_SLUG = {
  linkedin: "LINKEDIN",
  x: "X",
  youtube: "YOUTUBE",
  facebook: "FACEBOOK",
  threads: "THREADS",
  instagram: "INSTAGRAM",
} as const satisfies Record<OAuthProviderSlug, SocialProvider>;

// ---------- redirect safety ----------

const RETURN_TO_BASE = "https://return-to.invalid";

/**
 * Only same-app relative paths are allowed ("/connections?tab=x"). Rejects
 * absolute URLs, protocol-relative "//evil.com", backslash tricks and
 * control characters, so the callback can never become an open redirect.
 */
export function isSafeReturnTo(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  try {
    return new URL(value, RETURN_TO_BASE).origin === RETURN_TO_BASE;
  } catch {
    return false;
  }
}

export const DEFAULT_RETURN_TO = "/connections";

export const ReturnToSchema = z
  .string()
  .max(512)
  .refine(isSafeReturnTo, { message: "returnTo must be a relative path" });

// ---------- accounts & tokens (server-only) ----------

export const ConnectedAccountSchema = z.object({
  provider: SocialProviderSchema,
  providerAccountId: z.string().min(1),
  accountType: z.string().min(1),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  /**
   * Token specific to this account, used instead of the grant's token
   * (Facebook Page access tokens). Server-only; stored encrypted.
   */
  accessToken: z.string().min(1).optional(),
});
export type ConnectedAccount = z.infer<typeof ConnectedAccountSchema>;

/** Plaintext tokens. Never leaves the server; only persisted encrypted. */
export const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  accessExpiry: z.coerce.date().nullable(),
  refreshExpiry: z.coerce.date().nullable(),
  scopes: z.array(z.string()),
});
export type TokenSet = z.infer<typeof TokenSetSchema>;

/** Encrypted blob stored while the user picks YouTube channel(s). */
export const PendingSelectionPayloadSchema = z.object({
  tokens: TokenSetSchema,
  accounts: z.array(ConnectedAccountSchema).min(2),
});
export type PendingSelectionPayload = z.infer<typeof PendingSelectionPayloadSchema>;

// ---------- results ----------

export const OAuthFailureReasonSchema = z.enum([
  "not_configured",
  "invalid_request",
  "invalid_state",
  "expired_state",
  "session_mismatch",
  "access_denied",
  "provider_error",
  "token_exchange_failed",
  "id_token_invalid",
  "insufficient_scope",
  "identity_failed",
  "no_account",
  "server_error",
]);
export type OAuthFailureReason = z.infer<typeof OAuthFailureReasonSchema>;

export type OAuthCallbackResult =
  | { status: "connected"; provider: SocialProvider; returnTo: string; connectionIds: string[] }
  | { status: "select_channel"; provider: SocialProvider; returnTo: string; selectionId: string }
  | { status: "failed"; provider: SocialProvider; returnTo: string; reason: OAuthFailureReason };

export const StartConnectionInputSchema = z.object({
  userId: z.uuid(),
  provider: OAuthProviderSlugSchema,
  returnTo: ReturnToSchema.default(DEFAULT_RETURN_TO),
});
export type StartConnectionInput = z.input<typeof StartConnectionInputSchema>;

export type StartConnectionResult = {
  authorizationUrl: string;
  /** Random value the HTTP layer must put in an HttpOnly cookie. */
  bindingToken: string;
  expiresAt: Date;
};

// ---------- account selection: YouTube channels / Facebook Pages (safe for clients) ----------

export const ChannelOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  handle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export const ChannelSelectionSchema = z.object({
  id: z.uuid(),
  provider: SocialProviderSchema,
  /** Who granted access: Google email (YouTube) or Facebook user name. */
  accountLabel: z.string().nullable(),
  expiresAt: z.date(),
  channels: z.array(ChannelOptionSchema),
});
export type ChannelSelection = z.infer<typeof ChannelSelectionSchema>;

export const FinalizeChannelSelectionInputSchema = z.object({
  selectionId: z.uuid(),
  channelIds: z.array(z.string().min(1)).min(1).max(50),
});
export type FinalizeChannelSelectionInput = z.input<typeof FinalizeChannelSelectionInputSchema>;
