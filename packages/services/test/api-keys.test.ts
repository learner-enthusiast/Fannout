import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { apiKeys, db, eq, users } from "@repo/database";
import { createApiKey, generateApiKey, hashApiKey, revokeApiKey, verifyApiKey } from "../api-keys";

let userId: string;
before(async () => {
  const [user] = await db.insert(users).values({ clerkId: `user_test_${randomUUID()}`, email: `ak-${randomUUID()}@example.com` }).returning({ id: users.id });
  userId = user!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

test("key format + HMAC hash (pepper-dependent, deterministic)", () => {
  const key = generateApiKey();
  assert.match(key, /^fn_live_[0-9A-Za-z]{32}$/);
  assert.notEqual(generateApiKey(), key);
  assert.equal(hashApiKey(key, "p".repeat(32)), hashApiKey(key, "p".repeat(32)));
  assert.notEqual(hashApiKey(key, "p".repeat(32)), hashApiKey(key, "q".repeat(32)));
});

test("create → verify; only the hash is stored; revoked and expired keys are rejected", async () => {
  const created = await createApiKey(userId, { name: "ci", scopes: ["posts:read"] });
  assert.equal(created.prefix, created.key.slice(0, 12));
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
  assert.notEqual(row!.keyHash, created.key);
  assert.ok(!JSON.stringify(row).includes(created.key), "full key never stored");

  const principal = await verifyApiKey(created.key, "1.2.3.4");
  assert.deepEqual(principal, { apiKeyId: created.id, userId, scopes: ["posts:read"], tier: "free" });
  assert.equal(await verifyApiKey(`${created.key.slice(0, -1)}X`), null, "wrong key");
  assert.equal(await verifyApiKey("not-a-key"), null, "bad format");

  await revokeApiKey(userId, created.id);
  assert.equal(await verifyApiKey(created.key), null, "revoked");

  const expiring = await createApiKey(userId, { name: "short", scopes: ["posts:read"], expiresInDays: 30 });
  assert.ok(await verifyApiKey(expiring.key));
  assert.equal(await verifyApiKey(expiring.key, null, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)), null, "expired");
});
