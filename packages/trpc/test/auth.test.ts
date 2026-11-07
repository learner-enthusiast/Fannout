import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, users } from "@repo/database";
import { setRateLimitRedisForTests } from "@repo/services/rate-limit/rate-limiter";
import { TRPCError } from "@trpc/server";
import { serverRouter } from "../server";

let userId: string;
before(async () => {
  setRateLimitRedisForTests(null);
  const [user] = await db.insert(users).values({ clerkId: `user_test_${randomUUID()}`, email: `auth-${randomUUID()}@example.com` }).returning({ id: users.id });
  userId = user!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

function apiKeyCaller(scopes: string[]) {
  const headers: Record<string, string> = {};
  const caller = serverRouter.createCaller({
    userId: null,
    apiKey: { apiKeyId: randomUUID(), userId, scopes: scopes as never, tier: "free" },
    apiKeyError: null,
    ip: "127.0.0.1",
    res: { set: (h: Record<string, string>) => Object.assign(headers, h) } as never,
  });
  return { caller, headers };
}

test("API key with the scope passes and gets X-RateLimit headers", async () => {
  const { caller, headers } = apiKeyCaller(["posts:read"]);
  const page = await caller.posts.batches({ limit: 5 });
  assert.deepEqual(page.items, []);
  assert.equal(headers["X-RateLimit-Limit"], "60");
});

test("missing scope → FORBIDDEN 'missing scope X'", async () => {
  const { caller } = apiKeyCaller(["posts:read"]);
  await assert.rejects(
    caller.media.list({ limit: 5 }),
    (e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN" && e.message === "missing scope media:read",
  );
});

test("sessionOnly procedures reject API keys (even with every scope)", async () => {
  const { caller } = apiKeyCaller(["posts:read", "posts:write", "posts:delete", "media:read", "media:write", "connections:read", "ai:generate"]);
  await assert.rejects(caller.apiKeys.list(), (e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  await assert.rejects(caller.socialConnections.disconnect({ id: randomUUID() }), (e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
});

test("invalid key → UNAUTHORIZED", async () => {
  const caller = serverRouter.createCaller({ userId: null, apiKey: null, apiKeyError: "invalid", ip: "127.0.0.1", res: { set() {} } as never });
  await assert.rejects(caller.posts.batches({}), (e: unknown) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
});
