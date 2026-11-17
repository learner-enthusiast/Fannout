import type { MediaSource } from "@repo/providers";
import { downloadObject, getDownloadUrl } from "@repo/s3";
import type { MediaRow } from "../../media/model";
import { PermanentPublishError } from "../errors";

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

/** localhost, *.local, loopback and private ranges: never reachable from Meta's servers. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!ip) return !host.includes(".") && !host.includes(":"); // single-label names (docker service names)
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * Presigned URL for platforms that download media themselves (Instagram, Threads: requiresPublicUrl).
 * A storage URL the internet can't reach fails here, at once, instead of minutes later as an opaque
 * platform error (Instagram 2207076 / 2207052 after processing).
 */
export async function urlSource(row: MediaRow): Promise<MediaSource & { type: "url" }> {
  const url = await getDownloadUrl(row.s3Key, { bucket: row.s3Bucket, expiresIn: 6 * 60 * 60 });
  const { protocol, host, hostname } = new URL(url);
  if (isPrivateHost(hostname)) {
    throw new PermanentPublishError(
      "storage_not_public",
      `This platform downloads the media from your storage, but the storage address (${protocol}//${host}) isn't reachable from the internet. Set S3_PUBLIC_ENDPOINT to a public URL for the bucket (e.g. a tunnel or the real S3/R2 endpoint), then retry.`,
    );
  }
  return { type: "url", url, mimeType: row.mimeType, size: row.sizeBytes ?? undefined };
}
