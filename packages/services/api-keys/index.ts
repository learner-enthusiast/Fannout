import { and, apiKeys, count, db, desc, eq, isNull } from "@repo/database";
import { errors } from "@repo/errors";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { afterCursor, cursorTimestamp, toPage } from "../common/pagination";
import { cached, delKey, globalKey } from "../cache";
import { env } from "../env";
import {
  API_KEY_PREFIX,
  ApiKeyFormatSchema,
  ApiKeyScopeSchema,
  CreateApiKeyInputSchema,
  ListApiKeysInputSchema,
  MAX_ACTIVE_KEYS,
  type ApiKeyPrincipal,
  type ApiKeyView,
} from "./model";

/** Safe subset cached under fn:cache:v1:apikey:{hash}: no key material, only what verification needs. */
const ApiKeyLookupSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scopes: z.unknown(),
  tier: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 32 base62 chars from crypto.randomBytes (rejection sampling: no modulo bias). */
export function generateApiKey(): string {
  let out = "";
  while (out.length < 32) {
    for (const byte of randomBytes(48)) {
      if (byte < 248 && out.length < 32) out += BASE62[byte % 62];
    }
  }
  return API_KEY_PREFIX + out;
}

/** HMAC-SHA256(key, API_KEY_PEPPER) as hex — the only thing stored. */
export function hashApiKey(key: string, pepper = env.API_KEY_PEPPER): string {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

export const keyPrefixOf = (key: string) => key.slice(0, 12);

const UuidSchema = z.uuid();

function toView(row: typeof apiKeys.$inferSelect): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: z.array(ApiKeyScopeSchema).catch([]).parse(row.scopes),
    tier: row.tier,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** Creates a key; the full key is in the result and nowhere else. Max 10 active per user. */
export async function createApiKey(userId: string, input: z.input<typeof CreateApiKeyInputSchema>) {
  const data = CreateApiKeyInputSchema.parse(input);
  const owner = UuidSchema.parse(userId);
  const [active] = await db
    .select({ value: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, owner), isNull(apiKeys.revokedAt)));
  if ((active?.value ?? 0) >= MAX_ACTIVE_KEYS) return errors.conflict(`You can have at most ${MAX_ACTIVE_KEYS} active API keys`);

  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: owner,
      name: data.name,
      prefix: keyPrefixOf(key),
      keyHash: hashApiKey(key),
      scopes: data.scopes,
      expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000) : null,
    })
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix });
  await delKey(globalKey("apikey", hashApiKey(key)));
  return { id: row!.id, key, prefix: row!.prefix };
}

/** Newest first, 10 per page (created_at DESC, id DESC). */
export async function listApiKeys(userId: string, input: z.input<typeof ListApiKeysInputSchema> = {}) {
  const { cursor, limit } = ListApiKeysInputSchema.parse(input);
  const rows = await db
    .select({ row: apiKeys, cursorTs: cursorTimestamp(apiKeys.createdAt) })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, UuidSchema.parse(userId)), afterCursor(apiKeys.createdAt, apiKeys.id, cursor ?? undefined)))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    .limit(limit + 1);
  const page = toPage(rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row })), limit);
  return { items: page.items.map((item): ApiKeyView => toView(item.row)), nextCursor: page.nextCursor };
}

export async function revokeApiKey(userId: string, id: string): Promise<ApiKeyView> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, UuidSchema.parse(id)), eq(apiKeys.userId, UuidSchema.parse(userId)), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) return errors.notFound("API key");
  // Committed: a revoked key must stop working immediately, not after the 5-minute TTL.
  await delKey(globalKey("apikey", row.keyHash));
  return toView(row);
}

/** last_used_at/ip are written at most once per minute per key (not per request). */
const lastTouched = new Map<string, number>();
const TOUCH_EVERY_MS = 60_000;

/**
 * format → lookup by key_hash → timingSafeEqual → not revoked/expired.
 * Returns null for anything invalid (the caller penalizes the IP).
 */
export async function verifyApiKey(rawKey: string, ip?: string | null, now = new Date(), options: { fresh?: boolean } = {}): Promise<ApiKeyPrincipal | null> {
  if (!ApiKeyFormatSchema.safeParse(rawKey).success) return null;
  const hash = hashApiKey(rawKey);
  const loadRow = async () => {
    const [found] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    if (!found) return null;
    const a = Buffer.from(found.keyHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return found;
  };
  // `fresh` (write endpoints / scope checks on writes) reads Postgres directly.
  const row = options.fresh
    ? await loadRow()
    : await cached({
        userId: null,
        group: "apiKey",
        key: globalKey("apikey", hash),
        schema: ApiKeyLookupSchema.nullable(),
        isStale: (value) => value === null,
        load: async () => {
          const found = await loadRow();
          return found
            ? { id: found.id, userId: found.userId, scopes: found.scopes, tier: found.tier, lastUsedAt: found.lastUsedAt, expiresAt: found.expiresAt, revokedAt: found.revokedAt }
            : null;
        },
      });
  if (!row) return null;
  if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) return null;

  const last = lastTouched.get(row.id) ?? row.lastUsedAt?.getTime() ?? 0;
  if (now.getTime() - last >= TOUCH_EVERY_MS) {
    lastTouched.set(row.id, now.getTime());
    void db
      .update(apiKeys)
      .set({ lastUsedAt: now, lastUsedIp: ip ?? null })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);
  }
  return {
    apiKeyId: row.id,
    userId: row.userId,
    scopes: z.array(ApiKeyScopeSchema).catch([]).parse(row.scopes),
    tier: row.tier,
  };
}
