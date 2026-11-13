import {
  and,
  asc,
  db,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  mentionContacts,
  or,
  socialConnections,
  sql,
} from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { decodeKeyCursor, toKeyPage } from "../common/pagination";
import {
  CreateMentionInputSchema,
  MentionContactPageSchema,
  MentionContactViewSchema,
  MentionPlatformSchema,
  SearchMentionsInputSchema,
  UpdateMentionInputSchema,
  type CreateMentionInput,
  type MentionContactView,
  type MentionPlatform,
} from "./model";

const view = (row: typeof mentionContacts.$inferSelect): MentionContactView => MentionContactViewSchema.parse(row);

/** Materialize the user's own accounts once; onConflict makes repeat searches cheap and safe. */
async function seedOwnAccounts(userId: string) {
  const rows = await db
    .select({
      provider: socialConnections.provider,
      providerAccountId: socialConnections.providerAccountId,
      username: socialConnections.username,
      displayName: socialConnections.displayName,
      avatarUrl: socialConnections.profilePictureUrl,
    })
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, userId), eq(socialConnections.isActive, true)));
  const values = rows.flatMap((row) => {
    const parsed = MentionPlatformSchema.safeParse(row.provider.toLowerCase());
    if (!parsed.success) return [];
    const platform = parsed.data;
    const username = row.username?.replace(/^@/, "");
    const handle = (platform === "x" || platform === "threads" || platform === "instagram") && username && /^[A-Za-z0-9_.]+$/.test(username) ? username : null;
    const platformRef = platform === "linkedin"
      ? `urn:li:person:${row.providerAccountId}`
      : platform === "facebook" && /^\d+$/.test(row.providerAccountId)
        ? row.providerAccountId
        : null;
    if (!handle && !platformRef) return [];
    return [{
      userId,
      platform,
      displayName: row.displayName ?? row.username ?? row.provider,
      handle,
      platformRef,
      avatarUrl: row.avatarUrl,
    }];
  });
  if (values.length) await db.insert(mentionContacts).values(values).onConflictDoNothing();
}

/** Group "mentions". Seeding the user's own accounts happens on a miss only; connection changes bump this group. */
export async function searchMentionContacts(userId: string, input: unknown) {
  const { platform, q, cursor, limit } = SearchMentionsInputSchema.parse(input);
  return cached({
    userId,
    group: "mentions",
    key: "searchMentionContacts",
    input: { platform, q, cursor: cursor ?? null, limit },
    schema: MentionContactPageSchema,
    load: async () => {
      await seedOwnAccounts(userId);
      return loadMentionContacts(userId, { platform, q, cursor, limit });
    },
  });
}

async function loadMentionContacts(
  userId: string,
  { platform, q, cursor, limit }: { platform: MentionPlatform; q: string; cursor?: string | null; limit: number },
) {
  const after = cursor ? decodeKeyCursor(cursor) : null;
  const afterCount = after ? z.coerce.number().int().nonnegative().parse(after.sortKey) : null;
  const pattern = `%${q}%`;
  const rows = await db
    .select()
    .from(mentionContacts)
    .where(and(
      eq(mentionContacts.userId, userId),
      eq(mentionContacts.platform, platform),
      q ? sql`(${mentionContacts.displayName} || ' ' || coalesce(${mentionContacts.handle}, '')) ilike ${pattern}` : undefined,
      after && afterCount !== null ? or(
        lt(mentionContacts.useCount, afterCount),
        and(eq(mentionContacts.useCount, afterCount), gt(mentionContacts.id, after.id)),
      ) : undefined,
    ))
    .orderBy(desc(mentionContacts.useCount), asc(mentionContacts.id))
    .limit(limit + 1);
  const page = toKeyPage(rows, limit, (row) => ({ sortKey: String(row.useCount), id: row.id }));
  return { items: page.items.map(view), nextCursor: page.nextCursor };
}

async function findByTarget(userId: string, platform: MentionPlatform, target: string) {
  const [row] = await db.select().from(mentionContacts).where(and(
    eq(mentionContacts.userId, userId),
    eq(mentionContacts.platform, platform),
    sql`coalesce(${mentionContacts.handle}, ${mentionContacts.platformRef}) = ${target}`,
  )).limit(1);
  return row;
}

export async function createMentionContact(userId: string, input: CreateMentionInput) {
  const data = CreateMentionInputSchema.parse(input);
  const values = { ...data, userId, handle: data.handle ?? null, platformRef: data.platformRef ?? null, avatarUrl: data.avatarUrl ?? null };
  const [inserted] = await db.insert(mentionContacts).values(values).onConflictDoNothing().returning();
  if (inserted) {
    await invalidate(userId, "mentions");
    return view(inserted);
  }
  const existing = await findByTarget(userId, data.platform, data.handle ?? data.platformRef!);
  if (existing) return view(existing);
  return errors.conflict("This mention contact already exists");
}

export async function updateMentionContact(userId: string, input: unknown) {
  const { id, ...patch } = UpdateMentionInputSchema.parse(input);
  const [current] = await db.select().from(mentionContacts).where(and(eq(mentionContacts.id, id), eq(mentionContacts.userId, userId))).limit(1);
  if (!current) return errors.notFound("Mention contact");
  const merged = CreateMentionInputSchema.parse({
    platform: current.platform,
    displayName: patch.displayName ?? current.displayName,
    handle: patch.handle === undefined ? current.handle ?? undefined : patch.handle ?? undefined,
    platformRef: patch.platformRef === undefined ? current.platformRef ?? undefined : patch.platformRef ?? undefined,
    avatarUrl: patch.avatarUrl === undefined ? current.avatarUrl ?? undefined : patch.avatarUrl ?? undefined,
  });
  const [row] = await db.update(mentionContacts).set({
    displayName: merged.displayName,
    handle: merged.handle ?? null,
    platformRef: merged.platformRef ?? null,
    avatarUrl: merged.avatarUrl ?? null,
  }).where(and(eq(mentionContacts.id, id), eq(mentionContacts.userId, userId))).returning();
  await invalidate(userId, "mentions");
  return view(row!);
}

export async function deleteMentionContact(userId: string, id: string) {
  const rows = await db.delete(mentionContacts).where(and(eq(mentionContacts.id, z.uuid().parse(id)), eq(mentionContacts.userId, userId))).returning({ id: mentionContacts.id });
  if (rows.length) await invalidate(userId, "mentions");
  return { updated: rows.length > 0 };
}

/** Called only after a platform accepts a post. Text matches handles/Page names; LinkedIn uses its exact ranges. */
export async function recordMentionsUsed(userId: string, platform: string, input: Record<string, unknown>) {
  const parsed = MentionPlatformSchema.safeParse(platform);
  if (!parsed.success) return;
  const ids = new Set<string>();
  if (parsed.data === "linkedin") {
    const ranges = z.array(z.object({ contactId: z.uuid() })).catch([]).parse(input.mentions ?? []);
    for (const range of ranges) ids.add(range.contactId);
  } else {
    const rows = await db.select({ id: mentionContacts.id, displayName: mentionContacts.displayName, handle: mentionContacts.handle, platformRef: mentionContacts.platformRef })
      .from(mentionContacts)
      .where(and(eq(mentionContacts.userId, userId), eq(mentionContacts.platform, parsed.data)));
    const text = Object.values(input).filter((value): value is string => typeof value === "string").join("\n");
    for (const row of rows) {
      const token = row.handle
        ? `@${row.handle}`
        : parsed.data === "facebook" && row.platformRef
          ? `@${row.displayName}(${row.platformRef})`
          : `@${row.displayName}`;
      if (text.includes(token)) ids.add(row.id);
    }
  }
  if (!ids.size) return;
  await db.update(mentionContacts).set({ useCount: sql`${mentionContacts.useCount} + 1`, lastUsedAt: new Date() })
    .where(and(eq(mentionContacts.userId, userId), inArray(mentionContacts.id, [...ids])));
  await invalidate(userId, "mentions");
}

