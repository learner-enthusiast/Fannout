import { logger } from "@repo/logger";
import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env";

/**
 * New ioredis client for REDIS_URL. Connection errors are logged without the
 * URL (it may contain a password). Callers own the client and must close it.
 */
export function createRedisConnection(name: string, options: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `fannout:${name}`,
    maxRetriesPerRequest: 3,
    ...options,
  });
  client.on("error", (error: Error) => {
    logger.error("Redis connection error", { connection: name, message: error.message });
  });
  return client;
}

/**
 * Connection for BullMQ. BullMQ requires `maxRetriesPerRequest: null` so
 * blocking commands (used by workers) are never aborted by ioredis retries.
 */
export function createBullMQConnection(name: string, options: RedisOptions = {}): Redis {
  return createRedisConnection(name, { ...options, maxRetriesPerRequest: null });
}

let shared: Redis | undefined;

/** Process-wide client for caching and other short commands. */
export function getRedis(): Redis {
  shared ??= createRedisConnection("shared");
  return shared;
}

/** Close the shared client (graceful shutdown, tests). */
export async function closeRedis(): Promise<void> {
  if (!shared) return;
  const client = shared;
  shared = undefined;
  await client.quit();
}

/** PING the shared client. Throws if Redis is unreachable. */
export async function checkRedisConnection(): Promise<void> {
  const reply = await getRedis().ping();
  if (reply !== "PONG") throw new Error(`Unexpected Redis PING reply: ${reply}`);
}
