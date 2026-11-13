import { and, db, eq, inArray, media, ne, sql } from "@repo/database";
import { z } from "zod";
import { invalidate } from "../cache";
import { MediaRowSchema, type FolderSuggestion, type MediaRow, type MediaType } from "./model";
import {
  buildFolderSuggestion,
  packageFileNames,
  SocialPackageSchema,
  type SocialPackage,
} from "./social-package";

/**
 * Folder suggestion for a social-package JSON, matched against the user's
 * uploads by original filename. Uploads still in progress count (their type
 * is known), so a JSON that finishes before its videos still finds them.
 */
export async function suggestFolder(
  userId: string,
  jsonMediaId: string,
  pkg: SocialPackage,
): Promise<FolderSuggestion> {
  const names = [...new Set(packageFileNames(pkg))];
  const candidates =
    names.length === 0
      ? []
      : await db
          .select({
            id: media.id,
            originalFilename: media.originalFilename,
            type: media.type,
            createdAt: media.createdAt,
          })
          .from(media)
          .where(
            and(
              eq(media.userId, z.uuid().parse(userId)),
              ne(media.status, "failed"),
              inArray(sql`lower(regexp_replace(${media.originalFilename}, '^.*[\\\\/]', ''))`, names),
            ),
          );
  return buildFolderSuggestion(
    pkg,
    jsonMediaId,
    candidates.map((row) => ({ ...row, type: row.type as MediaType })),
  );
}

/** Recomputes and stores the suggestion of a ready social-package JSON (e.g. after its videos arrived). */
export async function refreshFolderSuggestion(row: MediaRow): Promise<MediaRow> {
  const stored = row.metadata?.socialPackage;
  if (row.type !== "json" || row.status !== "ready" || !stored) return row;
  const pkg = SocialPackageSchema.parse(stored);
  const next = await suggestFolder(row.userId, row.id, pkg);
  if (JSON.stringify(next) === JSON.stringify(row.metadata?.folderSuggestion ?? null)) return row;
  const [updated] = await db
    .update(media)
    .set({ metadata: { ...row.metadata, folderSuggestion: next } })
    .where(eq(media.id, row.id))
    .returning();
  if (updated) await invalidate(updated.userId, "media");
  return updated ? MediaRowSchema.parse(updated) : row;
}
