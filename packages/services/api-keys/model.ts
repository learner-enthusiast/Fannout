import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";

export const API_KEY_SCOPES = [
  "posts:read",
  "posts:write",
  "posts:delete",
  "media:read",
  "media:write",
  "connections:read",
  "ai:generate",
] as const;
export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const API_KEY_PREFIX = "fn_live_";
/** "fn_live_" + 32 base62 chars. */
export const ApiKeyFormatSchema = z.string().regex(/^fn_live_[0-9A-Za-z]{32}$/);
export const MAX_ACTIVE_KEYS = 10;

export const CreateApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(ApiKeyScopeSchema)
    .min(1)
    .refine((s) => new Set(s).size === s.length, "Each scope only once"),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(null),
});

export const ApiKeyViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** First 12 characters, safe to show. */
  prefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  tier: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type ApiKeyView = z.infer<typeof ApiKeyViewSchema>;

export const CreatedApiKeySchema = z.object({
  id: z.uuid(),
  /** The full key — returned only once. */
  key: z.string(),
  prefix: z.string(),
});

/** What a verified key grants. */
export type ApiKeyPrincipal = {
  apiKeyId: string;
  userId: string;
  scopes: ApiKeyScope[];
  tier: string;
};

export const ListApiKeysInputSchema = PaginationInputSchema;
export const ApiKeyPageSchema = paginatedOutput(ApiKeyViewSchema);
