import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { z } from "zod";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGet,
  cacheKey,
  cacheSet,
  cached,
  closeRedis,
  getRedis,
} from "..";

// Needs Redis at REDIS_URL.
const ns = cacheKey("test", randomUUID());
after(async () => {
  await cacheDeleteByPrefix(ns);
  await closeRedis();
});

test("set/get round-trips JSON with a TTL", async () => {
  const key = `${ns}:a`;
  await cacheSet(key, { n: 1, list: ["x"] }, 30);
  assert.deepEqual(await cacheGet(key), { n: 1, list: ["x"] });
  const ttl = await getRedis().ttl(key);
  assert.ok(ttl > 0 && ttl <= 30);
  assert.equal(await cacheDelete(key), 1);
  assert.equal(await cacheGet(key), null);
});

test("schema mismatch is treated as a miss and evicted", async () => {
  const key = `${ns}:b`;
  await cacheSet(key, { n: "not-a-number" }, 30);
  assert.equal(await cacheGet(key, { schema: z.object({ n: z.number() }) }), null);
  assert.equal(await getRedis().exists(key), 0);
});

test("cached() loads once for concurrent misses, then serves hits", async () => {
  const key = `${ns}:c`;
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { value: 42 };
  };
  const results = await Promise.all([
    cached(key, 30, loader),
    cached(key, 30, loader),
    cached(key, 30, loader),
  ]);
  assert.deepEqual(results, [{ value: 42 }, { value: 42 }, { value: 42 }]);
  assert.equal(await cached(key, 30, loader).then((r) => r.value), 42);
  assert.equal(calls, 1);
});

test("cacheDeleteByPrefix removes only matching keys", async () => {
  await cacheSet(`${ns}:p:1`, 1, 30);
  await cacheSet(`${ns}:p:2`, 2, 30);
  await cacheSet(`${ns}:q:1`, 3, 30);
  assert.equal(await cacheDeleteByPrefix(`${ns}:p:`), 2);
  assert.equal(await cacheGet(`${ns}:q:1`), 3);
});
