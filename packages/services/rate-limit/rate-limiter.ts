/**
 * Rate limiting — the only place it lives.
 *
 * rate-limiter-flexible RateLimiterRedis (own ioredis connection with the
 * offline queue OFF, so a Redis outage fails fast) with a RateLimiterMemory
 * insuranceLimiter per limiter, so limits still apply while Redis is down.
 * https://github.com/animir/node-rate-limiter-flexible/wiki/Redis
 */
import { logger } from "@repo/logger";
import { createRedisConnection, type Redis } from "@repo/redis";
import type { NextFunction, Request, Response } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes, type RateLimiterAbstract } from "rate-limiter-flexible";
import { z } from "zod";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Config (per tier). "pro" is a placeholder until paid plans exist.
// ---------------------------------------------------------------------------

const WindowSchema = z.object({
  points: z.number().int().positive(),
  /** seconds */
  duration: z.number().int().positive(),
  /** seconds; 0 = just reject */
  blockDuration: z.number().int().nonnegative().default(0),
});

export const BucketSchema = z.enum(["api", "publish", "delete", "edit", "ai", "authFail"]);
export type Bucket = z.infer<typeof BucketSchema>;

const TierSchema = z.record(BucketSchema, z.array(WindowSchema).min(1));

export const RateLimitConfigSchema = z.object({
  tiers: z.object({ free: TierSchema, pro: TierSchema }),
  /** Browser (session) users get the same buckets keyed by user id with N× points. */
  sessionMultiplier: z.number().positive(),
});

const FREE = {
  api: [{ points: 60, duration: 60 }],
  publish: [
    { points: 10, duration: 60 },
    { points: 100, duration: 24 * 60 * 60 },
  ],
  delete: [{ points: 30, duration: 60 * 60 }],
  edit: [{ points: 30, duration: 60 * 60 }],
  ai: [{ points: 20, duration: 60 * 60 }],
  authFail: [{ points: 10, duration: 60, blockDuration: 15 * 60 }],
};

export const RATE_LIMITS = RateLimitConfigSchema.parse({
  tiers: { free: FREE, pro: FREE },
  sessionMultiplier: 3,
});

export type Tier = keyof typeof RATE_LIMITS.tiers;

// ---------------------------------------------------------------------------
// Limiters
// ---------------------------------------------------------------------------

let redis: Redis | null | undefined;
function redisClient(): Redis | null {
  if (redis !== undefined) return redis;
  try {
    redis = createRedisConnection("rate-limit", { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  } catch (error) {
    logger.warn("Rate limiter: Redis unavailable, using memory only", { error: (error as Error).message });
    redis = null;
  }
  return redis;
}

/** Test hook: use a specific (or no) Redis client. */
export function setRateLimitRedisForTests(client: Redis | null) {
  redis = client;
  limiters.clear();
}

const limiters = new Map<string, RateLimiterAbstract>();

function limiterFor(bucket: Bucket, tier: Tier, session: boolean, index: number): RateLimiterAbstract {
  const window = RATE_LIMITS.tiers[tier][bucket][index]!;
  const points = session && bucket !== "authFail" ? Math.round(window.points * RATE_LIMITS.sessionMultiplier) : window.points;
  const keyPrefix = `fannout:rl:${tier}:${bucket}:${window.duration}:${session ? "s" : "k"}`;
  const cached = limiters.get(keyPrefix);
  if (cached) return cached;
  const options = { keyPrefix, points, duration: window.duration, blockDuration: window.blockDuration };
  const insuranceLimiter = new RateLimiterMemory(options);
  const client = redisClient();
  const limiter = client ? new RateLimiterRedis({ ...options, storeClient: client, insuranceLimiter }) : insuranceLimiter;
  limiters.set(keyPrefix, limiter);
  return limiter;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** ms until the most restrictive window resets */
  resetMs: number;
  limit: number;
  bucket: Bucket;
};

export type ConsumeOptions = { points?: number; tier?: Tier; session?: boolean };

/**
 * Consume `points` from every window of the bucket; the most restrictive
 * window decides. Never throws (store errors fall back to the insurance limiter).
 */
export async function consume(bucket: Bucket, key: string, options: ConsumeOptions = {}): Promise<RateLimitResult> {
  const tier = options.tier ?? "free";
  const points = options.points ?? 1;
  const windows = RATE_LIMITS.tiers[tier][bucket];
  if (!env.RATE_LIMIT_ENABLED) {
    const w = windows[0]!;
    return { allowed: true, remaining: w.points, resetMs: w.duration * 1000, limit: w.points, bucket };
  }

  let worst: RateLimitResult | null = null;
  for (let index = 0; index < windows.length; index++) {
    const limiter = limiterFor(bucket, tier, Boolean(options.session), index);
    let result: RateLimitResult;
    try {
      const res = await limiter.consume(key, points);
      result = { allowed: true, remaining: res.remainingPoints, resetMs: res.msBeforeNext, limit: limiter.points, bucket };
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        result = { allowed: false, remaining: 0, resetMs: rejection.msBeforeNext, limit: limiter.points, bucket };
      } else {
        // Store error with no insurance: fail open but log.
        logger.warn("Rate limiter store error", { bucket, error: (rejection as Error)?.message });
        result = { allowed: true, remaining: limiter.points, resetMs: 0, limit: limiter.points, bucket };
      }
    }
    // A rejecting window decides; otherwise report the window with the fewest points left.
    if (!result.allowed) return result;
    if (!worst || result.remaining < worst.remaining) worst = result;
  }
  return worst!;
}

/** Is this IP currently blocked for bad API keys (without consuming)? */
export async function isAuthBlocked(ip: string): Promise<boolean> {
  if (!env.RATE_LIMIT_ENABLED) return false;
  const limiter = limiterFor("authFail", "free", false, 0);
  try {
    const res = await limiter.get(ip);
    return Boolean(res && res.consumedPoints >= limiter.points);
  } catch {
    return false;
  }
}

/** Count an invalid/revoked/expired key from this IP (10/min → blocked 15 min). */
export function penalizeAuthFail(ip: string) {
  return consume("authFail", ip);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil((Date.now() + result.resetMs) / 1000)),
    ...(result.allowed ? {} : { "Retry-After": String(Math.max(1, Math.ceil(result.resetMs / 1000))) }),
  };
}

/** Thrown when a limit is hit; tRPC maps it to TOO_MANY_REQUESTS with {bucket, retryAfterSeconds}. */
export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;
  constructor(readonly result: RateLimitResult) {
    super(`Rate limit exceeded for ${result.bucket}. Try again in ${Math.max(1, Math.ceil(result.resetMs / 1000))} s.`);
    this.retryAfterSeconds = Math.max(1, Math.ceil(result.resetMs / 1000));
  }
}

/**
 * Express middleware for non-tRPC routes. `keyOf` picks the identity
 * (api key id, user id or IP); return null to skip.
 */
export function expressRateLimit(bucket: Bucket, keyOf: (req: Request) => string | null, options: ConsumeOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (!key) return next();
    const result = await consume(bucket, key, options);
    res.set(rateLimitHeaders(result));
    if (result.allowed) return next();
    return res.status(429).json({
      error: { code: "TOO_MANY_REQUESTS", message: new RateLimitExceededError(result).message, bucket, retryAfterSeconds: Math.max(1, Math.ceil(result.resetMs / 1000)) },
    });
  };
}
