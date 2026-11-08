import type { z } from "zod";
import { ProviderError, codeFromStatus, isRetryableStatus } from "./provider-error";
import {
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  type ProviderName,
  type RetryOptions,
} from "./provider.types";
import { computeRetryDelayMs, parseRateLimitHeaders, type RateLimitInfo } from "./rate-limit";
import type { TokenManager } from "./token-manager";

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestBody =
  | { kind: "json"; value: unknown }
  | { kind: "form"; value: Record<string, string | number | boolean | undefined> }
  | { kind: "multipart"; value: FormData }
  | { kind: "binary"; value: Uint8Array | Blob; contentType: string };

export interface HttpRequest {
  method: HttpMethod;
  /** Absolute URL, or a path joined to the client's baseUrl. */
  url: string;
  /** Encoded with URLSearchParams; arrays are comma-joined. */
  query?: Record<string, QueryValue>;
  /** Pre-encoded query string appended verbatim (Rest.li List(...) / tuple syntax). */
  rawQuery?: string;
  headers?: Record<string, string>;
  body?: RequestBody;
  /** Attach auth (default true). Pre-signed upload URLs set false. */
  auth?: boolean;
  /** Force retry behaviour; default retries only idempotent methods (and 429 always). */
  retry?: boolean;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  rateLimit: RateLimitInfo;
}

export interface HttpClientOptions {
  provider: ProviderName;
  baseUrl: string;
  tokens: TokenManager;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  sleep?: (ms: number) => Promise<void>;
  defaultHeaders?: Record<string, string>;
  /** How the token is attached: Authorization header (default) or a query param. */
  authorize?: (token: string) => { headers?: Record<string, string>; query?: Record<string, string> };
  /** Extract a readable message / provider error code from an error body. */
  parseError?: (status: number, body: unknown) => { message?: string; providerCode?: string | null };
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(["GET", "PUT", "DELETE"]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function encodeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return params.toString();
}

/**
 * Shared HTTP client for providers without an official SDK (LinkedIn,
 * Threads, Facebook): auth, timeouts, retries with backoff, 401 refresh,
 * rate-limit parsing, error normalisation and Zod response parsing.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly retry: RetryOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.sleep = options.sleep ?? defaultSleep;
  }

  get provider(): ProviderName {
    return this.options.provider;
  }

  private buildUrl(req: HttpRequest, authQuery: Record<string, string> | undefined): string {
    const base = /^https?:\/\//.test(req.url)
      ? req.url
      : `${this.options.baseUrl.replace(/\/$/, "")}/${req.url.replace(/^\//, "")}`;
    const parts = [encodeQuery(req.query), req.rawQuery ?? "", encodeQuery(authQuery)].filter(Boolean);
    if (parts.length === 0) return base;
    return `${base}${base.includes("?") ? "&" : "?"}${parts.join("&")}`;
  }

  private buildInit(req: HttpRequest, authHeaders: Record<string, string> | undefined): RequestInit {
    const headers: Record<string, string> = { ...this.options.defaultHeaders, ...authHeaders, ...req.headers };
    let body: BodyInit | undefined;
    switch (req.body?.kind) {
      case "json":
        headers["content-type"] ??= "application/json";
        body = JSON.stringify(req.body.value);
        break;
      case "form": {
        headers["content-type"] ??= "application/x-www-form-urlencoded";
        body = encodeQuery(req.body.value as Record<string, QueryValue>);
        break;
      }
      case "multipart":
        body = req.body.value;
        break;
      case "binary":
        headers["content-type"] ??= req.body.contentType;
        body = req.body.value as BodyInit;
        break;
    }
    return { method: req.method, headers, body };
  }

  /** Low-level send: returns status, headers and the parsed (JSON or text) body. */
  async send(req: HttpRequest): Promise<HttpResponse<unknown>> {
    const { provider } = this.options;
    const canRetry = req.retry ?? IDEMPOTENT.has(req.method);
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      let authHeaders: Record<string, string> | undefined;
      let authQuery: Record<string, string> | undefined;
      if (req.auth !== false) {
        const token = await this.options.tokens.getAccessToken();
        const auth = this.options.authorize?.(token) ?? { headers: { authorization: `Bearer ${token}` } };
        authHeaders = auth.headers;
        authQuery = auth.query;
      }

      let response: Response;
      try {
        response = await this.fetchImpl(this.buildUrl(req, authQuery), {
          ...this.buildInit(req, authHeaders),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (canRetry && attempt < this.retry.maxRetries) {
          await this.sleep(computeRetryDelayMs(attempt, null, this.retry));
          continue;
        }
        throw new ProviderError({
          provider,
          code: timeout ? "TIMEOUT" : "NETWORK",
          message: timeout ? "Request timed out" : "Network request failed",
          retryable: true,
          cause: error,
        });
      }

      const rateLimit = parseRateLimitHeaders(response.headers);
      const text = await response.text();
      let body: unknown = text;
      if (text && (response.headers.get("content-type") ?? "").includes("json")) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else if (!text) {
        body = null;
      }

      if (response.ok) return { status: response.status, headers: response.headers, data: body, rateLimit };

      if (response.status === 401 && req.auth !== false && !refreshed && this.options.tokens.canRefresh) {
        refreshed = true;
        if (await this.options.tokens.refresh()) {
          attempt -= 1; // a refresh doesn't count as a retry
          continue;
        }
      }

      const retryable = isRetryableStatus(response.status);
      if (retryable && (canRetry || response.status === 429) && attempt < this.retry.maxRetries) {
        await this.sleep(computeRetryDelayMs(attempt, rateLimit, this.retry));
        continue;
      }

      const parsed = this.options.parseError?.(response.status, body) ?? {};
      throw new ProviderError({
        provider,
        code: codeFromStatus(response.status),
        status: response.status,
        message: parsed.message ?? `${provider} request failed with status ${response.status}`,
        providerCode: parsed.providerCode ?? null,
        retryable,
        rateLimit,
        details: body,
      });
    }
  }

  /** Send and validate the JSON body against `schema`. */
  async json<S extends z.ZodType>(req: HttpRequest, schema: S): Promise<HttpResponse<z.output<S>>> {
    const response = await this.send(req);
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderError({
        provider: this.options.provider,
        code: "INVALID_RESPONSE",
        status: response.status,
        // Paths + issue codes only (never values: responses can carry signed URLs).
        message: `Unexpected ${this.options.provider} response (${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`)
          .join("; ")})`,
        details: parsed.error.issues,
      });
    }
    return { ...response, data: parsed.data };
  }
}
