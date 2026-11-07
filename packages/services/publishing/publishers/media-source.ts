import type { MediaSource } from "@repo/providers";
import { downloadObject, getDownloadUrl } from "@repo/s3";
import type { MediaRow } from "../../media/model";

/** Streams the object from S3 (fresh stream per call, so retries can re-read). */
export async function streamSource(row: MediaRow): Promise<MediaSource> {
  const object = await downloadObject(row.s3Key, { bucket: row.s3Bucket });
  if (!object) throw new Error(`${row.name} is missing from storage`);
  return {
    type: "stream",
    stream: object.body,
    size: object.contentLength ?? row.sizeBytes ?? 0,
    mimeType: row.mimeType,
    filename: row.originalFilename ?? undefined,
  };
}

/** Presigned URL for platforms that download media themselves (Threads). */
export async function urlSource(row: MediaRow): Promise<MediaSource & { type: "url" }> {
  const url = await getDownloadUrl(row.s3Key, { bucket: row.s3Bucket, expiresIn: 6 * 60 * 60 });
  return { type: "url", url, mimeType: row.mimeType, size: row.sizeBytes ?? undefined };
}
