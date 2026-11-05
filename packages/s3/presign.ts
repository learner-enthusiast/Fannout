import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { defaultBucket, getPublicS3Client } from "./client";
import { assertSafeKey } from "./keys";

const MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // SigV4 limit

function expiry(seconds: number | undefined, fallback: number) {
  const value = seconds ?? fallback;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_EXPIRES_SECONDS) {
    throw new Error("expiresIn must be 1..604800 seconds");
  }
  return value;
}

/**
 * URL the browser can PUT a file to directly. The client must send the same
 * Content-Type header that was signed.
 */
export async function getUploadUrl(
  key: string,
  options: {
    contentType: string;
    bucket?: string;
    expiresIn?: number;
    metadata?: Record<string, string>;
  },
): Promise<{ url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date }> {
  const expiresIn = expiry(options.expiresIn, 15 * 60);
  const url = await getSignedUrl(
    getPublicS3Client(),
    new PutObjectCommand({
      Bucket: options.bucket ?? defaultBucket(),
      Key: assertSafeKey(key),
      ContentType: options.contentType,
      Metadata: options.metadata,
    }),
    { expiresIn },
  );
  return {
    url,
    method: "PUT",
    headers: { "content-type": options.contentType },
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

/** Time-limited download URL. `downloadAs` forces a "Save as" filename. */
export async function getDownloadUrl(
  key: string,
  options: { bucket?: string; expiresIn?: number; downloadAs?: string } = {},
): Promise<string> {
  return getSignedUrl(
    getPublicS3Client(),
    new GetObjectCommand({
      Bucket: options.bucket ?? defaultBucket(),
      Key: assertSafeKey(key),
      ResponseContentDisposition: options.downloadAs
        ? `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadAs)}`
        : undefined,
    }),
    { expiresIn: expiry(options.expiresIn, 60 * 60) },
  );
}
