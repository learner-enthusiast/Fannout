import type { RetryOptions } from "./provider.types";

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
  /** From Retry-After, when present. */
  retryAfterMs: number | null;
  /** Meta usage headers (x-app-usage, x-business-use-case-usage), parsed JSON. */
  usage: Record<string, unknown> | null;
}

const num = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function parseJsonHeader(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reads the rate-limit headers the five providers use:
 * - X: x-rate-limit-limit / -remaining / -reset (epoch seconds)
 * - Google/LinkedIn: Retry-After on 429 (seconds or HTTP date)
 * - Meta (Facebook, Threads): x-app-usage, x-business-use-case-usage, x-ad-account-usage (JSON)
 */
export function parseRateLimitHeaders(headers: Headers, now = Date.now()): RateLimitInfo {
  const reset = num(headers.get("x-rate-limit-reset"));
  const retryAfterRaw = headers.get("retry-after");
  let retryAfterMs: number | null = null;
  if (retryAfterRaw) {
    const seconds = num(retryAfterRaw);
    if (seconds !== null) retryAfterMs = seconds * 1000;
    else {
      const date = Date.parse(retryAfterRaw);
      if (!Number.isNaN(date)) retryAfterMs = Math.max(0, date - now);
    }
  }
  const usage = {
    ...(parseJsonHeader(headers.get("x-app-usage")) ? { app: parseJsonHeader(headers.get("x-app-usage")) } : {}),
    ...(parseJsonHeader(headers.get("x-business-use-case-usage"))
      ? { businessUseCase: parseJsonHeader(headers.get("x-business-use-case-usage")) }
      : {}),
    ...(parseJsonHeader(headers.get("x-ad-account-usage"))
      ? { adAccount: parseJsonHeader(headers.get("x-ad-account-usage")) }
      : {}),
  };
  return {
    limit: num(headers.get("x-rate-limit-limit")),
    remaining: num(headers.get("x-rate-limit-remaining")),
    resetAt: reset !== null ? new Date(reset * 1000) : null,
    retryAfterMs,
    usage: Object.keys(usage).length > 0 ? usage : null,
  };
}

/** Exponential backoff with jitter, honouring Retry-After / reset time when given. */
export function computeRetryDelayMs(
  attempt: number,
  info: RateLimitInfo | null,
  options: RetryOptions,
  now = Date.now(),
  random: () => number = Math.random,
): number {
  if (info?.retryAfterMs != null) return Math.min(info.retryAfterMs, options.maxDelayMs);
  if (info?.resetAt) {
    const wait = info.resetAt.getTime() - now;
    if (wait > 0) return Math.min(wait, options.maxDelayMs);
  }
  const exp = options.baseDelayMs * 2 ** attempt;
  return Math.min(exp / 2 + random() * (exp / 2), options.maxDelayMs);
}
