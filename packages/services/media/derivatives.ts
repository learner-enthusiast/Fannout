import { randomUUID } from "node:crypto";
import { db, eq, media, sql } from "@repo/database";
import { imageFormatOf, type ImageFormat } from "@repo/providers";
import { getRedis } from "@repo/redis";
import { downloadObjectAsBuffer, getDownloadUrl, headObject, uploadObject } from "@repo/s3";
import sharp from "sharp";
import { z } from "zod";
import { invalidate } from "../cache";
import { MediaDerivativeSchema, type MediaDerivative, type MediaRow } from "./model";
import { getMediaForProcessing } from "./uploads";

/**
 * Original form factor: a derivative only changes the FORMAT. Exact width and height are kept;
 * a proportional downscale (same aspect ratio) is the last resort for a byte limit. Never crop,
 * pad, letterbox or stretch. The original object is never modified.
 */

/** Formats ensureFormat can build. */
export const DerivableFormatSchema = z.enum(["jpeg"]);
export type DerivableFormat = z.infer<typeof DerivableFormatSchema>;

const EnsureFormatInputSchema = z.object({
  mediaId: z.uuid(),
  targetFormat: DerivableFormatSchema,
  maxBytes: z.number().int().positive(),
});

export type EnsuredFile = { url: string; key: string; derivative: MediaDerivative | null };

const JPEG = { quality: 92, minQuality: 80, qualityStep: 2, scaleStep: 0.1, minScale: 0.1 } as const;
const URL_TTL_SECONDS = 6 * 60 * 60;
const LOCK_MS = 2 * 60_000;
const LOCK_WAIT_MS = 90_000;

/** Object key next to the original: <original dir>/derived/{mediaId}/{format}.jpg. */
export function derivativeKeyFor(row: Pick<MediaRow, "id" | "s3Key">, format: DerivableFormat): string {
  const slash = row.s3Key.lastIndexOf("/");
  const dir = slash >= 0 ? row.s3Key.slice(0, slash + 1) : "";
  return `${dir}derived/${row.id}/${format}.jpg`;
}

/** Every derivative object key recorded on a media row (for deletes). */
export function derivativeKeys(row: Pick<MediaRow, "metadata">): string[] {
  return Object.values(row.metadata?.derivatives ?? {}).map((d) => d.key);
}

/** The original already fits: right format and within the byte limit. */
export function originalFits(row: Pick<MediaRow, "mimeType" | "sizeBytes">, accepted: readonly ImageFormat[], maxBytes: number): boolean {
  const format = imageFormatOf(row.mimeType);
  return Boolean(format && accepted.includes(format) && (row.sizeBytes ?? 0) <= maxBytes);
}

/** A recorded derivative that is usable for this limit (checksum is checked by ensureFormat). */
export function recordedDerivative(row: Pick<MediaRow, "metadata">, format: DerivableFormat, maxBytes: number): MediaDerivative | null {
  const parsed = MediaDerivativeSchema.safeParse(row.metadata?.derivatives?.[format]);
  return parsed.success && parsed.data.bytes <= maxBytes ? parsed.data : null;
}

/**
 * Returns a file in `targetFormat` within `maxBytes` for this media: the original when it already
 * matches, a recorded derivative built from the same source, or a new one (built once, even when two
 * publishes ask at the same time: Redis lock + a deterministic key).
 */
export async function ensureFormat(mediaId: string, targetFormat: DerivableFormat, maxBytes: number): Promise<EnsuredFile> {
  const input = EnsureFormatInputSchema.parse({ mediaId, targetFormat, maxBytes });
  const row = await getMediaForProcessing(input.mediaId);
  if (!row) throw new DerivativeError("Media not found");
  if (row.type !== "image") throw new DerivativeError(`${row.name} isn't an image`);

  if (originalFits(row, [input.targetFormat], input.maxBytes)) {
    return { url: await url(row, row.s3Key), key: row.s3Key, derivative: null };
  }

  const source = await headObject(row.s3Key, { bucket: row.s3Bucket });
  if (!source) throw new DerivativeError(`${row.name} is missing from storage`);
  const checksum = source.etag ?? `${source.contentLength ?? 0}:${source.lastModified?.toISOString() ?? ""}`;

  const reuse = (r: MediaRow) => {
    const d = recordedDerivative(r, input.targetFormat, input.maxBytes);
    return d && d.sourceChecksum === checksum ? d : null;
  };
  const existing = reuse(row);
  if (existing) return { url: await url(row, existing.key), key: existing.key, derivative: existing };

  const redis = getRedis();
  const lockKey = `fannout:derivative-lock:${row.id}:${input.targetFormat}`;
  const token = randomUUID();
  const locked = (await redis.set(lockKey, token, "PX", LOCK_MS, "NX")) === "OK";
  if (!locked) {
    // Someone else is building it: wait for their result, then build ourselves (same key, same bytes).
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const fresh = await getMediaForProcessing(row.id);
      const done = fresh ? reuse(fresh) : null;
      if (done) return { url: await url(row, done.key), key: done.key, derivative: done };
      if (!(await redis.exists(lockKey))) break;
    }
  }
  try {
    const derivative = await build(row, input.targetFormat, input.maxBytes, checksum);
    return { url: await url(row, derivative.key), key: derivative.key, derivative };
  } finally {
    if (locked && (await redis.get(lockKey)) === token) await redis.del(lockKey);
  }
}

/** Conversion failed for a reason a retry can't fix (unreadable/unsupported image). */
export class DerivativeError extends Error {
  override name = "DerivativeError";
}

async function url(row: MediaRow, key: string) {
  return getDownloadUrl(key, { bucket: row.s3Bucket, expiresIn: URL_TTL_SECONDS });
}

async function build(row: MediaRow, format: DerivableFormat, maxBytes: number, sourceChecksum: string): Promise<MediaDerivative> {
  const original = await downloadObjectAsBuffer(row.s3Key, { bucket: row.s3Bucket });
  if (!original) throw new DerivativeError(`${row.name} is missing from storage`);

  let encoded: Awaited<ReturnType<typeof encodeJpeg>>;
  try {
    encoded = await encodeJpeg(original, maxBytes);
  } catch (error) {
    throw new DerivativeError(`${row.name} couldn't be converted to ${format.toUpperCase()}: ${error instanceof Error ? error.message : "unreadable image"}`);
  }

  const key = derivativeKeyFor(row, format);
  await uploadObject(key, encoded.data, { bucket: row.s3Bucket, contentType: "image/jpeg", cacheControl: "private, max-age=31536000" });
  const derivative = MediaDerivativeSchema.parse({
    key,
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.data.length,
    scaled: encoded.scaled,
    sourceChecksum,
  });
  // Atomic merge: concurrent writes of other formats (or other metadata) are kept.
  await db
    .update(media)
    .set({
      metadata: sql`coalesce(${media.metadata}, '{}'::jsonb) || jsonb_build_object('derivatives', coalesce(${media.metadata} -> 'derivatives', '{}'::jsonb) || jsonb_build_object(${format}::text, ${JSON.stringify(derivative)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(eq(media.id, row.id));
  await invalidate(row.userId, "media");
  return derivative;
}

/**
 * EXIF orientation applied, metadata stripped, sRGB, alpha flattened onto white, exact size kept.
 * Quality 92 → 80 (step 2); only then proportional 10 % downscales until it fits.
 */
async function encodeJpeg(input: Buffer, maxBytes: number) {
  const render = (quality: number, width?: number) => {
    let pipeline = sharp(input, { failOn: "none" }).rotate().toColourspace("srgb").flatten({ background: "#ffffff" });
    // `width` alone keeps the aspect ratio; withoutEnlargement guards rounding.
    if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
    return pipeline
      .jpeg({ quality, progressive: true, chromaSubsampling: "4:4:4", mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
  };

  for (let quality: number = JPEG.quality; quality >= JPEG.minQuality; quality -= JPEG.qualityStep) {
    const { data, info } = await render(quality);
    if (data.length <= maxBytes) return { data, width: info.width, height: info.height, scaled: false };
  }
  const full = await render(JPEG.minQuality);
  const baseWidth = full.info.width;
  for (let scale = 1 - JPEG.scaleStep; scale >= JPEG.minScale - 1e-9; scale -= JPEG.scaleStep) {
    const width = Math.max(1, Math.round(baseWidth * scale));
    const { data, info } = await render(JPEG.minQuality, width);
    if (data.length <= maxBytes) return { data, width: info.width, height: info.height, scaled: true };
  }
  throw new Error(`can't fit in ${Math.round(maxBytes / (1024 * 1024))} MB`);
}
