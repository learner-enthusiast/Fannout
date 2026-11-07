export type AiErrorKind = "auth" | "rate_limit" | "invalid_request" | "unavailable" | "timeout" | "schema_mismatch";

/** Normalised AI failure. Messages never include prompts, outputs or the key. */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  /** Worth retrying later (rate limit, outage, timeout). */
  readonly retryable: boolean;

  constructor(kind: AiErrorKind, message: string, options: { status?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "AiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = kind === "rate_limit" || kind === "unavailable" || kind === "timeout";
  }
}
