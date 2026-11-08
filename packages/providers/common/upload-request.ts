import { ProviderError, codeFromStatus, isRetryableStatus } from "./provider-error";
import type { FetchLike, ProviderName } from "./provider.types";
import { parseRateLimitHeaders } from "./rate-limit";
import type { TokenManager } from "./token-manager";

/** Per-request ceiling for one chunk/part of a large upload. */
export const UPLOAD_CHUNK_TIMEOUT_MS = 120_000;

export type UploadRequest = {
  provider: ProviderName;
  method: "PUT" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
  /** Attach a bearer token (refreshing once on 401). Omit for pre-signed URLs. */
  tokens?: TokenManager;
  fetch?: FetchLike;
};

/**
 * One upload HTTP request with an explicit timeout and NO automatic retry:
 * the caller (a resumable Inngest step) decides how to resume. Timeouts and
 * network failures become retryable ProviderErrors. The response is returned
 * for every status so protocol codes (e.g. YouTube 308) can be handled; the
 * URL never appears in error messages (upload URLs carry signatures).
 */
export async function sendUploadRequest(req: UploadRequest): Promise<Response> {
  const fetchImpl: FetchLike = req.fetch ?? ((input, init) => fetch(input, init));
  let refreshed = false;
  for (;;) {
    const headers: Record<string, string> = { ...req.headers };
    if (req.tokens) headers.authorization = `Bearer ${await req.tokens.getAccessToken()}`;
    let response: Response;
    try {
      response = await fetchImpl(req.url, {
        method: req.method,
        headers,
        body: req.body,
        signal: AbortSignal.timeout(req.timeoutMs ?? UPLOAD_CHUNK_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new ProviderError({
        provider: req.provider,
        code: timeout ? "TIMEOUT" : "NETWORK",
        message: timeout ? "Upload request timed out" : "Upload request failed",
        retryable: true,
        cause: error,
      });
    }
    if (response.status === 401 && req.tokens?.canRefresh && !refreshed) {
      refreshed = true;
      await response.body?.cancel();
      if (await req.tokens.refresh()) continue;
    }
    return response;
  }
}

/** ProviderError for a non-success upload response (body text truncated, never the URL). */
export async function uploadResponseError(provider: ProviderName, response: Response, what: string): Promise<ProviderError> {
  const text = await response.text().catch(() => "");
  let message = `${what} failed with status ${response.status}`;
  try {
    const body = JSON.parse(text) as { error?: { message?: string }; message?: string; detail?: string };
    message = body.error?.message ?? body.message ?? body.detail ?? message;
  } catch {
    /* not JSON */
  }
  return new ProviderError({
    provider,
    code: codeFromStatus(response.status),
    status: response.status,
    message: message.slice(0, 300),
    retryable: isRetryableStatus(response.status),
    rateLimit: parseRateLimitHeaders(response.headers),
  });
}
