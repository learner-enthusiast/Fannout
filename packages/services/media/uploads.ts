import { and, db, eq, inArray, lt, media } from "@repo/database";
import { errors } from "@repo/errors";
import {
  abortMultipartUpload,
  buildObjectKey,
  completeMultipartUpload,
  createMultipartUpload,
  defaultBucket,
  defaultRegion,
  getUploadPartUrls,
  partCount,
} from "@repo/s3";
import { z } from "zod";
import { invalidate } from "../cache";
import { createMedia, getMediaById } from "./index";
import {
  CompleteUploadInputSchema,
  CreateUploadInputSchema,
  FailUploadInputSchema,
  MEDIA_PART_SIZE,
  MediaRowSchema,
  maxBytesFor,
  mediaTypeFromFile,
  nameFromFilename,
  type CompleteUploadInput,
  type CreateUploadInput,
  type CreateUploadResult,
  type FailUploadInput,
  type MediaMetadata,
  type MediaRow,
} from "./model";

const UuidSchema = z.uuid();

function withoutKeys(metadata: MediaMetadata | null, ...keys: (keyof MediaMetadata)[]): MediaMetadata {
  const copy: MediaMetadata = { ...metadata };
  for (const key of keys) delete copy[key];
  return copy;
}

const withoutMultipart = (metadata: MediaMetadata | null) => withoutKeys(metadata, "multipart");

/** Starts an S3 multipart upload and returns presigned part URLs (10 MiB parts). */
export async function createMediaUpload(
  userId: string,
  input: CreateUploadInput,
): Promise<CreateUploadResult> {
  const data = CreateUploadInputSchema.parse(input);
  const detected = mediaTypeFromFile(data.mimeType, data.filename);
  if (!detected) {
    return errors.badRequest("Upload videos, images, SRT/VTT subtitles or JSON files");
  }
  const { type, contentType } = detected;
  if (data.sizeBytes > maxBytesFor(type)) {
    return errors.badRequest("Subtitle and JSON files must be 1 MB or smaller");
  }

  const bucket = defaultBucket();
  const key = buildObjectKey(`users/${userId}/media`, data.filename);
  const count = partCount(data.sizeBytes, MEDIA_PART_SIZE);
  const { uploadId } = await createMultipartUpload(key, { bucket, contentType });

  let row: MediaRow;
  try {
    row = await createMedia({
      userId,
      name: data.name ?? nameFromFilename(data.filename),
      type,
      status: "uploading",
      originalFilename: data.filename,
      mimeType: contentType,
      sizeBytes: data.sizeBytes,
      s3Bucket: bucket,
      s3Key: key,
      s3Region: defaultRegion(),
      metadata: { multipart: { uploadId, partSize: MEDIA_PART_SIZE } },
    });
  } catch (error) {
    await abortMultipartUpload(key, uploadId, { bucket }).catch(() => undefined);
    throw error;
  }

  const parts = await getUploadPartUrls(key, uploadId, count, { bucket });
  return { mediaId: row.id, partSize: MEDIA_PART_SIZE, parts };
}

/** Completes the multipart upload; status → uploaded. Processing happens in Inngest. */
export async function completeMediaUpload(
  userId: string,
  input: CompleteUploadInput,
): Promise<MediaRow> {
  const { mediaId, parts } = CompleteUploadInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return errors.notFound("Media");
  const multipart = row.metadata?.multipart;
  if (row.status !== "uploading" || !multipart) {
    return errors.conflict("This upload is not in progress");
  }

  const expected = partCount(row.sizeBytes ?? 0, multipart.partSize);
  const numbers = new Set(parts.map((part) => part.partNumber));
  if (numbers.size !== expected || parts.some((part) => part.partNumber > expected)) {
    return errors.badRequest(`Expected ${expected} uploaded parts`);
  }

  await completeMultipartUpload(row.s3Key, multipart.uploadId, parts, { bucket: row.s3Bucket });

  const [updated] = await db
    .update(media)
    .set({ status: "uploaded", metadata: withoutMultipart(row.metadata), updatedAt: new Date() })
    .where(and(eq(media.id, row.id), eq(media.status, "uploading")))
    .returning();
  if (!updated) return errors.conflict("This upload is not in progress");
  await invalidate(updated.userId, "media");
  return MediaRowSchema.parse(updated);
}

/**
 * Marks an upload failed (cancel / fatal client error) and aborts the S3
 * multipart upload. `changed` is false when the media had already finished
 * or failed, so callers don't notify twice.
 */
export async function failMediaUpload(
  userId: string,
  input: FailUploadInput,
): Promise<{ row: MediaRow; changed: boolean }> {
  const { mediaId, error } = FailUploadInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return errors.notFound("Media");
  return failUpload(row, error);
}

async function failUpload(row: MediaRow, error: string): Promise<{ row: MediaRow; changed: boolean }> {
  if (row.status !== "uploading" && row.status !== "uploaded") return { row, changed: false };
  const multipart = row.metadata?.multipart;
  if (multipart) await abortMultipartUpload(row.s3Key, multipart.uploadId, { bucket: row.s3Bucket });

  const [updated] = await db
    .update(media)
    .set({
      status: "failed",
      metadata: { ...withoutMultipart(row.metadata), error },
      updatedAt: new Date(),
    })
    .where(and(eq(media.id, row.id), inArray(media.status, ["uploading", "uploaded"])))
    .returning();
  if (updated) await invalidate(updated.userId, "media");
  return updated
    ? { row: MediaRowSchema.parse(updated), changed: true }
    : { row, changed: false };
}

// ---------------------------------------------------------------------------
// Background processing (Inngest). Not user-scoped: ids come from our events.
// ---------------------------------------------------------------------------

export async function getMediaForProcessing(id: string): Promise<MediaRow | null> {
  const [row] = await db.select().from(media).where(eq(media.id, UuidSchema.parse(id))).limit(1);
  return row ? MediaRowSchema.parse(row) : null;
}

export async function markMediaProcessing(id: string): Promise<MediaRow | null> {
  const [row] = await db
    .update(media)
    .set({ status: "processing", updatedAt: new Date() })
    .where(and(eq(media.id, UuidSchema.parse(id)), inArray(media.status, ["uploaded", "processing"])))
    .returning();
  if (row) await invalidate(row.userId, "media");
  return row ? MediaRowSchema.parse(row) : null;
}

export type ProbeResult = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  codec?: { video?: string; audio?: string };
  fps?: number;
};

/** What processing learned about a file; metadata keys are merged in. */
export type ReadyUpdate = {
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  metadata?: MediaMetadata;
};

export async function markMediaReady(id: string, update: ReadyUpdate): Promise<MediaRow> {
  const current = await getMediaForProcessing(id);
  if (!current) return errors.notFound("Media");
  const metadata = withoutKeys(current.metadata, "multipart", "error");
  const [row] = await db
    .update(media)
    .set({
      status: "ready",
      ...(update.width !== undefined ? { width: update.width } : {}),
      ...(update.height !== undefined ? { height: update.height } : {}),
      ...(update.durationSeconds !== undefined ? { durationSeconds: update.durationSeconds } : {}),
      metadata: { ...metadata, ...update.metadata },
      updatedAt: new Date(),
    })
    .where(eq(media.id, current.id))
    .returning();
  if (!row) return errors.notFound("Media");
  await invalidate(row.userId, "media");
  return MediaRowSchema.parse(row);
}

/** Records the thumbnail object (merged into metadata; never changes status). */
export async function setMediaThumbnail(id: string, thumbnailKey: string): Promise<void> {
  const current = await getMediaForProcessing(id);
  if (!current) return;
  await db
    .update(media)
    .set({ metadata: { ...current.metadata, thumbnailKey }, updatedAt: new Date() })
    .where(eq(media.id, current.id));
  await invalidate(current.userId, "media");
}

export async function markMediaFailed(id: string, error: string): Promise<MediaRow | null> {
  const current = await getMediaForProcessing(id);
  if (!current) return null;
  const [row] = await db
    .update(media)
    .set({
      status: "failed",
      metadata: { ...withoutMultipart(current.metadata), error: error.slice(0, 500) },
      updatedAt: new Date(),
    })
    .where(eq(media.id, current.id))
    .returning();
  if (row) await invalidate(row.userId, "media");
  return row ? MediaRowSchema.parse(row) : null;
}

/** Uploads still "uploading" that started before `before` (abandoned tabs, crashes). */
export async function findStaleUploads(before: Date, limit = 100): Promise<MediaRow[]> {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.status, "uploading"), lt(media.createdAt, before)))
    .limit(limit);
  return z.array(MediaRowSchema).parse(rows);
}

/** Aborts + fails one stale upload. Returns false if it changed state meanwhile. */
export async function expireStaleUpload(id: string, error: string): Promise<boolean> {
  const row = await getMediaForProcessing(id);
  if (!row || row.status !== "uploading") return false;
  return (await failUpload(row, error)).changed;
}
