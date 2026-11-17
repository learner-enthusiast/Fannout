import { crc32 } from "node:zlib";
import { and, db, eq, inArray, media } from "@repo/database";
import { errors } from "@repo/errors";
import { downloadObjectAsBuffer } from "@repo/s3";
import { z } from "zod";
import { MediaRowSchema } from "./model";

/** Images for a manual post, zipped in slide order. Built in memory, so the total is capped. */
export const ZIP_MAX_BYTES = 80 * 1024 * 1024;

export const ZipMediaInputSchema = z.object({
  mediaIds: z.array(z.uuid()).min(1).max(20).describe("Your image media IDs, in slide order."),
});
export const ZipMediaResultSchema = z.object({
  filename: z.string().describe("Suggested file name."),
  base64: z.string().describe("The .zip file, base64-encoded. Entries are numbered in slide order."),
  count: z.number().int().describe("Images in the archive."),
});

type Entry = { name: string; data: Buffer };

/** Minimal ZIP writer (method 0 = stored: images are already compressed). */
export function buildZip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00 (time + date)
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, entry.data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(0x00210000, 12);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const safeName = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "image";

/**
 * Zips the user's own images in the given order. The files are read from storage on the
 * server; bucket names and object keys never reach the browser.
 */
export async function zipMedia(userId: string, input: z.input<typeof ZipMediaInputSchema>) {
  const { mediaIds } = ZipMediaInputSchema.parse(input);
  const rows = await db.select().from(media).where(and(eq(media.userId, userId), inArray(media.id, mediaIds)));
  const byId = new Map(rows.map((row) => [row.id, MediaRowSchema.parse(row)]));
  const ordered = mediaIds.map((id) => byId.get(id));
  if (ordered.some((row) => !row)) return errors.notFound("Media");
  const images = ordered.filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (images.some((row) => row.type !== "image" || row.status !== "ready")) return errors.badRequest("Only ready images can be downloaded together");
  const total = images.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0);
  if (total > ZIP_MAX_BYTES) return errors.badRequest("These images are too large to zip together (80 MB). Download them one by one from the library.");

  const entries: Entry[] = [];
  for (const [index, row] of images.entries()) {
    const data = await downloadObjectAsBuffer(row.s3Key, { bucket: row.s3Bucket });
    if (!data) return errors.notFound(`${row.name} is missing from storage`);
    const extension = EXTENSION[row.mimeType] ?? row.originalFilename?.split(".").pop()?.toLowerCase() ?? "jpg";
    entries.push({ name: `${String(index + 1).padStart(2, "0")}-${safeName(row.name)}.${extension}`, data });
  }
  return { filename: `fannout-images-${entries.length}.zip`, base64: buildZip(entries).toString("base64"), count: entries.length };
}
