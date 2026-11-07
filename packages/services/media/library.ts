import { and, asc, count, db, eq, inArray, media, mediaFolderItems, mediaFolders, postMedia, posts } from "@repo/database";
import { errors } from "@repo/errors";
import { abortMultipartUpload, deleteObject } from "@repo/s3";
import { z } from "zod";
import { getMediaById } from "./index";
import {
  DeleteMediaInputSchema,
  MediaRowSchema,
  RenameMediaInputSchema,
  type DeleteMediaResult,
  type MediaDetail,
  type MediaView,
} from "./model";
import { refreshFolderSuggestion } from "./suggestions";
import { toMediaView } from "./views";

export async function renameMedia(userId: string, input: z.input<typeof RenameMediaInputSchema>): Promise<MediaView> {
  const { mediaId, name } = RenameMediaInputSchema.parse(input);
  const [row] = await db
    .update(media)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(media.id, mediaId), eq(media.userId, z.uuid().parse(userId))))
    .returning();
  if (!row) return errors.notFound("Media");
  return toMediaView(MediaRowSchema.parse(row));
}

/** Folders a media item belongs to (for detail pages and delete checks). */
export async function foldersForMedia(userId: string, mediaId: string) {
  return db
    .select({ folderId: mediaFolders.id, name: mediaFolders.name, role: mediaFolderItems.role })
    .from(mediaFolderItems)
    .innerJoin(mediaFolders, eq(mediaFolders.id, mediaFolderItems.folderId))
    .where(and(eq(mediaFolderItems.mediaId, mediaId), eq(mediaFolders.userId, userId)))
    .orderBy(asc(mediaFolders.name));
}

export async function getMediaDetail(userId: string, mediaId: string): Promise<MediaDetail> {
  const found = await getMediaById(userId, z.uuid().parse(mediaId));
  if (!found) return errors.notFound("Media");
  const row = await refreshFolderSuggestion(found);
  const [folders, [usage]] = await Promise.all([
    foldersForMedia(userId, row.id),
    db.select({ value: count() }).from(postMedia).where(eq(postMedia.mediaId, row.id)),
  ]);
  return {
    ...(await toMediaView(row)),
    folders: folders.map((folder) => ({ ...folder, role: folder.role as MediaDetail["folders"][number]["role"] })),
    inUseByPosts: usage?.value ?? 0,
  };
}

/** Post statuses that still need their media (published posts already copied it). */
const PENDING_POST_STATUSES = ["draft", "queued", "scheduled", "publishing"];

/**
 * Deletes a media item: folder links (cascade), the stored file, the row.
 * Idempotent — already gone (or not yours) returns success. Media still used
 * by unpublished posts is rejected with MEDIA_IN_USE + the posts.
 */
export async function deleteMediaChecked(
  userId: string,
  input: z.input<typeof DeleteMediaInputSchema>,
): Promise<DeleteMediaResult> {
  const { mediaId } = DeleteMediaInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return { deleted: true, alreadyGone: true };

  const blocking = await db
    .selectDistinct({ id: posts.id, name: posts.name, status: posts.status })
    .from(postMedia)
    .innerJoin(posts, eq(posts.id, postMedia.postId))
    .where(and(eq(postMedia.mediaId, row.id), inArray(posts.status, PENDING_POST_STATUSES)))
    .limit(10);
  if (blocking.length) {
    return errors.mediaInUse(
      `“${row.name}” is used by unpublished posts: ${blocking.map((p) => p.name).join(", ")}`,
      { posts: blocking },
    );
  }

  const multipart = row.metadata?.multipart;
  if (multipart) {
    await abortMultipartUpload(row.s3Key, multipart.uploadId, { bucket: row.s3Bucket }).catch(() => undefined);
  }
  // Folder links cascade; a folder whose cover was this media falls back to "no cover".
  await db.delete(media).where(and(eq(media.id, row.id), eq(media.userId, row.userId)));
  await deleteObject(row.s3Key, { bucket: row.s3Bucket }).catch(() => undefined);
  return { deleted: true, alreadyGone: false };
}
