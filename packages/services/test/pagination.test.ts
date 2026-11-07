import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, media, mediaFolderItems, mediaFolders, users } from "@repo/database";
import { decodeKeyCursor, encodeKeyCursor, PaginationInputSchema } from "../common/pagination";
import { listFolderItems } from "../media-folders";
import { MediaListInputSchema } from "../media/model";
import { listMediaPage } from "../media/views";
import { ListNotificationsInputSchema } from "../notifications/model";

let userId: string;
const ids: string[] = [];
before(async () => {
  const [user] = await db.insert(users).values({ clerkId: `user_test_${randomUUID()}`, email: `pg-${randomUUID()}@example.com` }).returning({ id: users.id });
  userId = user!.id;
  const sameTime = new Date(Date.now() - 60_000);
  const rows = await db
    .insert(media)
    .values(
      Array.from({ length: 25 }, (_, i) => ({
        userId,
        name: `item-${String(i).padStart(2, "0")}`,
        type: "image",
        status: "ready",
        mimeType: "image/png",
        s3Bucket: "b",
        s3Key: `test/${randomUUID()}`,
        s3Region: "r",
        createdAt: sameTime, // every row has the SAME timestamp → id is the tie-breaker
      })),
    )
    .returning({ id: media.id });
  ids.push(...rows.map((r) => r.id));
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("limit defaults to 10 and > 10 is rejected (every list input)", () => {
  assert.equal(PaginationInputSchema.parse({}).limit, 10);
  for (const schema of [PaginationInputSchema, MediaListInputSchema, ListNotificationsInputSchema]) {
    assert.equal(schema.safeParse({ limit: 11 }).success, false);
    assert.equal(schema.safeParse({ limit: 10 }).success, true);
  }
});

test("key cursor round-trips", () => {
  const id = randomUUID();
  assert.deepEqual(decodeKeyCursor(encodeKeyCursor("3:7", id)), { sortKey: "3:7", id });
  assert.throws(() => decodeKeyCursor("garbage"));
});

test("25 rows with equal timestamps → 3 pages of ≤10, no duplicates or skips", async () => {
  const seen: string[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  do {
    const page = await listMediaPage(userId, { cursor });
    sizes.push(page.items.length);
    seen.push(...page.items.map((m) => m.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(sizes, [10, 10, 5]);
  assert.equal(new Set(seen).size, 25, "no duplicates");
  assert.deepEqual([...seen].sort(), [...ids].sort(), "no skips");
  assert.deepEqual(seen, [...ids].sort().reverse(), "same timestamp → id DESC");
});

test("folder items page by role → position, 10 at a time", async () => {
  const [folder] = await db.insert(mediaFolders).values({ userId, name: `f-${randomUUID()}` }).returning({ id: mediaFolders.id });
  await db.insert(mediaFolderItems).values(ids.slice(0, 13).map((mediaId, position) => ({ folderId: folder!.id, mediaId, role: "thumbnail", position, isPrimary: position === 0 })));
  const first = await listFolderItems(userId, { folderId: folder!.id });
  const second = await listFolderItems(userId, { folderId: folder!.id, cursor: first.nextCursor });
  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map((i) => i.position), [...Array(13).keys()]);
});
