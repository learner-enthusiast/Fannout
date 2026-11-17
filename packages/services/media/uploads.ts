import { and, count, db, eq, gt, inArray, lt, media, sql } from "@repo/database";
import { errors } from "@repo/errors";
import {
  abortMultipartUpload,
  buildObjectKey,
  completeMultipartUpload,
  createMultipartUpload,
  defaultBucket,
  defaultRegion,
  partCount,
  signUploadParts,
} from "@repo/s3";
import { z } from "zod";
import { invalidate } from "../cache";
import { PLATFORMS } from "../publishing/platforms";
import { createMedia, getMediaById } from "./index";
import {
  CompleteUploadInputSchema,
  CreateUploadInputSchema,
  FailUploadInputSchema,
  MAX_CONCURRENT_UPLOADS,
  MAX_PRESIGN_BATCH,
  MAX_UPLOAD_BYTES,
  MEDIA_PART_SIZE,
  SignUploadPartsInputSchema,
  SLOT_TYPES,
  MediaRowSchema,
  maxBytesFor,
  mediaTypeFromFile,
  nameFromFilename,
  type CompleteUploadInput,
  type CreateUploadInput,
  type CreateUploadResult,
  type FailUploadInput,
  type MediaMetadata,
  type MediaType,
  type SignUploadPartsInput,
  type SignUploadPartsResult,
  type MediaRow,
} from "./model";

const UuidSchema = z.uuid();

function withoutKeys(metadata: MediaMetadata | null, ...keys: (keyof MediaMetadata)[]): MediaMetadata {
  const copy: MediaMetadata = { ...metadata };
  for (const key of keys) delete copy[key];
  return copy;
}

const withoutMultipart = (metadata: MediaMetadata | null) => withoutKeys(metadata, "multipart");

/** Largest video any platform accepts (capabilities), capped by what multipart storage can hold. */
export function maxUploadBytes(type: MediaType): number {
  if (type !== "video" && type !== "image") return maxBytesFor(type);
  const limits = Object.values(PLATFORMS).map((p) => p.capabilities.mediaRules.maxVideoBytes ?? 0);
  return Math.min(MAX_UPLOAD_BYTES, Math.max(...limits) || MAX_UPLOAD_BYTES);
}

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** A ready upload of the same file (fingerprint) the user already has. */
async function findByFingerprint(userId: string, fingerprint: string, type: MediaType): Promise<MediaRow | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.userId, userId),
        eq(media.status, "ready"),
        eq(media.type, type),
        sql`${media.metadata}->>'fingerprint' = ${fingerprint}`,
      ),
    )
    .limit(1);
  return row ? MediaRowSchema.parse(row) : null;
}

/**
 * Starts an S3 multipart upload (10 MiB parts). The media row is created
 * right away with status "uploading", so posts can reference it before the
 * first byte lands. Enforces the slot's file type, the size limit and the
 * per-user count of concurrent uploads. An identical ready file (same
 * fingerprint) is reused instead: nothing to upload.
 */
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
  if (data.slot && SLOT_TYPES[data.slot] !== type) {
    return errors.badRequest(`This slot takes ${SLOT_TYPES[data.slot] === "subtitle" ? "SRT/VTT subtitles" : SLOT_TYPES[data.slot] === "json" ? "JSON files" : `${SLOT_TYPES[data.slot]}s`} only`);
  }
  const limit = maxUploadBytes(type);
  if (data.sizeBytes > limit) {
    return errors.badRequest(
      type === "subtitle" || type === "json"
        ? "Subtitle and JSON files must be 1 MB or smaller"
        : `Files can be at most ${Math.floor(limit / 1024 ** 3)} GB (the largest any platform accepts)`,
    );
  }

  if (data.fingerprint) {
    const existing = await findByFingerprint(userId, data.fingerprint, type);
    if (existing) return { mediaId: existing.id, reused: true, uploadId: null, partCount: 0, partSize: MEDIA_PART_SIZE, parts: [] };
  }

  const [active] = await db
    .select({ n: count() })
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.status, "uploading"), gt(media.createdAt, new Date(Date.now() - STALE_UPLOAD_MS))));
  if ((active?.n ?? 0) >= MAX_CONCURRENT_UPLOADS) {
    return errors.tooManyRequests(`You have ${MAX_CONCURRENT_UPLOADS} uploads in progress. Wait for some to finish or cancel them.`);
  }

  const bucket = defaultBucket();
  const key = buildObjectKey(`users/${userId}/media`, data.filename);
  const total = partCount(data.sizeBytes, MEDIA_PART_SIZE);
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
      metadata: {
        multipart: { uploadId, partSize: MEDIA_PART_SIZE },
        ...(data.fingerprint ? { fingerprint: data.fingerprint } : {}),
      },
    });
  } catch (error) {
    await abortMultipartUpload(key, uploadId, { bucket }).catch(() => undefined);
    throw error;
  }

  const first = Math.min(total, data.presignLimit ?? MAX_PRESIGN_BATCH);
  const parts = first
    ? await signUploadParts(key, uploadId, Array.from({ length: first }, (_, i) => i + 1), { bucket })
    : [];
  return { mediaId: row.id, reused: false, uploadId, partCount: total, partSize: MEDIA_PART_SIZE, parts };
}

/** Fresh presigned URLs for some parts of an upload in progress (expiry, large files, resume). */
export async function signMediaUploadParts(userId: string, input: SignUploadPartsInput): Promise<SignUploadPartsResult> {
  const { mediaId, partNumbers } = SignUploadPartsInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return errors.notFound("Media");
  const multipart = row.metadata?.multipart;
  if (row.status !== "uploading" || !multipart) return errors.conflict("This upload is not in progress");
  const total = partCount(row.sizeBytes ?? 0, multipart.partSize);
  if (partNumbers.some((n) => n > total)) return errors.badRequest(`This upload has ${total} parts`);
  const parts = await signUploadParts(row.s3Key, multipart.uploadId, [...new Set(partNumbers)], { bucket: row.s3Bucket });
  return { mediaId, partSize: multipart.partSize, parts };
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
  /** Real content type sniffed from the file's bytes (overrides what the browser claimed). */
  mimeType?: string;
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
      ...(update.mimeType ? { mimeType: update.mimeType } : {}),
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
