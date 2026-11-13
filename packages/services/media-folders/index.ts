import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  inArray,
  media,
  mediaFolderItems,
  mediaFolders,
  sql,
} from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { afterCursor, cursorTimestamp, toPage } from "../lib/cursor";
import { decodeKeyCursor, toKeyPage } from "../common/pagination";
import { isUniqueViolation } from "../lib/pg-errors";
import { MediaRowSchema, type MediaRow } from "../media/model";
import { cacheableMediaRow, nameMatches, presignedThumbUrl, presignedUrl } from "../media/views";
import {
  AddItemsInputSchema,
  CreateFolderInputSchema,
  FOLDER_ROLES,
  FolderItemsInputSchema,
  FromSuggestionInputSchema,
  ListFoldersInputSchema,
  ReorderInputSchema,
  RemoveItemInputSchema,
  UpdateFolderInputSchema,
  UpdateItemInputSchema,
  type FolderDetail,
  type FolderItemsInput,
  type FolderItemView,
  type FolderRole,
  type FolderSummary,
  type ListFoldersInput,
} from "./model";
import { assertRoleFits, planAdditions, validateFolderItems, type Link, type OwnedMedia } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

const UuidSchema = z.uuid();
const nameTaken = () => errors.conflict("You already have a folder with this name");

async function ownedFolder(exec: Exec, userId: string, folderId: string) {
  const [folder] = await exec
    .select()
    .from(mediaFolders)
    .where(and(eq(mediaFolders.id, UuidSchema.parse(folderId)), eq(mediaFolders.userId, UuidSchema.parse(userId))))
    .limit(1);
  if (!folder) return errors.notFound("Folder");
  return folder;
}

async function loadMedia(exec: Exec, ids: string[]): Promise<OwnedMedia[]> {
  if (ids.length === 0) return [];
  return exec
    .select({ id: media.id, userId: media.userId, type: media.type })
    .from(media)
    .where(inArray(media.id, ids)) as Promise<OwnedMedia[]>;
}

async function folderLinks(exec: Exec, folderId: string): Promise<Link[]> {
  const rows = await exec
    .select({
      mediaId: mediaFolderItems.mediaId,
      role: mediaFolderItems.role,
      label: mediaFolderItems.label,
      position: mediaFolderItems.position,
      isPrimary: mediaFolderItems.isPrimary,
    })
    .from(mediaFolderItems)
    .where(eq(mediaFolderItems.folderId, folderId))
    .orderBy(asc(mediaFolderItems.position));
  return rows as Link[];
}

const touch = (exec: Exec, folderId: string) =>
  exec.update(mediaFolders).set({ updatedAt: new Date() }).where(eq(mediaFolders.id, folderId));

/** Validates + inserts links (clearing replaced primaries first, for the partial unique index). */
async function insertItems(
  tx: Tx,
  userId: string,
  folderId: string,
  items: { mediaId: string; role: FolderRole; label?: string | null; isPrimary?: boolean }[],
) {
  if (items.length === 0) return;
  const existing = await folderLinks(tx, folderId);
  validateFolderItems({
    userId,
    folderUserId: userId,
    media: await loadMedia(tx, items.map((item) => item.mediaId)),
    items,
    existingMediaIds: existing.map((link) => link.mediaId),
  });
  const { inserts, clearPrimaryRoles } = planAdditions(existing, items);
  if (clearPrimaryRoles.length) {
    await tx
      .update(mediaFolderItems)
      .set({ isPrimary: false })
      .where(and(eq(mediaFolderItems.folderId, folderId), inArray(mediaFolderItems.role, clearPrimaryRoles)));
  }
  await tx.insert(mediaFolderItems).values(inserts.map((link) => ({ ...link, folderId })));
}

/** Makes the lowest-position item of a role primary when the role has none. */
async function ensurePrimary(tx: Tx, folderId: string, role: FolderRole) {
  const links = (await folderLinks(tx, folderId)).filter((link) => link.role === role);
  if (links.length === 0 || links.some((link) => link.isPrimary)) return;
  await tx
    .update(mediaFolderItems)
    .set({ isPrimary: true })
    .where(and(eq(mediaFolderItems.folderId, folderId), eq(mediaFolderItems.mediaId, links[0]!.mediaId)));
}

async function renumber(tx: Tx, folderId: string, role: FolderRole, mediaIds: string[]) {
  for (const [position, mediaId] of mediaIds.entries()) {
    await tx
      .update(mediaFolderItems)
      .set({ position })
      .where(
        and(
          eq(mediaFolderItems.folderId, folderId),
          eq(mediaFolderItems.mediaId, mediaId),
          eq(mediaFolderItems.role, role),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createFolder(userId: string, input: z.input<typeof CreateFolderInputSchema>) {
  const data = CreateFolderInputSchema.parse(input);
  try {
    const folderId = await db.transaction(async (tx) => {
      const [folder] = await tx
        .insert(mediaFolders)
        .values({ userId, name: data.name, description: data.description ?? null })
        .returning({ id: mediaFolders.id });
      await insertItems(tx, userId, folder!.id, data.items ?? []);
      return folder!.id;
    });
    await invalidate(userId, "media");
    return getFolder(userId, folderId);
  } catch (error) {
    if (isUniqueViolation(error)) return nameTaken();
    throw error;
  }
}

export async function updateFolder(userId: string, input: z.input<typeof UpdateFolderInputSchema>) {
  const { folderId, name, description, coverMediaId } = UpdateFolderInputSchema.parse(input);
  await ownedFolder(db, userId, folderId);
  if (coverMediaId) {
    const [cover] = await loadMedia(db, [coverMediaId]);
    if (!cover || cover.userId !== userId) return errors.notFound("Media");
    if (cover.type !== "image") return errors.badRequest("The cover must be an image");
  }
  try {
    await db
      .update(mediaFolders)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(coverMediaId !== undefined ? { coverMediaId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(mediaFolders.id, folderId));
  } catch (error) {
    if (isUniqueViolation(error)) return nameTaken();
    throw error;
  }
  await invalidate(userId, "media");
  return getFolder(userId, folderId);
}

/** Deletes the folder and its links only — the media stays in the library. */
export async function deleteFolder(userId: string, folderId: string): Promise<void> {
  // Idempotent: already gone (or not yours) → nothing to do. Media is never deleted.
  await db
    .delete(mediaFolders)
    .where(and(eq(mediaFolders.id, UuidSchema.parse(folderId)), eq(mediaFolders.userId, UuidSchema.parse(userId))));
  await invalidate(userId, "media");
}

/** Cover media per folder: the explicit cover, else the primary thumbnail. */
async function coverMedia(folders: { id: string; coverMediaId: string | null }[]) {
  const ids = folders.map((folder) => folder.id);
  const result = new Map<string, MediaRow>();
  if (ids.length === 0) return result;

  const thumbs = await db
    .select({ folderId: mediaFolderItems.folderId, mediaId: mediaFolderItems.mediaId })
    .from(mediaFolderItems)
    .where(
      and(
        inArray(mediaFolderItems.folderId, ids),
        eq(mediaFolderItems.role, "thumbnail"),
        eq(mediaFolderItems.isPrimary, true),
      ),
    );
  const primaryThumb = new Map(thumbs.map((row) => [row.folderId, row.mediaId]));
  const wanted = new Map(
    folders
      .map((folder) => [folder.id, folder.coverMediaId ?? primaryThumb.get(folder.id)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (wanted.size === 0) return result;

  const rows = await db.select().from(media).where(inArray(media.id, [...new Set(wanted.values())]));
  const byId = new Map(rows.map((row) => [row.id, MediaRowSchema.parse(row)]));
  for (const [folderId, mediaId] of wanted) {
    const row = byId.get(mediaId);
    if (row) result.set(folderId, row);
  }
  return result;
}

/** Cover URL per folder (presigned: never cached). */
async function coverUrls(folders: { id: string; coverMediaId: string | null }[]) {
  const covers = await coverMedia(folders);
  const result = new Map<string, string>();
  await Promise.all(
    [...covers].map(async ([folderId, row]) => {
      const url = await presignedUrl(row);
      if (url) result.set(folderId, url);
    }),
  );
  return result;
}

async function itemCounts(ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ folderId: mediaFolderItems.folderId, value: count() })
    .from(mediaFolderItems)
    .where(inArray(mediaFolderItems.folderId, ids))
    .groupBy(mediaFolderItems.folderId);
  return new Map(rows.map((row) => [row.folderId, row.value]));
}

export async function toFolderSummaries(
  rows: (typeof mediaFolders.$inferSelect)[],
): Promise<FolderSummary[]> {
  const [covers, counts] = await Promise.all([coverUrls(rows), itemCounts(rows.map((row) => row.id))]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    itemCount: counts.get(row.id) ?? 0,
    coverUrl: covers.get(row.id) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** A folder summary before its cover is signed: this, not FolderSummary, is what Redis holds. */
const FolderPartSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
  coverMedia: MediaRowSchema.nullable(),
});
const FolderPartsPageSchema = z.object({ items: z.array(FolderPartSchema), nextCursor: z.string().nullable() });

async function toFolderParts(rows: (typeof mediaFolders.$inferSelect)[]) {
  const [covers, counts] = await Promise.all([coverMedia(rows), itemCounts(rows.map((row) => row.id))]);
  return rows.map((row) => {
    const cover = covers.get(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      itemCount: counts.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      coverMedia: cover ? cacheableMediaRow(cover) : null,
    };
  });
}

/** Group "media". Covers are signed after the cache read (presigned URLs are never cached). */
export async function listFolders(userId: string, input: ListFoldersInput = {}) {
  const parsed = ListFoldersInputSchema.parse(input);
  const page = await cached({
    userId,
    group: "media",
    key: "listFolders",
    input: { q: parsed.q ?? null, cursor: parsed.cursor ?? null, limit: parsed.limit },
    schema: FolderPartsPageSchema,
    load: () => loadFolderParts(userId, parsed),
  });
  const items: FolderSummary[] = await Promise.all(
    page.items.map(async ({ coverMedia: cover, ...part }) => ({ ...part, coverUrl: cover ? await presignedUrl(cover) : null })),
  );
  return { items, nextCursor: page.nextCursor };
}

async function loadFolderParts(userId: string, { q, cursor, limit }: z.output<typeof ListFoldersInputSchema>) {
  const rows = await db
    .select({ row: mediaFolders, cursorTs: cursorTimestamp(mediaFolders.createdAt) })
    .from(mediaFolders)
    .where(
      and(
        eq(mediaFolders.userId, UuidSchema.parse(userId)),
        q ? nameMatches(mediaFolders.name, q) : undefined,
        afterCursor(mediaFolders.createdAt, mediaFolders.id, cursor ?? undefined),
      ),
    )
    .orderBy(desc(mediaFolders.createdAt), desc(mediaFolders.id))
    .limit(limit + 1);
  const page = toPage(rows.map(({ row, cursorTs }) => ({ id: row.id, cursorTs, row })), limit);
  return {
    items: await toFolderParts(page.items.map((item) => item.row)),
    nextCursor: page.nextCursor,
  };
}

async function toItemView(link: Link, row: MediaRow): Promise<FolderItemView> {
  return {
    ...link,
    media: {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      orientation: row.metadata?.orientation ?? null,
      durationSeconds: row.durationSeconds,
      width: row.width,
      height: row.height,
      previewUrl: await presignedUrl(row),
      thumbUrl: await presignedThumbUrl(row),
    },
  };
}

export async function getFolder(userId: string, folderId: string): Promise<FolderDetail> {
  const folder = await ownedFolder(db, userId, folderId);
  const counts = await db
    .select({ role: mediaFolderItems.role, value: count() })
    .from(mediaFolderItems)
    .where(eq(mediaFolderItems.folderId, folder.id))
    .groupBy(mediaFolderItems.role);
  const [summary] = await toFolderSummaries([folder]);
  return {
    ...summary!,
    coverMediaId: folder.coverMediaId,
    roleCounts: Object.fromEntries(counts.map((c) => [c.role, c.value])),
  };
}

/** Role rank as SQL (FOLDER_ROLES order), for sorting + the cursor. */
const roleRank = sql<number>`array_position(${sql.raw(`ARRAY[${FOLDER_ROLES.map((r) => `'${r}'`).join(",")}]::text[]`)}, ${mediaFolderItems.role})`;

/** Items of a folder, 10 at a time: role → position → id (sortKey = "rank:position"). */
const FolderItemRowsPageSchema = z.object({
  items: z.array(
    z.object({
      link: z.object({ mediaId: z.uuid(), role: z.string(), label: z.string().nullable(), position: z.number().int(), isPrimary: z.boolean() }),
      row: MediaRowSchema,
    }),
  ),
  nextCursor: z.string().nullable(),
});

/** Group "media". Rows are cached; presigned preview/thumb URLs are signed per read. */
export async function listFolderItems(userId: string, input: FolderItemsInput) {
  const parsed = FolderItemsInputSchema.parse(input);
  const page = await cached({
    userId,
    group: "media",
    key: "listFolderItems",
    input: { folderId: parsed.folderId, role: parsed.role ?? null, cursor: parsed.cursor ?? null, limit: parsed.limit },
    schema: FolderItemRowsPageSchema,
    load: () => loadFolderItemRows(userId, parsed),
  });
  const items = await Promise.all(page.items.map(({ link, row }) => toItemView(link as Link, row)));
  return { items, nextCursor: page.nextCursor };
}

async function loadFolderItemRows(userId: string, { folderId, role, cursor, limit }: z.output<typeof FolderItemsInputSchema>) {
  const folder = await ownedFolder(db, userId, folderId);
  const after = cursor ? decodeKeyCursor(cursor) : null;
  const [afterRank, afterPosition] = after ? after.sortKey.split(":").map(Number) : [0, 0];

  const rows = await db
    .select({ link: mediaFolderItems, row: media, rank: roleRank })
    .from(mediaFolderItems)
    .innerJoin(media, eq(media.id, mediaFolderItems.mediaId))
    .where(
      and(
        eq(mediaFolderItems.folderId, folder.id),
        role ? eq(mediaFolderItems.role, role) : undefined,
        after
          ? sql`(${roleRank}, ${mediaFolderItems.position}, ${mediaFolderItems.mediaId}) > (${afterRank}, ${afterPosition}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(roleRank, asc(mediaFolderItems.position), asc(mediaFolderItems.mediaId))
    .limit(limit + 1);

  const page = toKeyPage(rows, limit, (r) => ({ sortKey: `${r.rank}:${r.link.position}`, id: r.link.mediaId }));
  return {
    items: page.items.map(({ link, row }) => ({
      link: { mediaId: link.mediaId, role: link.role, label: link.label, position: link.position, isPrimary: link.isPrimary },
      row: cacheableMediaRow(MediaRowSchema.parse(row)),
    })),
    nextCursor: page.nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function addFolderItems(userId: string, input: z.input<typeof AddItemsInputSchema>) {
  const { folderId, items } = AddItemsInputSchema.parse(input);
  await db.transaction(async (tx) => {
    await ownedFolder(tx, userId, folderId);
    await insertItems(tx, userId, folderId, items);
    await touch(tx, folderId);
  });
  await invalidate(userId, "media");
  return getFolder(userId, folderId);
}

export async function removeFolderItem(userId: string, input: z.input<typeof RemoveItemInputSchema>) {
  const { folderId, mediaId } = RemoveItemInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const folder = await ownedFolder(tx, userId, folderId);
    const [removed] = await tx
      .delete(mediaFolderItems)
      .where(and(eq(mediaFolderItems.folderId, folderId), eq(mediaFolderItems.mediaId, mediaId)))
      .returning();
    if (!removed) return errors.notFound("Folder item");
    if (removed.isPrimary) await ensurePrimary(tx, folderId, removed.role as FolderRole);
    if (folder.coverMediaId === mediaId) {
      await tx.update(mediaFolders).set({ coverMediaId: null }).where(eq(mediaFolders.id, folderId));
    }
    await touch(tx, folderId);
  });
  await invalidate(userId, "media");
  return getFolder(userId, folderId);
}

export async function updateFolderItem(userId: string, input: z.input<typeof UpdateItemInputSchema>) {
  const data = UpdateItemInputSchema.parse(input);
  await db.transaction(async (tx) => {
    await ownedFolder(tx, userId, data.folderId);
    const links = await folderLinks(tx, data.folderId);
    const current = links.find((link) => link.mediaId === data.mediaId);
    if (!current) return errors.notFound("Folder item");

    const role = data.role ?? current.role;
    const label = data.label !== undefined ? data.label : current.label;
    const [row] = await loadMedia(tx, [data.mediaId]);
    assertRoleFits(role, row!.type, label);

    const where = and(eq(mediaFolderItems.folderId, data.folderId), eq(mediaFolderItems.mediaId, data.mediaId));
    if (role !== current.role) {
      const target = links.filter((link) => link.role === role);
      const position = target.length ? Math.max(...target.map((link) => link.position)) + 1 : 0;
      await tx.update(mediaFolderItems).set({ role, label, position, isPrimary: false }).where(where);
      await ensurePrimary(tx, data.folderId, current.role);
    } else if (data.label !== undefined) {
      await tx.update(mediaFolderItems).set({ label }).where(where);
    }

    if (data.isPrimary === true) {
      await tx
        .update(mediaFolderItems)
        .set({ isPrimary: false })
        .where(and(eq(mediaFolderItems.folderId, data.folderId), eq(mediaFolderItems.role, role)));
      await tx.update(mediaFolderItems).set({ isPrimary: true }).where(where);
    } else if (data.isPrimary === false) {
      await tx.update(mediaFolderItems).set({ isPrimary: false }).where(where);
    } else if (role !== current.role) {
      await ensurePrimary(tx, data.folderId, role);
    }

    if (data.position !== undefined) {
      const inRole = (await folderLinks(tx, data.folderId))
        .filter((link) => link.role === role)
        .map((link) => link.mediaId)
        .filter((id) => id !== data.mediaId);
      inRole.splice(Math.min(data.position, inRole.length), 0, data.mediaId);
      await renumber(tx, data.folderId, role, inRole);
    }
    await touch(tx, data.folderId);
  });
  await invalidate(userId, "media");
  return getFolder(userId, data.folderId);
}

/** Sets the order of one role. mediaIds must be exactly that role's items. */
export async function reorderFolderRole(userId: string, input: z.input<typeof ReorderInputSchema>) {
  const { folderId, role, mediaIds } = ReorderInputSchema.parse(input);
  await db.transaction(async (tx) => {
    await ownedFolder(tx, userId, folderId);
    const inRole = (await folderLinks(tx, folderId)).filter((link) => link.role === role);
    const same =
      inRole.length === mediaIds.length &&
      new Set(mediaIds).size === mediaIds.length &&
      inRole.every((link) => mediaIds.includes(link.mediaId));
    if (!same) return errors.badRequest(`mediaIds must list every ${role} item exactly once`);
    await renumber(tx, folderId, role, mediaIds);
    await touch(tx, folderId);
  });
  await invalidate(userId, "media");
  return getFolder(userId, folderId);
}

/** Creates the folder stored in a social-package JSON's metadata.folderSuggestion. */
export async function createFolderFromSuggestion(
  userId: string,
  input: z.input<typeof FromSuggestionInputSchema>,
) {
  const { jsonMediaId, name } = FromSuggestionInputSchema.parse(input);
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, jsonMediaId), eq(media.userId, UuidSchema.parse(userId))))
    .limit(1);
  const json = row ? MediaRowSchema.parse(row) : null;
  const suggestion = json?.metadata?.folderSuggestion;
  if (!json || json.type !== "json" || !suggestion) return errors.notFound("Folder suggestion");

  // Drop suggested media that were deleted since the suggestion was made.
  const present = new Set(
    (await loadMedia(db, suggestion.items.map((item) => item.mediaId)))
      .filter((item) => item.userId === userId)
      .map((item) => item.id),
  );
  return createFolder(userId, {
    name: name ?? suggestion.folderName,
    items: suggestion.items.filter((item) => present.has(item.mediaId)),
  });
}
