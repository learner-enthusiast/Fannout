import { Readable } from "node:stream";
import { openMediaStream, type MediaSource } from "./media";
import { ProviderError, codeFromStatus, isRetryableStatus } from "./provider-error";
import type { FetchLike, ProviderName } from "./provider.types";
import { parseRateLimitHeaders } from "./rate-limit";

/** Convert a MediaSource into the `{ mimeType, body }` media object googleapis streams. */
export async function toGoogleMedia(source: MediaSource, fetchImpl?: FetchLike) {
  const s = await openMediaStream(source, fetchImpl);
  const body =
    s.type === "buffer"
      ? Readable.from([Buffer.from(s.data)])
      : Symbol.asyncIterator in s.stream
        ? Readable.from(s.stream as AsyncIterable<Uint8Array>)
        : Readable.fromWeb(s.stream as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  return { mimeType: s.mimeType, body };
}

export function googleErrorStatus(error: unknown): number | null {
  const e = error as { status?: unknown; response?: { status?: unknown } };
  const status = e?.response?.status ?? e?.status;
  return typeof status === "number" ? status : null;
}

/** Normalise a gaxios/googleapis error into ProviderError (no tokens or URLs in the message). */
export function normalizeGoogleError(provider: ProviderName, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const status = googleErrorStatus(error);
  const response = (error as { response?: { data?: unknown; headers?: unknown } })?.response;
  const data = response?.data as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | undefined;
  const headers = response?.headers instanceof Headers ? response.headers : new Headers();
  if (status === null) {
    return new ProviderError({ provider, code: "NETWORK", message: "Google API request failed", retryable: true, cause: error });
  }
  return new ProviderError({
    provider,
    code: codeFromStatus(status),
    status,
    message: data?.error?.message ?? `Google API request failed with status ${status}`,
    providerCode: data?.error?.errors?.[0]?.reason ?? null,
    retryable: isRetryableStatus(status),
    rateLimit: parseRateLimitHeaders(headers),
    details: data?.error,
  });
}
