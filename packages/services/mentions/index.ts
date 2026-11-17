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
import { logger } from "@repo/logger";
import { InstagramProvider, XProvider } from "@repo/providers";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { decodeKeyCursor, toKeyPage } from "../common/pagination";
import { createProviderForConnection } from "../provider-factory";
import {
  CreateMentionInputSchema,
  INSTAGRAM_HANDLE_PATTERN,
  InstagramUserLookupSchema,
  LookupInstagramUserInputSchema,
  MentionContactPageSchema,
  MentionContactViewSchema,
  MentionPlatformSchema,
  ResolveXUserInputSchema,
  ResolvedXUserSchema,
  SearchMentionsInputSchema,
  UpdateMentionInputSchema,
  type CreateMentionInput,
  type InstagramUserLookup,
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

/** `foo_` must match a literal underscore, not "any character". */
const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Sort key: use count, then last use (ms; -1 = never). Encoded together in the key cursor. */
const lastUsedMs = sql<number>`coalesce(floor(extract(epoch from ${mentionContacts.lastUsedAt}) * 1000), -1)::bigint`;
const SortKeySchema = z.string().regex(/^\d+:-?\d+$/).transform((value) => {
  const [count, last] = value.split(":");
  return { count: Number(count), last: Number(last) };
});

/**
 * Prefix match on handle or display name (any word of it), ordered by use count, then most recent use,
 * then id. Empty query = the most used/recent contacts. Pages of `limit` (max 10 per the API rules).
 */
async function loadMentionContacts(
  userId: string,
  { platform, q, cursor, limit }: { platform: MentionPlatform; q: string; cursor?: string | null; limit: number },
) {
  const after = cursor ? decodeKeyCursor(cursor) : null;
  const key = after ? SortKeySchema.parse(after.sortKey) : null;
  const prefix = likePrefix(q);
  const rows = await db
    .select({ row: mentionContacts, last: lastUsedMs })
    .from(mentionContacts)
    .where(and(
      eq(mentionContacts.userId, userId),
      eq(mentionContacts.platform, platform),
      q
        ? sql`(coalesce(${mentionContacts.handle}, '') ilike ${prefix} or ${mentionContacts.displayName} ilike ${prefix} or ${mentionContacts.displayName} ilike ${`% ${prefix}`})`
        : undefined,
      after && key
        ? or(
          lt(mentionContacts.useCount, key.count),
          and(eq(mentionContacts.useCount, key.count), sql`${lastUsedMs} < ${key.last}`),
          and(eq(mentionContacts.useCount, key.count), sql`${lastUsedMs} = ${key.last}`, gt(mentionContacts.id, after.id)),
        )
        : undefined,
    ))
    .orderBy(desc(mentionContacts.useCount), desc(lastUsedMs), asc(mentionContacts.id))
    .limit(limit + 1);
  const page = toKeyPage(rows, limit, ({ row, last }) => ({ sortKey: `${row.useCount}:${Number(last)}`, id: row.id }));
  return { items: page.items.map(({ row }) => view(row)), nextCursor: page.nextCursor };
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


// ---------------------------------------------------------------------------
// Media tags (separate from @mentions in the text)
// ---------------------------------------------------------------------------

/**
 * X tags need a numeric user id. GET /2/users/by/username/{username} is a BILLED read, so it runs
 * only when the contact has no saved id; the id is then kept on the contact (platform_ref) and the
 * answer is cached in the `mentions` group. A username is never looked up twice.
 */
export async function resolveXUser(userId: string, input: unknown) {
  const { socialConnectionId, username } = ResolveXUserInputSchema.parse(input);
  return cached({
    userId,
    group: "mentions",
    key: "resolveXUser",
    input: { username: username.toLowerCase() },
    schema: ResolvedXUserSchema,
    load: async () => {
      const [contact] = await db
        .select()
        .from(mentionContacts)
        .where(and(eq(mentionContacts.userId, userId), eq(mentionContacts.platform, "x"), sql`lower(${mentionContacts.handle}) = ${username.toLowerCase()}`))
        .limit(1);
      if (contact?.handle && contact.platformRef && /^\d{1,19}$/.test(contact.platformRef)) {
        return { username: contact.handle, xUserId: contact.platformRef, displayName: contact.displayName };
      }

      const provider = await createProviderForConnection({ userId, connectionId: socialConnectionId });
      if (!(provider instanceof XProvider)) return errors.badRequest("Not an X account");
      logger.info("X user lookup (billed)", { userId, socialConnectionId });
      const result = await provider.getUserByUsername({ username });
      const user = result.data;
      if (!user?.id) return errors.notFound(`X user @${username}`);

      const handle = user.username ?? username;
      const displayName = user.name ?? handle;
      if (contact) {
        await db.update(mentionContacts).set({ platformRef: user.id, handle }).where(eq(mentionContacts.id, contact.id));
      } else {
        await db.insert(mentionContacts).values({ userId, platform: "x", displayName, handle, platformRef: user.id }).onConflictDoNothing();
      }
      await invalidate(userId, "mentions");
      return { username: handle, xUserId: user.id, displayName };
    },
  });
}

/** After a platform accepts a post: remember tagged usernames (new ones become contacts) and count the use. */
export async function saveTagContacts(userId: string, platform: string, usernames: string[]) {
  const parsed = MentionPlatformSchema.safeParse(platform);
  const handles = [...new Set(usernames.map((u) => u.replace(/^@/, "")).filter((u) => /^[A-Za-z0-9_.]+$/.test(u)))];
  if (!parsed.success || handles.length === 0) return;
  await db
    .insert(mentionContacts)
    .values(handles.map((handle) => ({ userId, platform: parsed.data, displayName: handle, handle })))
    .onConflictDoNothing();
  await db
    .update(mentionContacts)
    .set({ useCount: sql`${mentionContacts.useCount} + 1`, lastUsedAt: new Date() })
    .where(and(eq(mentionContacts.userId, userId), eq(mentionContacts.platform, parsed.data), inArray(mentionContacts.handle, handles)));
  await invalidate(userId, "mentions");
}

// ---------------------------------------------------------------------------
// Instagram: contacts filled from published posts + exact-username lookup
// ---------------------------------------------------------------------------

/** @handles in a caption (an email's "a@b" is not one); trailing periods are punctuation. */
export function instagramHandlesInText(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(?:^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{1,30})/g)) {
    const handle = match[1]!.replace(/\.+$/, "");
    if (INSTAGRAM_HANDLE_PATTERN.test(handle)) out.push(handle);
  }
  return out;
}

const InstagramUsageSchema = z.object({
  tags: z.array(z.object({ username: z.string() })).catch([]),
  collaborators: z.array(z.string()).catch([]),
  caption: z.string().catch(""),
});

/** Every username a post used: tagged people, collaborators and @mentions in the caption (lowercase, unique). */
export function instagramHandlesOfPost(usage: { tags?: unknown; collaborators?: unknown; caption?: unknown }): string[] {
  const { tags, collaborators, caption } = InstagramUsageSchema.parse(usage);
  const all = [...tags.map((t) => t.username), ...collaborators, ...instagramHandlesInText(caption)];
  return [...new Set(all.map((h) => h.replace(/^@/, "").toLowerCase()).filter((h) => INSTAGRAM_HANDLE_PATTERN.test(h)))];
}

/**
 * Upserts Instagram contacts (matched case-insensitively) and records their use.
 * increment: +1 each (after a publish). atLeast: use_count = greatest(current, given) and
 * last_used_at = greatest (backfill; running it twice changes nothing).
 */
export async function upsertInstagramContacts(
  userId: string,
  usage: Map<string, { count: number; lastUsedAt: Date | null }>,
  mode: "increment" | "atLeast",
): Promise<number> {
  const handles = [...usage.keys()].filter((h) => INSTAGRAM_HANDLE_PATTERN.test(h));
  if (!handles.length) return 0;
  const existing = await db
    .select({ id: mentionContacts.id, handle: mentionContacts.handle })
    .from(mentionContacts)
    .where(and(eq(mentionContacts.userId, userId), eq(mentionContacts.platform, "instagram"), inArray(sql`lower(${mentionContacts.handle})`, handles)));
  const known = new Map(existing.map((row) => [row.handle!.toLowerCase(), row.id]));
  const missing = handles.filter((h) => !known.has(h));
  if (missing.length) {
    const inserted = await db
      .insert(mentionContacts)
      .values(missing.map((handle) => ({ userId, platform: "instagram", displayName: handle, handle })))
      .onConflictDoNothing()
      .returning({ id: mentionContacts.id, handle: mentionContacts.handle });
    for (const row of inserted) known.set(row.handle!.toLowerCase(), row.id);
  }
  for (const handle of handles) {
    const id = known.get(handle);
    const use = usage.get(handle)!;
    if (!id) continue;
    await db
      .update(mentionContacts)
      .set(
        mode === "increment"
          ? { useCount: sql`${mentionContacts.useCount} + ${use.count}`, lastUsedAt: use.lastUsedAt ?? new Date() }
          : {
            useCount: sql`greatest(${mentionContacts.useCount}, ${use.count})`,
            lastUsedAt: use.lastUsedAt ? sql`greatest(${mentionContacts.lastUsedAt}, ${use.lastUsedAt.toISOString()}::timestamptz)` : sql`${mentionContacts.lastUsedAt}`,
          },
      )
      .where(and(eq(mentionContacts.id, id), eq(mentionContacts.userId, userId)));
  }
  await invalidate(userId, "mentions");
  return handles.length;
}

/** After Instagram accepts a post: every tag, collaborator and caption @mention becomes a contact (+1 use). */
export async function recordInstagramContacts(userId: string, usage: { tags?: unknown; collaborators?: unknown; caption?: unknown }) {
  const now = new Date();
  const handles = instagramHandlesOfPost(usage);
  await upsertInstagramContacts(userId, new Map(handles.map((h) => [h, { count: 1, lastUsedAt: now }])), "increment");
}

const LOOKUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * Exact-username lookup through Business Discovery on the user's own IG account (best effort).
 * Finds Business/Creator accounts only; any error (personal account, permission not granted,
 * rate limit) is a miss. Hits and misses are cached 24 h per connection (not in the `mentions`
 * group, which every publish bumps). Never called per keystroke: the composer debounces it.
 */
export async function lookupInstagramUser(userId: string, input: unknown): Promise<InstagramUserLookup> {
  const { socialConnectionId, username } = LookupInstagramUserInputSchema.parse(input);
  const miss: InstagramUserLookup = { found: false, username, displayName: null, avatarUrl: null };
  return cached({
    userId,
    group: `platform:${socialConnectionId}`,
    key: "lookupInstagramUser",
    input: { username },
    ttlSeconds: LOOKUP_TTL_SECONDS,
    schema: InstagramUserLookupSchema,
    load: async () => {
      const provider = await createProviderForConnection({ userId, connectionId: socialConnectionId });
      if (!(provider instanceof InstagramProvider)) return errors.badRequest("Not an Instagram account");
      try {
        const profile = await provider.getBusinessDiscovery(username);
        if (!profile?.username) return miss;
        return { found: true, username: profile.username, displayName: profile.name ?? null, avatarUrl: profile.profile_picture_url ?? null };
      } catch (error) {
        logger.debug("Instagram business discovery miss", { userId, error: error instanceof Error ? error.message : String(error) });
        return miss;
      }
    },
  });
}
