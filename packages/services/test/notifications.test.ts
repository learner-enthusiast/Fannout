import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, notifications, users } from "@repo/database";
import { AppError } from "@repo/errors";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { createNotification, listNotifications } from "../notifications";

let userId: string;

before(async () => {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `user_test_${randomUUID()}`, email: `notif-${randomUUID()}@example.com` })
    .returning({ id: users.id });
  userId = user!.id;
});

after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("cursor round-trips and rejects garbage", () => {
  const cursor = { createdAt: "2026-11-07T10:11:12.123456Z", id: randomUUID() };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.throws(() => decodeCursor("not-a-cursor"), AppError);
});

test("cursor pagination returns every row once, newest first, across timestamp ties", async () => {
  // 3 rows share each timestamp (incl. the same microsecond) to exercise the id tie-breaker.
  const base = Date.now() - 60_000;
  const values = Array.from({ length: 11 }, (_, i) => ({
    userId,
    type: "upload_succeeded",
    title: `n${i}`,
    body: "",
    dedupeKey: `test-${randomUUID()}`,
    createdAt: new Date(base + Math.floor(i / 3) * 1000),
  }));
  await db.insert(notifications).values(values);

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await listNotifications(userId, { limit: 4, cursor });
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);

  const all = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const expected = [...all]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((row) => row.id);

  assert.equal(new Set(seen).size, seen.length, "no duplicates");
  assert.deepEqual(seen, expected, "no skips, correct order");
  assert.equal(pages, 3);
});

test("dedupe_key prevents duplicate notifications", async () => {
  const key = `evt-${randomUUID()}`;
  const input = { userId, type: "upload_failed" as const, title: "Upload failed", body: "x" };

  const first = await createNotification(input, key);
  const second = await createNotification(input, key);
  assert.ok(first);
  assert.equal(second, null);

  const rows = await db.select().from(notifications).where(eq(notifications.dedupeKey, key));
  assert.equal(rows.length, 1);
});
