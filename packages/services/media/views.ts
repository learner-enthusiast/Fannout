import { and, db, desc, eq, ilike, media, or, sql, type AnyColumn } from "@repo/database";
import { getDownloadUrl } from "@repo/s3";
import { z } from "zod";
import { afterCursor, cursorTimestamp, toPage } from "../lib/cursor";
import {
  MediaListInputSchema,
  MediaRowSchema,
  type MediaListInput,
  type MediaPage,
  type MediaRow,
  type MediaView,
} from "./model";

/** Statuses whose S3 object is complete and safe to hand out. */
const VIEWABLE = new Set(["uploaded", "processing", "ready"]);

export async function presignedUrl(row: Pick<MediaRow, "status" | "s3Key" | "s3Bucket">) {
  if (!VIEWABLE.has(row.status)) return null;
  return getDownloadUrl(row.s3Key, { bucket: row.s3Bucket });
}

export async function toMediaView(row: MediaRow): Promise<MediaView> {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    orientation: meta.orientation ?? null,
    codec: meta.codec ?? null,
    fps: meta.fps ?? null,
    jsonSchema: meta.jsonSchema ?? null,
    subtitle: meta.subtitle ?? null,
    folderSuggestion: meta.folderSuggestion ?? null,
    error: meta.error ?? null,
    url: await presignedUrl(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Escapes ILIKE wildcards in user input. */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Name search: substring (ILIKE) or fuzzy word match (pg_trgm `<%`, which
 * uses the GIN trigram index), so "graph" finds "graphql-vs-rest".
 */
export function nameMatches(column: AnyColumn, q: string) {
  return or(ilike(column, likePattern(q)), sql`${q} <% ${column}`);
}

/** Cursor-paginated library, newest first (created_at DESC, id DESC). */
export async function listMediaPage(userId: string, input: MediaListInput): Promise<MediaPage> {
  const { q, type, orientation, cursor, limit } = MediaListInputSchema.parse(input);
  const rows = await db
    .select({ row: media, cursorTs: cursorTimestamp(media.createdAt) })
    .from(media)
    .where(
      and(
        eq(media.userId, z.uuid().parse(userId)),
        type ? eq(media.type, type) : undefined,
        orientation ? sql`${media.metadata}->>'orientation' = ${orientation}` : undefined,
        q ? nameMatches(media.name, q) : undefined,
        afterCursor(media.createdAt, media.id, cursor ?? undefined),
      ),
    )
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit + 1);

  const page = toPage(
    rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row: MediaRowSchema.parse(row) })),
    limit,
  );
  return {
    items: await Promise.all(page.items.map((item) => toMediaView(item.row))),
    nextCursor: page.nextCursor,
  };
}
