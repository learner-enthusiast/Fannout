import type { ProviderName } from "./provider.types";
import type { RateLimitInfo } from "./rate-limit";

export type ProviderErrorCode =
  | "VALIDATION"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED";

/**
 * Normalised error for every provider call. Messages never contain tokens,
 * request bodies or URLs with query strings.
 */
export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  /** Provider's own error code/subcode, if any (e.g. Graph `code`, LinkedIn `serviceErrorCode`). */
  readonly providerCode: string | null;
  readonly retryable: boolean;
  readonly rateLimit: RateLimitInfo | null;
  readonly details: unknown;

  constructor(opts: {
    provider: ProviderName;
    code: ProviderErrorCode;
    message: string;
    status?: number | null;
    providerCode?: string | null;
    retryable?: boolean;
    rateLimit?: RateLimitInfo | null;
    details?: unknown;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = opts.provider;
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.providerCode = opts.providerCode ?? null;
    this.retryable = opts.retryable ?? false;
    this.rateLimit = opts.rateLimit ?? null;
    this.details = opts.details;
  }
}

export function codeFromStatus(status: number): ProviderErrorCode {
  if (status === 400 || status === 422) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409 || status === 412) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_ERROR";
}

export const isRetryableStatus = (status: number) => status === 429 || status >= 500;
