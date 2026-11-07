import { and, db, desc, eq, media, mediaFolders, sql, type AnyColumn } from "@repo/database";
import { z } from "zod";
import { toFolderSummaries } from "../media-folders";
import { MediaRowSchema } from "../media/model";
import { nameMatches, toMediaView } from "../media/views";
import { UnifiedSearchInputSchema, type UnifiedSearchResult } from "./model";

/** Trigram rank: best of whole-string and word similarity (pg_trgm). */
const rank = (column: AnyColumn, q: string) =>
  sql<number>`greatest(similarity(${column}, ${q}), word_similarity(${q}, ${column}))`;

/** Folders and media whose name matches `q`, best matches first. */
export async function unifiedSearch(
  userId: string,
  input: z.input<typeof UnifiedSearchInputSchema>,
): Promise<UnifiedSearchResult> {
  const { q, limit } = UnifiedSearchInputSchema.parse(input);
  const owner = z.uuid().parse(userId);

  const [folderRows, mediaRows] = await Promise.all([
    db
      .select()
      .from(mediaFolders)
      .where(and(eq(mediaFolders.userId, owner), nameMatches(mediaFolders.name, q)))
      .orderBy(desc(rank(mediaFolders.name, q)), mediaFolders.name)
      .limit(limit),
    db
      .select()
      .from(media)
      .where(and(eq(media.userId, owner), nameMatches(media.name, q)))
      .orderBy(desc(rank(media.name, q)), desc(media.createdAt))
      .limit(limit),
  ]);

  return {
    folders: await toFolderSummaries(folderRows),
    media: await Promise.all(mediaRows.map((row) => toMediaView(MediaRowSchema.parse(row)))),
  };
}
