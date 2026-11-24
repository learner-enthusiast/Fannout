import { and, asc, count, db, eq, inArray, media, mediaFolderItems, mediaFolders, postMedia, posts } from "@repo/database";
import { errors } from "@repo/errors";
import { abortMultipartUpload, deleteObject, deleteObjects } from "@repo/s3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { invalidate } from "../cache";
import { derivativeKeys } from "./derivatives";
import { getMediaById } from "./index";
import {
  BulkDeleteMediaInputSchema,
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
  await invalidate(row.userId, "media", "posts");
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

async function blockingPostsForMedia(mediaId: string) {
  return db
    .selectDistinct({ id: posts.id, name: posts.name, status: posts.status })
    .from(postMedia)
    .innerJoin(posts, eq(posts.id, postMedia.postId))
    .where(and(eq(postMedia.mediaId, mediaId), inArray(posts.status, PENDING_POST_STATUSES)))
    .limit(10);
}

/** Plan a single or bulk library delete (one Inngest job). Throws MEDIA_IN_USE when any item is blocked. */
export async function planMediaDeleteJob(
  userId: string,
  input: z.input<typeof BulkDeleteMediaInputSchema>,
): Promise<DeleteMediaResult & { mediaIdsToQueue: string[] }> {
  const { mediaIds } = BulkDeleteMediaInputSchema.parse(input);
  const unique = [...new Set(mediaIds)];
  const blocked: { mediaId: string; name: string; posts: { id: string; name: string; status: string }[] }[] = [];
  const toQueue: string[] = [];

  for (const mediaId of unique) {
    const row = await getMediaById(userId, mediaId);
    if (!row) continue;
    const blocking = await blockingPostsForMedia(row.id);
    if (blocking.length) blocked.push({ mediaId: row.id, name: row.name, posts: blocking });
    else toQueue.push(row.id);
  }

  if (blocked.length) {
    const names = blocked.map((b) => `“${b.name}”`).join(", ");
    return errors.mediaInUse(`Can't delete ${names}: still used by unpublished posts.`, { items: blocked });
  }

  const jobId = randomUUID();
  return { accepted: true, jobId, queued: toQueue.length, mediaIdsToQueue: toQueue };
}

export async function planMediaDelete(
  userId: string,
  input: z.input<typeof DeleteMediaInputSchema>,
): Promise<DeleteMediaResult & { mediaIdsToQueue: string[] }> {
  const { mediaId } = DeleteMediaInputSchema.parse(input);
  return planMediaDeleteJob(userId, { mediaIds: [mediaId] });
}

/**
 * Deletes a media item: folder links (cascade), the stored file, the row.
 * Idempotent — already gone (or not yours) is a no-op. Used by the Inngest worker only.
 */
export async function deleteMediaChecked(
  userId: string,
  input: z.input<typeof DeleteMediaInputSchema>,
): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const { mediaId } = DeleteMediaInputSchema.parse(input);
  const row = await getMediaById(userId, mediaId);
  if (!row) return { deleted: true, alreadyGone: true };

  const blocking = await blockingPostsForMedia(row.id);
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
  const thumbnailKey = row.metadata?.thumbnailKey;
  if (thumbnailKey) await deleteObject(thumbnailKey, { bucket: row.s3Bucket }).catch(() => undefined);
  // Format-converted copies (ensureFormat) go with their original.
  const derived = derivativeKeys(row);
  if (derived.length) await deleteObjects(derived, { bucket: row.s3Bucket }).catch(() => undefined);
  // Row deleted: folder links cascade, and posts that listed this media change too.
  await invalidate(row.userId, "media", "posts");
  return { deleted: true, alreadyGone: false };
}

export type MediaDeleteJobResult = {
  total: number;
  deleted: number;
  failures: { mediaId: string; message: string }[];
};

/** Inngest worker: delete each ID; collect failures instead of failing the whole step. */
export async function runMediaDeleteJob(userId: string, mediaIds: string[]): Promise<MediaDeleteJobResult> {
  const failures: MediaDeleteJobResult["failures"] = [];
  let deleted = 0;
  for (const mediaId of mediaIds) {
    try {
      const result = await deleteMediaChecked(userId, { mediaId });
      if (!result.alreadyGone) deleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      failures.push({ mediaId, message: message.slice(0, 300) });
    }
  }
  return { total: mediaIds.length, deleted, failures };
}
