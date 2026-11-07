import { z } from "zod";
import type { FetchLike } from "./provider.types";

/**
 * Where media bytes come from. Deliberately storage-agnostic: a future
 * object-storage layer only needs to produce one of these.
 */
export type MediaSource =
  | { type: "buffer"; data: Uint8Array; mimeType: string; filename?: string }
  | {
      type: "stream";
      stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
      /** Total size in bytes — required by every chunked upload protocol. */
      size: number;
      mimeType: string;
      filename?: string;
    }
  | { type: "url"; url: string; mimeType?: string; size?: number; filename?: string };

export const MediaSourceSchema = z.custom<MediaSource>(
  (value) => {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (v.type === "buffer") return v.data instanceof Uint8Array && typeof v.mimeType === "string";
    if (v.type === "stream")
      return (
        typeof v.stream === "object" &&
        v.stream !== null &&
        typeof v.size === "number" &&
        Number.isInteger(v.size) &&
        v.size > 0 &&
        typeof v.mimeType === "string"
      );
    if (v.type === "url") return typeof v.url === "string" && /^https?:\/\//.test(v.url);
    return false;
  },
  { message: "Invalid media source" },
);

export function mediaSize(source: MediaSource): number | null {
  if (source.type === "buffer") return source.data.byteLength;
  return source.size ?? null;
}

async function* iterateStream(
  stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) yield chunk;
    return;
  }
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Resolve a URL source to a stream by downloading it (for providers that need bytes). */
export async function openMediaStream(
  source: MediaSource,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<Exclude<MediaSource, { type: "url" }>> {
  if (source.type !== "url") return source;
  const response = await fetchImpl(source.url, { method: "GET" });
  if (!response.ok || !response.body) throw new Error(`Could not download media (${response.status})`);
  const size = source.size ?? Number(response.headers.get("content-length"));
  if (!Number.isInteger(size) || size <= 0) throw new Error("Media URL did not report a size; pass `size`");
  return {
    type: "stream",
    stream: response.body as ReadableStream<Uint8Array>,
    size,
    mimeType: source.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream",
    filename: source.filename,
  };
}

/**
 * Yields fixed-size chunks (the last may be shorter) from any source,
 * buffering at most one chunk in memory.
 */
export async function* readChunks(
  source: Exclude<MediaSource, { type: "url" }>,
  chunkSize: number,
): AsyncGenerator<{ index: number; offset: number; data: Uint8Array }> {
  if (source.type === "buffer") {
    for (let offset = 0, index = 0; offset < source.data.byteLength; offset += chunkSize, index++) {
      yield { index, offset, data: source.data.subarray(offset, offset + chunkSize) };
    }
    return;
  }
  let buffer = new Uint8Array(0);
  let offset = 0;
  let index = 0;
  for await (const piece of iterateStream(source.stream)) {
    const merged = new Uint8Array(buffer.byteLength + piece.byteLength);
    merged.set(buffer);
    merged.set(piece, buffer.byteLength);
    buffer = merged;
    while (buffer.byteLength >= chunkSize) {
      yield { index: index++, offset, data: buffer.slice(0, chunkSize) };
      offset += chunkSize;
      buffer = buffer.slice(chunkSize);
    }
  }
  if (buffer.byteLength > 0) yield { index, offset, data: buffer };
}

/** Read a whole (small) source into memory. */
export async function readAll(source: Exclude<MediaSource, { type: "url" }>): Promise<Uint8Array> {
  if (source.type === "buffer") return source.data;
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of iterateStream(source.stream)) {
    parts.push(part);
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export function toBlob(data: Uint8Array, mimeType: string): Blob {
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType });
}

/**
 * Reads arbitrary, strictly sequential byte ranges from a source, for upload
 * protocols where the server dictates each chunk's offsets (Facebook
 * upload_phase=transfer). Buffers at most one range in memory.
 */
export function createRangeReader(source: Exclude<MediaSource, { type: "url" }>) {
  if (source.type === "buffer") {
    return { read: async (start: number, end: number) => source.data.subarray(start, end) };
  }
  const iterator = iterateStream(source.stream)[Symbol.asyncIterator]();
  let buffer = new Uint8Array(0);
  let bufferStart = 0;
  return {
    async read(start: number, end: number): Promise<Uint8Array> {
      if (start < bufferStart) throw new Error("Range reader only supports forward reads");
      while (bufferStart + buffer.byteLength < end) {
        const { done, value } = await iterator.next();
        if (done) break;
        const merged = new Uint8Array(buffer.byteLength + value.byteLength);
        merged.set(buffer);
        merged.set(value, buffer.byteLength);
        buffer = merged;
      }
      const out = buffer.slice(start - bufferStart, end - bufferStart);
      buffer = buffer.slice(end - bufferStart);
      bufferStart = end;
      return out;
    },
  };
}
