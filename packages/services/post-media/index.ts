import { and, asc, db, eq, inArray, max, media, postMedia, posts } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { invalidate } from "../cache";
import {
  AddPostMediaInputSchema,
  PostMediaRowSchema,
  PostMediaWithMediaSchema,
  ReorderPostMediaInputSchema,
  UpdatePostMediaInputSchema,
  type AddPostMediaInput,
  type PostMediaRow,
  type PostMediaWithMedia,
  type ReorderPostMediaInput,
  type UpdatePostMediaInput,
} from "./model";

const UuidSchema = z.uuid();

async function assertPostOwned(userId: string, postId: string) {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .limit(1);
  if (!row) errors.notFound("Post");
}

async function assertMediaOwned(userId: string, mediaId: string) {
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.userId, userId)))
    .limit(1);
  if (!row) errors.notFound("Media");
}

/** Returns the post_media row only if its post belongs to the user. */
async function getOwnedPostMedia(userId: string, id: string) {
  const [row] = await db
    .select({ postMedia })
    .from(postMedia)
    .innerJoin(posts, eq(postMedia.postId, posts.id))
    .where(and(eq(postMedia.id, id), eq(posts.userId, userId)))
    .limit(1);
  return row?.postMedia ?? null;
}

/** Attach a media item to a post. Appends to the end when no position is given. */
export async function addMediaToPost(
  userId: string,
  input: AddPostMediaInput,
): Promise<PostMediaRow> {
  const parsedUserId = UuidSchema.parse(userId);
  const data = AddPostMediaInputSchema.parse(input);
  await assertPostOwned(parsedUserId, data.postId);
  await assertMediaOwned(parsedUserId, data.mediaId);

  let position = data.position;
  if (position === undefined) {
    const [last] = await db
      .select({ value: max(postMedia.position) })
      .from(postMedia)
      .where(eq(postMedia.postId, data.postId));
    position = last?.value == null ? 0 : last.value + 1;
  }

  const [row] = await db
    .insert(postMedia)
    .values({ ...data, position })
    .onConflictDoNothing({ target: [postMedia.postId, postMedia.mediaId] })
    .returning();
  if (!row) return errors.conflict("Media is already attached to this post");
  await invalidate(parsedUserId, "posts");
  return PostMediaRowSchema.parse(row);
}

export async function getPostMediaById(userId: string, id: string): Promise<PostMediaRow | null> {
  const row = await getOwnedPostMedia(UuidSchema.parse(userId), UuidSchema.parse(id));
  return row ? PostMediaRowSchema.parse(row) : null;
}

export async function listPostMediaByPostId(
  userId: string,
  postId: string,
): Promise<PostMediaWithMedia[]> {
  const parsedUserId = UuidSchema.parse(userId);
  const parsedPostId = UuidSchema.parse(postId);
  await assertPostOwned(parsedUserId, parsedPostId);

  const rows = await db
    .select({ postMedia, media })
    .from(postMedia)
    .innerJoin(media, eq(postMedia.mediaId, media.id))
    .where(eq(postMedia.postId, parsedPostId))
    .orderBy(asc(postMedia.position), asc(postMedia.createdAt));

  return z
    .array(PostMediaWithMediaSchema)
    .parse(rows.map((row) => ({ ...row.postMedia, media: row.media })));
}

export async function updatePostMedia(
  userId: string,
  id: string,
  input: UpdatePostMediaInput,
): Promise<PostMediaRow> {
  const parsedId = UuidSchema.parse(id);
  const data = UpdatePostMediaInputSchema.parse(input);
  const existing = await getOwnedPostMedia(UuidSchema.parse(userId), parsedId);
  if (!existing) return errors.notFound("Post media");

  const [row] = await db.update(postMedia).set(data).where(eq(postMedia.id, parsedId)).returning();
  if (!row) return errors.notFound("Post media");
  return PostMediaRowSchema.parse(row);
}

/** Set positions to match the given order. Every id must belong to the post. */
export async function reorderPostMedia(
  userId: string,
  input: ReorderPostMediaInput,
): Promise<PostMediaRow[]> {
  const parsedUserId = UuidSchema.parse(userId);
  const { postId, orderedIds } = ReorderPostMediaInputSchema.parse(input);
  await assertPostOwned(parsedUserId, postId);

  const existing = await db
    .select({ id: postMedia.id })
    .from(postMedia)
    .where(and(eq(postMedia.postId, postId), inArray(postMedia.id, orderedIds)));
  if (existing.length !== new Set(orderedIds).size || existing.length !== orderedIds.length) {
    return errors.badRequest("orderedIds must be unique post_media ids belonging to the post");
  }

  const rows = await db.transaction(async (tx) => {
    const updated = [];
    for (const [position, id] of orderedIds.entries()) {
      const [row] = await tx
        .update(postMedia)
        .set({ position })
        .where(and(eq(postMedia.id, id), eq(postMedia.postId, postId)))
        .returning();
      if (row) updated.push(row);
    }
    return updated;
  });

  return z.array(PostMediaRowSchema).parse(rows);
}

export async function removeMediaFromPost(userId: string, id: string): Promise<void> {
  const parsedId = UuidSchema.parse(id);
  const existing = await getOwnedPostMedia(UuidSchema.parse(userId), parsedId);
  if (!existing) {
    errors.notFound("Post media");
    return;
  }
  await db.delete(postMedia).where(eq(postMedia.id, parsedId));
  await invalidate(UuidSchema.parse(userId), "posts");
}
