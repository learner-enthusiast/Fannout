import { downloadObject, headObject } from "@repo/s3";
import type { MediaRow } from "../../media/model";

export type StoredObject = Pick<MediaRow, "s3Bucket" | "s3Key" | "name">;

/** Thrown for a short/odd S3 read; a plain Error so classifyPublishError treats it as transient (retry the chunk). */
export class ChunkReadError extends Error {}

/**
 * Bytes [start, endInclusive] of the stored file via S3 GetObject Range.
 * Each call opens and fully drains its own request — no stream outlives the
 * step — and the length is verified before anything is uploaded.
 */
export async function readRange(object: StoredObject, start: number, endInclusive: number): Promise<Buffer> {
  const expected = endInclusive - start + 1;
  if (start < 0 || expected <= 0) throw new RangeError(`Invalid byte range ${start}-${endInclusive}`);
  const result = await downloadObject(object.s3Key, { bucket: object.s3Bucket, range: `bytes=${start}-${endInclusive}` });
  if (!result) throw new Error(`${object.name} is missing from storage`);
  const parts: Buffer[] = [];
  for await (const part of result.body) parts.push(Buffer.from(part as Uint8Array));
  const data = Buffer.concat(parts);
  if (data.byteLength !== expected) {
    throw new ChunkReadError(`Storage returned ${data.byteLength} bytes for a ${expected}-byte range`);
  }
  return data;
}

/** Authoritative object size (the media row's size can be missing). */
export async function storedSize(row: MediaRow): Promise<number> {
  if (row.sizeBytes && row.sizeBytes > 0) return row.sizeBytes;
  const head = await headObject(row.s3Key, { bucket: row.s3Bucket });
  if (!head?.contentLength) throw new Error(`${row.name} is missing from storage`);
  return head.contentLength;
}
