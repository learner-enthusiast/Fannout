import { and, db, desc, eq, inArray, media } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import {
  CreateMediaInputSchema,
  ListMediaInputSchema,
  MediaRowSchema,
  MediaStatusSchema,
  UpdateMediaInputSchema,
  type CreateMediaInput,
  type ListMediaInput,
  type MediaRow,
  type MediaStatus,
  type UpdateMediaInput,
} from "./model";

const UuidSchema = z.uuid();

export async function createMedia(input: CreateMediaInput): Promise<MediaRow> {
  const data = CreateMediaInputSchema.parse(input);
  const [row] = await db.insert(media).values(data).returning();
  if (!row) return errors.internal("Failed to create media");
  return MediaRowSchema.parse(row);
}

export async function getMediaById(userId: string, id: string): Promise<MediaRow | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, UuidSchema.parse(id)), eq(media.userId, UuidSchema.parse(userId))))
    .limit(1);
  return row ? MediaRowSchema.parse(row) : null;
}

/** Fetch several media items owned by the user; ids not owned/found are simply absent. */
export async function getMediaByIds(userId: string, ids: string[]): Promise<MediaRow[]> {
  const parsedIds = z.array(UuidSchema).parse(ids);
  if (parsedIds.length === 0) return [];
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.userId, UuidSchema.parse(userId)), inArray(media.id, parsedIds)));
  return z.array(MediaRowSchema).parse(rows);
}

export async function listMediaByUserId(
  userId: string,
  options: ListMediaInput = {},
): Promise<MediaRow[]> {
  const { type, status, limit, offset } = ListMediaInputSchema.parse(options);
  const rows = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.userId, UuidSchema.parse(userId)),
        type ? eq(media.type, type) : undefined,
        status ? eq(media.status, status) : undefined,
      ),
    )
    .orderBy(desc(media.createdAt))
    .limit(limit)
    .offset(offset);
  return z.array(MediaRowSchema).parse(rows);
}

export async function updateMedia(
  userId: string,
  id: string,
  input: UpdateMediaInput,
): Promise<MediaRow> {
  const data = UpdateMediaInputSchema.parse(input);
  const [row] = await db
    .update(media)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(media.id, UuidSchema.parse(id)), eq(media.userId, UuidSchema.parse(userId))))
    .returning();
  if (!row) return errors.notFound("Media");
  return MediaRowSchema.parse(row);
}

export async function updateMediaStatus(
  userId: string,
  id: string,
  status: MediaStatus,
): Promise<MediaRow> {
  return updateMedia(userId, id, { status: MediaStatusSchema.parse(status) });
}

export async function deleteMedia(userId: string, id: string): Promise<MediaRow> {
  const [row] = await db
    .delete(media)
    .where(and(eq(media.id, UuidSchema.parse(id)), eq(media.userId, UuidSchema.parse(userId))))
    .returning();
  if (!row) return errors.notFound("Media");
  // Returned so the caller can remove the S3 object.
  return MediaRowSchema.parse(row);
}
