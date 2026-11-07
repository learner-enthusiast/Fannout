import { and, asc, db, eq, media, mediaFolderItems, mediaFolders } from "@repo/database";
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
  const folders = await foldersForMedia(userId, row.id);
  return {
    ...(await toMediaView(row)),
    folders: folders.map((folder) => ({ ...folder, role: folder.role as MediaDetail["folders"][number]["role"] })),
  };
}

/**
 * Deletes a media item and its stored file. If folders still use it, nothing
 * is deleted and their names come back in `inUse` — unless `force` is set.
 */
export async function deleteMediaChecked(
  userId: string,
  input: z.input<typeof DeleteMediaInputSchema>,
): Promise<DeleteMediaResult> {
  const { mediaId, force } = DeleteMediaInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return errors.notFound("Media");

  const inUse = [...new Set((await foldersForMedia(userId, row.id)).map((f) => f.name))];
  if (inUse.length > 0 && !force) return { deleted: false, inUse };

  const multipart = row.metadata?.multipart;
  if (multipart) {
    await abortMultipartUpload(row.s3Key, multipart.uploadId, { bucket: row.s3Bucket }).catch(() => undefined);
  }
  // Links cascade; a folder whose cover was this media falls back to "no cover".
  await db.delete(media).where(and(eq(media.id, row.id), eq(media.userId, row.userId)));
  await deleteObject(row.s3Key, { bucket: row.s3Bucket }).catch(() => undefined);
  return { deleted: true, inUse: [] };
}
