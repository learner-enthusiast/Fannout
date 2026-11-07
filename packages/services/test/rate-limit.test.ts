import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createRedisConnection } from "@repo/redis";
import { consume, isAuthBlocked, penalizeAuthFail, rateLimitHeaders, setRateLimitRedisForTests } from "../rate-limit/rate-limiter";

test("61st API request in 60 s → rejected with Retry-After + X-RateLimit-* headers", async () => {
  setRateLimitRedisForTests(null);
  const key = `k:${randomUUID()}`;
  for (let i = 0; i < 60; i++) assert.equal((await consume("api", key)).allowed, true, `request ${i + 1}`);
  const blocked = await consume("api", key);
  assert.equal(blocked.allowed, false);
  const headers = rateLimitHeaders(blocked);
  assert.equal(headers["X-RateLimit-Limit"], "60");
  assert.equal(headers["X-RateLimit-Remaining"], "0");
  assert.ok(Number(headers["Retry-After"]) >= 1);
  assert.ok(Number(headers["X-RateLimit-Reset"]) > Date.now() / 1000);
  assert.equal(rateLimitHeaders(await consume("api", `k:${randomUUID()}`))["Retry-After"], undefined, "no Retry-After when allowed");
});

test("browser sessions get 3× the points", async () => {
  setRateLimitRedisForTests(null);
  const first = await consume("publish", `u:${randomUUID()}`, { session: true });
  assert.equal(first.limit, 30);
});

test("Redis down → the in-memory insurance limiter still limits", async () => {
  const dead = createRedisConnection("rate-limit-test", { port: 1, enableOfflineQueue: false, maxRetriesPerRequest: 0, lazyConnect: true, retryStrategy: () => null });
  dead.on("error", () => undefined);
  setRateLimitRedisForTests(dead);
  const key = `k:${randomUUID()}`;
  for (let i = 0; i < 60; i++) assert.equal((await consume("api", key)).allowed, true);
  assert.equal((await consume("api", key)).allowed, false);
  dead.disconnect();
  setRateLimitRedisForTests(null);
});

test("10 bad keys from one IP → blocked for 15 minutes", async () => {
  setRateLimitRedisForTests(null);
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  for (let i = 0; i < 9; i++) await penalizeAuthFail(ip);
  assert.equal(await isAuthBlocked(ip), false);
  await penalizeAuthFail(ip);
  assert.equal(await isAuthBlocked(ip), true);
  const next = await penalizeAuthFail(ip);
  assert.equal(next.allowed, false);
  assert.ok(next.resetMs > 14 * 60 * 1000, "blockDuration 15 min");
});
