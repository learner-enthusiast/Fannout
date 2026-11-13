/**
 * Read cache for service-level get/list functions: cache-aside with a TTL, and
 * correctness from invalidate() on every write (the TTL is only a safety net).
 * See docs/conventions/api.md → "Caching".
 *
 * Keys:   fn:cache:v1:{userId}:{group}:{version}:{key}:{hash of input}
 * Version: fn:cache:v1:ver:{userId}:{group}  (INCR on invalidate; old entries become
 *          unreachable and expire by TTL — no KEYS / SCAN, ever)
 * Global:  fn:cache:v1:user:{clerkId}, fn:cache:v1:apikey:{hash} (exact keys, delKey())
 *
 * Fail open: any Redis error or timeout means "go to Postgres" and never fails a request.
 * Never cache tokens, presigned URLs, upload progress or rate-limiter state, and never read
 * through the cache in publish / delete / edit / media-processing / scheduler / token-refresh paths.
 */
import { createHash } from "node:crypto";
import { logger } from "@repo/logger";
import { getRedis } from "@repo/redis";
import type { z } from "zod";
import { env } from "../env";

const PREFIX = "fn:cache:v1";
const REDIS_TIMEOUT_MS = 200;
const VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const WARN_EVERY_MS = 60_000;

/** group → TTL (seconds). The one place TTLs live. TTL is a safety net, not the invalidation strategy. */
export const CACHE_TTL_SECONDS = {
  user: 86_400,
  /** Short on purpose: security backstop (a revoked key is also deleted at once). */
  apiKey: 300,
  connections: 21_600,
  /** Media lists, folders, folder items. */
  media: 86_400,
  /** Short on purpose: scheduled/missed states depend on time and external deletes are detected late. */
  posts: 600,
  /** List + unread count. */
  notifications: 3_600,
  /** Also invalidated when a sync finishes. */
  analytics: 21_600,
  /** Data that lives on the platform (playlists…); group name is `platform:{connectionId}`. */
  platform: 3_600,
  mentions: 86_400,
  aiPresets: 86_400,
} as const;

export type CacheGroup = Exclude<keyof typeof CACHE_TTL_SECONDS, "platform"> | `platform:${string}`;

const ttlFor = (group: string) => CACHE_TTL_SECONDS[(group.startsWith("platform:") ? "platform" : group) as keyof typeof CACHE_TTL_SECONDS];

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

let lastWarnAt = 0;
function warnOnce(message: string, error: unknown) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = now;
  logger.warn(message, { error: error instanceof Error ? error.message : String(error) });
}

/** Rejects after REDIS_TIMEOUT_MS so a slow Redis can't slow a request. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis timeout after ${REDIS_TIMEOUT_MS} ms`)), REDIS_TIMEOUT_MS);
  });
  // The original promise may reject after the timeout wins: don't leave it unhandled.
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * tRPC here has no transformer (no superjson), so values are stored as JSON with Dates tagged:
 * `{"$date": ISO}` survives the round trip and validates against z.date() output models.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, current: unknown) {
    const original = this[key];
    return original instanceof Date ? { $date: original.toISOString() } : current;
  });
}
function deserialize(raw: string): unknown {
  return JSON.parse(raw, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length === 1 && typeof record.$date === "string") return new Date(record.$date);
    }
    return value;
  });
}

/** Stable JSON: object keys sorted, undefined dropped, so equal inputs always hash the same. */
function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const hashInput = (input: unknown) => createHash("sha256").update(stable(input)).digest("hex").slice(0, 16);

const versionKey = (userId: string, group: string) => `${PREFIX}:ver:${userId}:${group}`;

/** Exact key for the global (not per-user) entries: globalKey("user", clerkId), globalKey("apikey", hash). */
export const globalKey = (kind: "user" | "apikey", id: string) => `${PREFIX}:${kind}:${id}`;

/** Jitter ±10% so keys written together don't all expire together. */
const withJitter = (seconds: number) => Math.max(1, Math.round(seconds * (0.9 + Math.random() * 0.2)));

const inFlight = new Map<string, Promise<unknown>>();

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export type CachedOptions<T> = {
  /** Owner of the entry. `null` = a global entry whose exact key is `globalKey(...)` passed as `key`. */
  userId: string | null;
  group: CacheGroup;
  /** Function name (per-user entries) or the exact global key (userId null). */
  key: string;
  /** Everything that changes the result: cursor, limit, search text, filters, tab, connection id, folder id… */
  input?: unknown;
  ttlSeconds?: number;
  /** The OUTPUT model: a cached value that no longer validates is a miss and is deleted. */
  schema: z.ZodType<T>;
  load: () => Promise<T>;
  /** Treat a cached value as a miss (e.g. a scheduled post whose time has passed). */
  isStale?: (value: T) => boolean;
  /** Return false to skip storing this result (e.g. a post is mid-publish). The value is still returned. */
  cacheable?: (value: T) => boolean;
  /** Transform before storing only (e.g. drop fields that must never sit in Redis). */
  forCache?: (value: T) => unknown;
};

export async function cached<T>(options: CachedOptions<T>): Promise<T> {
  const { userId, group, key, input, schema, load, isStale } = options;
  if (!env.CACHE_ENABLED) return load();

  let fullKey: string;
  try {
    if (userId === null) {
      fullKey = key;
    } else {
      const version = Number(await withTimeout(getRedis().get(versionKey(userId, group)))) || 0;
      fullKey = `${PREFIX}:${userId}:${group}:${version}:${key}:${hashInput(input)}`;
    }
  } catch (error) {
    warnOnce("Cache unavailable, reading Postgres", error);
    logger.debug("cache", { group, result: "bypass" });
    return load();
  }

  try {
    const raw = await withTimeout(getRedis().get(fullKey));
    if (raw !== null) {
      const parsed = schema.safeParse(deserialize(raw));
      if (parsed.success && !(isStale?.(parsed.data) ?? false)) {
        logger.debug("cache", { group, result: "hit" });
        return parsed.data;
      }
      if (!parsed.success) await withTimeout(getRedis().unlink(fullKey)).catch(() => undefined);
    }
  } catch (error) {
    warnOnce("Cache read failed, reading Postgres", error);
  }
  logger.debug("cache", { group, result: "miss" });

  // Single-flight: concurrent misses for the same key in this process share one load().
  const existing = inFlight.get(fullKey) as Promise<T> | undefined;
  if (existing) return existing;
  const flight = (async () => {
    const value = await load();
    try {
      const ttl = withJitter(options.ttlSeconds ?? ttlFor(group));
      if (options.cacheable && !options.cacheable(value)) return value;
      const payload = serialize(options.forCache ? options.forCache(value) : value);
      if (payload !== undefined) await withTimeout(getRedis().set(fullKey, payload, "EX", ttl));
    } catch (error) {
      warnOnce("Cache write failed", error);
    }
    return value;
  })().finally(() => inFlight.delete(fullKey));
  inFlight.set(fullKey, flight);
  return flight;
}

/**
 * Call AFTER the database change has committed (never inside an open transaction), from the
 * service-layer write function, so every caller is covered. Bumps each group's version: old
 * entries become unreachable and expire by TTL.
 */
export async function invalidate(userId: string, ...groups: CacheGroup[]): Promise<void> {
  if (!env.CACHE_ENABLED || groups.length === 0) return;
  try {
    const pipeline = getRedis().pipeline();
    for (const group of groups) {
      const key = versionKey(userId, group);
      pipeline.incr(key);
      // Version keys live 30 days, refreshed on every bump.
      pipeline.expire(key, VERSION_TTL_SECONDS);
    }
    await withTimeout(pipeline.exec());
  } catch (error) {
    warnOnce("Cache invalidation failed (entries expire by TTL)", error);
  }
}

/** Delete one exact key (the global user / apiKey entries). */
export async function delKey(exactKey: string): Promise<void> {
  if (!env.CACHE_ENABLED) return;
  try {
    await withTimeout(getRedis().unlink(exactKey));
  } catch (error) {
    warnOnce("Cache delete failed (entry expires by TTL)", error);
  }
}
