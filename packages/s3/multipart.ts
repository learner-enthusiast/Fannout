import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { defaultBucket, getPublicS3Client, getS3Client } from "./client";
import { assertSafeKey } from "./keys";

/** S3 limits: parts 5 MiB..5 GiB (last part may be smaller), at most 10,000 parts. */
export const MAX_MULTIPART_PARTS = 10_000;
const MIN_PART_SIZE = 5 * 1024 * 1024;

type BucketOption = { bucket?: string };

export function partCount(sizeBytes: number, partSize: number): number {
  if (partSize < MIN_PART_SIZE) throw new Error("partSize must be at least 5 MiB");
  const count = Math.max(1, Math.ceil(sizeBytes / partSize));
  if (count > MAX_MULTIPART_PARTS) throw new Error("File needs more than 10,000 parts");
  return count;
}

export async function createMultipartUpload(
  key: string,
  options: BucketOption & { contentType: string },
): Promise<{ uploadId: string }> {
  const result = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: options.bucket ?? defaultBucket(),
      Key: assertSafeKey(key),
      ContentType: options.contentType,
    }),
  );
  if (!result.UploadId) throw new Error("S3 did not return an UploadId");
  return { uploadId: result.UploadId };
}

/** Presigned PUT URLs (browser) for parts 1..count. The browser must read each part's ETag. */
export async function getUploadPartUrls(
  key: string,
  uploadId: string,
  count: number,
  options: BucketOption & { expiresIn?: number } = {},
): Promise<{ partNumber: number; url: string }[]> {
  const bucket = options.bucket ?? defaultBucket();
  const safeKey = assertSafeKey(key);
  const client = getPublicS3Client();
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const partNumber = index + 1;
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: safeKey,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: options.expiresIn ?? 12 * 60 * 60 },
      );
      return { partNumber, url };
    }),
  );
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
  options: BucketOption = {},
): Promise<void> {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: options.bucket ?? defaultBucket(),
      Key: assertSafeKey(key),
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sorted.map((part) => ({
          PartNumber: part.partNumber,
          // S3 expects the quoted ETag exactly as returned by UploadPart.
          ETag: part.etag.startsWith('"') ? part.etag : `"${part.etag}"`,
        })),
      },
    }),
  );
}

/** Aborts an in-progress upload. An upload that is already gone counts as aborted. */
export async function abortMultipartUpload(
  key: string,
  uploadId: string,
  options: BucketOption = {},
): Promise<void> {
  try {
    await getS3Client().send(
      new AbortMultipartUploadCommand({
        Bucket: options.bucket ?? defaultBucket(),
        Key: assertSafeKey(key),
        UploadId: uploadId,
      }),
    );
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NoSuchUpload" || name === "NotFound") return;
    throw error;
  }
}
