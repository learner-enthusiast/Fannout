import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  NoSuchKey,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { defaultBucket, getS3Client } from "./client";
import { assertSafeKey } from "./keys";

export type ObjectBody = Buffer | Uint8Array | string | Readable;

export type ObjectInfo = {
  bucket: string;
  key: string;
  etag: string | null;
  contentType: string | null;
  contentLength: number | null;
  lastModified: Date | null;
  metadata: Record<string, string>;
};

type BucketOption = { bucket?: string };

export type UploadOptions = BucketOption & {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  /** User metadata (x-amz-meta-*). ASCII values only. */
  metadata?: Record<string, string>;
  /** Only write if the current object's ETag matches (optimistic update). */
  ifMatch?: string;
  /** Pass "*" to only create, never overwrite. */
  ifNoneMatch?: "*";
  /** Multipart part size for large/stream uploads. Default 8 MiB. */
  partSize?: number;
};

const unquote = (etag: string | undefined) => (etag ? etag.replace(/^"|"$/g, "") : null);

function isNotFound(error: unknown) {
  return (
    error instanceof NoSuchKey ||
    error instanceof NotFound ||
    (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
  );
}

/**
 * Upload (create or overwrite) an object. Streams and large buffers are sent
 * as multipart uploads automatically.
 */
export async function uploadObject(
  key: string,
  body: ObjectBody,
  options: UploadOptions = {},
): Promise<{ bucket: string; key: string; etag: string | null }> {
  const bucket = options.bucket ?? defaultBucket();
  const upload = new Upload({
    client: getS3Client(),
    partSize: options.partSize ?? 8 * 1024 * 1024,
    leavePartsOnError: false,
    params: {
      Bucket: bucket,
      Key: assertSafeKey(key),
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
      Metadata: options.metadata,
      IfMatch: options.ifMatch,
      IfNoneMatch: options.ifNoneMatch,
    },
  });
  const result = await upload.done();
  return { bucket, key, etag: unquote(result.ETag) };
}

/**
 * Replace an existing object's content. Throws if it doesn't exist; with
 * `ifMatch`, also fails (412) if someone else changed it first.
 */
export async function updateObject(
  key: string,
  body: ObjectBody,
  options: UploadOptions = {},
): Promise<{ bucket: string; key: string; etag: string | null }> {
  const current = await headObject(key, options);
  if (!current) throw new Error(`Object ${key} does not exist`);
  return uploadObject(key, body, {
    contentType: current.contentType ?? undefined,
    metadata: current.metadata,
    ...options,
  });
}

/** Change content type / metadata / cache headers without re-uploading (server-side copy). */
export async function updateObjectMetadata(
  key: string,
  changes: Pick<UploadOptions, "contentType" | "cacheControl" | "contentDisposition" | "metadata">,
  options: BucketOption = {},
): Promise<ObjectInfo> {
  const bucket = options.bucket ?? defaultBucket();
  const current = await headObject(key, { bucket });
  if (!current) throw new Error(`Object ${key} does not exist`);
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: assertSafeKey(key),
      CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
      MetadataDirective: "REPLACE",
      ContentType: changes.contentType ?? current.contentType ?? undefined,
      CacheControl: changes.cacheControl,
      ContentDisposition: changes.contentDisposition,
      Metadata: changes.metadata ?? current.metadata,
    }),
  );
  return (await headObject(key, { bucket }))!;
}

/** Object metadata, or null if it doesn't exist. */
export async function headObject(
  key: string,
  options: BucketOption = {},
): Promise<ObjectInfo | null> {
  const bucket = options.bucket ?? defaultBucket();
  try {
    const head = await getS3Client().send(
      new HeadObjectCommand({ Bucket: bucket, Key: assertSafeKey(key) }),
    );
    return {
      bucket,
      key,
      etag: unquote(head.ETag),
      contentType: head.ContentType ?? null,
      contentLength: head.ContentLength ?? null,
      lastModified: head.LastModified ?? null,
      metadata: head.Metadata ?? {},
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function objectExists(key: string, options: BucketOption = {}): Promise<boolean> {
  return (await headObject(key, options)) !== null;
}

/** Download as a stream (for piping to a response or file). Null if missing. */
export async function downloadObject(
  key: string,
  options: BucketOption & { range?: string } = {},
): Promise<(ObjectInfo & { body: Readable }) | null> {
  const bucket = options.bucket ?? defaultBucket();
  try {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(key), Range: options.range }),
    );
    if (!(result.Body instanceof Readable)) throw new Error("Expected a Node.js stream body");
    return {
      bucket,
      key,
      body: result.Body,
      etag: unquote(result.ETag),
      contentType: result.ContentType ?? null,
      contentLength: result.ContentLength ?? null,
      lastModified: result.LastModified ?? null,
      metadata: result.Metadata ?? {},
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Download fully into memory. Use for small objects only. Null if missing. */
export async function downloadObjectAsBuffer(
  key: string,
  options: BucketOption = {},
): Promise<Buffer | null> {
  const object = await downloadObject(key, options);
  if (!object) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** Delete one object. Succeeds even if it didn't exist (S3 semantics). */
export async function deleteObject(key: string, options: BucketOption = {}): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: options.bucket ?? defaultBucket(), Key: assertSafeKey(key) }),
  );
}

/** Delete many objects (batched by 1000). Returns keys that failed. */
export async function deleteObjects(keys: string[], options: BucketOption = {}): Promise<string[]> {
  const bucket = options.bucket ?? defaultBucket();
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map(assertSafeKey);
    const result = await getS3Client().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    for (const error of result.Errors ?? []) if (error.Key) failed.push(error.Key);
  }
  return failed;
}

/** Delete everything under a prefix. Returns how many objects were deleted. */
export async function deletePrefix(prefix: string, options: BucketOption = {}): Promise<number> {
  if (!prefix || prefix === "/") throw new Error("Refusing to delete the whole bucket");
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await listObjects({ ...options, prefix, cursor, limit: 1000 });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) {
      const failed = await deleteObjects(keys, options);
      deleted += keys.length - failed.length;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return deleted;
}

/** Server-side copy within (or across) buckets. */
export async function copyObject(
  sourceKey: string,
  destinationKey: string,
  options: BucketOption & { sourceBucket?: string } = {},
): Promise<void> {
  const bucket = options.bucket ?? defaultBucket();
  const sourceBucket = options.sourceBucket ?? bucket;
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: assertSafeKey(destinationKey),
      CopySource: `${sourceBucket}/${encodeURIComponent(assertSafeKey(sourceKey)).replace(/%2F/g, "/")}`,
    }),
  );
}

/** Copy then delete the source. */
export async function moveObject(
  sourceKey: string,
  destinationKey: string,
  options: BucketOption = {},
): Promise<void> {
  await copyObject(sourceKey, destinationKey, options);
  await deleteObject(sourceKey, options);
}

export async function listObjects(
  options: BucketOption & { prefix?: string; cursor?: string; limit?: number } = {},
): Promise<{
  objects: Array<{ key: string; size: number; etag: string | null; lastModified: Date | null }>;
  nextCursor: string | null;
}> {
  const result = await getS3Client().send(
    new ListObjectsV2Command({
      Bucket: options.bucket ?? defaultBucket(),
      Prefix: options.prefix,
      ContinuationToken: options.cursor,
      MaxKeys: options.limit ?? 1000,
    }),
  );
  return {
    objects: (result.Contents ?? []).flatMap((object) =>
      object.Key
        ? [
            {
              key: object.Key,
              size: object.Size ?? 0,
              etag: unquote(object.ETag),
              lastModified: object.LastModified ?? null,
            },
          ]
        : [],
    ),
    nextCursor: result.NextContinuationToken ?? null,
  };
}
