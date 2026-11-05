import { logger } from "@repo/logger";
import type { Redis } from "ioredis";
import type { z } from "zod";
import { getRedis } from "./connection";
import { env } from "./env";

type CacheOptions<T> = {
  /** Validates cached values on read; a mismatch is treated as a miss and evicted. */
  schema?: z.ZodType<T>;
  /** Use another client (tests, a dedicated cache instance). */
  client?: Redis;
};

/** Namespaced key: cacheKey("user", id) → "fannout:cache:user:<id>". */
export function cacheKey(...parts: Array<string | number>): string {
  return `${env.REDIS_CACHE_PREFIX}${parts.join(":")}`;
}

export async function cacheGet<T>(key: string, options: CacheOptions<T> = {}): Promise<T | null> {
  const client = options.client ?? getRedis();
  const raw = await client.get(key);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!options.schema) return value as T;
    const parsed = options.schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // fall through: corrupt entry
  }
  await client.unlink(key);
  return null;
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
  options: Pick<CacheOptions<unknown>, "client"> = {},
): Promise<void> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("cacheSet ttlSeconds must be a positive integer");
  }
  await (options.client ?? getRedis()).set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDelete(
  keys: string | string[],
  options: Pick<CacheOptions<unknown>, "client"> = {},
): Promise<number> {
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.length === 0) return 0;
  return (options.client ?? getRedis()).unlink(...list);
}

/** Delete every key starting with `prefix` (SCAN-based; safe on large keyspaces). */
export async function cacheDeleteByPrefix(
  prefix: string,
  options: Pick<CacheOptions<unknown>, "client"> = {},
): Promise<number> {
  const client = options.client ?? getRedis();
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    if (keys.length > 0) deleted += await client.unlink(...keys);
  } while (cursor !== "0");
  return deleted;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Read-through cache. On a miss, runs `loader`, stores the result for
 * `ttlSeconds` and returns it. Concurrent misses for the same key in this
 * process share one loader call. If Redis is unavailable the loader result is
 * returned uncached, so caching never takes the app down.
 * `undefined` results are not cached.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  options: CacheOptions<T> = {},
): Promise<T> {
  try {
    const hit = await cacheGet(key, options);
    if (hit !== null) return hit;
  } catch (error) {
    logger.error("Cache read failed", { key, message: (error as Error).message });
    return loader();
  }

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const load = (async () => {
    const value = await loader();
    if (value !== undefined) {
      await cacheSet(key, value, ttlSeconds, options).catch((error: Error) =>
        logger.error("Cache write failed", { key, message: error.message }),
      );
    }
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, load);
  return load;
}
