import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HttpClient } from "../common/http-client";
import { createRangeReader, readChunks } from "../common/media";
import { appSecretProof, parseGraphError, toGraphForm, toGraphPage } from "../common/meta-graph";
import { collectAll, nextOffsetCursor, paginate } from "../common/pagination";
import { ProviderError } from "../common/provider-error";
import { computeRetryDelayMs, parseRateLimitHeaders } from "../common/rate-limit";
import { TokenManager } from "../common/token-manager";
import { json, mockFetch, noSleep } from "./helpers";

const client = (m: ReturnType<typeof mockFetch>, tokens = new TokenManager("t")) =>
  new HttpClient({ provider: "LINKEDIN", baseUrl: "https://api.example.com/v1", tokens, fetch: m.fetch, sleep: noSleep });

async function* parts(...p: number[][]) {
  for (const x of p) yield new Uint8Array(x);
}

describe("HttpClient", () => {
  test("joins base URL, encodes query arrays and sends bearer auth", async () => {
    const m = mockFetch(json({ ok: 1 }));
    await client(m).send({ method: "GET", url: "/items", query: { ids: ["a", "b"], skip: undefined, n: 2 } });
    const call = m.calls[0]!;
    assert.equal(call.url.toString(), "https://api.example.com/v1/items?ids=a%2Cb&n=2");
    assert.equal(call.headers.get("authorization"), "Bearer t");
  });

  test("retries 5xx on idempotent methods only, and 429 on any method", async () => {
    const m = mockFetch(json({}, 503), json({ ok: 1 }), json({}, 503), json({}, 429), json({ ok: 2 }));
    const c = client(m);
    await c.send({ method: "GET", url: "a" });
    await assert.rejects(c.send({ method: "POST", url: "b" }), (e: unknown) => e instanceof ProviderError && e.status === 503);
    await c.send({ method: "POST", url: "c" });
    assert.equal(m.calls.length, 5);
  });

  test("gives up after maxRetries and reports RATE_LIMITED", async () => {
    const m = mockFetch(json({}, 429), json({}, 429), json({}, 429));
    await assert.rejects(client(m).send({ method: "GET", url: "x" }), (e: unknown) => e instanceof ProviderError && e.code === "RATE_LIMITED" && e.retryable);
    assert.equal(m.calls.length, 3);
  });

  test("401 refreshes once, then uses the refreshed token", async () => {
    const m = mockFetch(json({}, 401), json({ ok: 1 }), json({ ok: 2 }));
    let refreshes = 0;
    const tokens = new TokenManager({ getAccessToken: async () => "old", refreshAccessToken: async () => (refreshes++, "new") });
    const c = client(m, tokens);
    await c.send({ method: "POST", url: "x" });
    await c.send({ method: "GET", url: "y" });
    assert.equal(refreshes, 1);
    assert.deepEqual(m.calls.map((c) => c.headers.get("authorization")), ["Bearer old", "Bearer new", "Bearer new"]);
  });

  test("401 without refresh support fails as UNAUTHORIZED", async () => {
    const m = mockFetch(json({}, 401));
    await assert.rejects(client(m).send({ method: "GET", url: "x" }), (e: unknown) => e instanceof ProviderError && e.code === "UNAUTHORIZED");
  });

  test("network errors become NETWORK errors without leaking the URL", async () => {
    const c = new HttpClient({
      provider: "X",
      baseUrl: "https://api.example.com",
      tokens: new TokenManager("secret-token"),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      retry: { maxRetries: 0 },
    });
    await assert.rejects(c.send({ method: "GET", url: "x", query: { access_token: "secret-token" } }), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.code, "NETWORK");
      assert.ok(!e.message.includes("secret-token"));
      return true;
    });
  });

  test("json() validates the response body", async () => {
    const { z } = await import("zod");
    const m = mockFetch(json({ id: 1 }));
    await assert.rejects(client(m).json({ method: "GET", url: "x" }, z.object({ id: z.string() })), (e: unknown) => e instanceof ProviderError && e.code === "INVALID_RESPONSE");
  });
});

describe("rate limits", () => {
  test("parses X, Retry-After and Meta usage headers", () => {
    const now = Date.UTC(2026, 0, 1);
    const info = parseRateLimitHeaders(
      new Headers({
        "x-rate-limit-limit": "300",
        "x-rate-limit-remaining": "0",
        "x-rate-limit-reset": String(now / 1000 + 60),
        "retry-after": "5",
        "x-app-usage": '{"call_count":10}',
      }),
      now,
    );
    assert.equal(info.limit, 300);
    assert.equal(info.remaining, 0);
    assert.equal(info.retryAfterMs, 5000);
    assert.deepEqual((info.usage as { app: unknown }).app, { call_count: 10 });
  });

  test("retry delay honours Retry-After and caps at maxDelayMs", () => {
    const retry = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000 };
    assert.equal(computeRetryDelayMs(0, { limit: null, remaining: null, resetAt: null, retryAfterMs: 700, usage: null }, retry), 700);
    assert.ok(computeRetryDelayMs(10, null, retry) <= 1000);
  });
});

describe("pagination", () => {
  test("paginate follows cursors and stops on repeats / limits", async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
      start: { items: [1, 2], nextCursor: "b" },
      b: { items: [3], nextCursor: "b" },
    };
    assert.deepEqual(await collectAll(paginate(async (c) => pages[c ?? "start"]!)), [1, 2, 3]);
    assert.deepEqual(await collectAll(paginate(async (c) => pages[c ?? "start"]!, { maxItems: 1 })), [1]);
  });

  test("offset cursors", () => {
    assert.equal(nextOffsetCursor(0, 10, 10), "10");
    assert.equal(nextOffsetCursor(0, 10, 4), null);
    assert.equal(nextOffsetCursor(10, 10, 10, 20), null);
  });

  test("Graph paging maps to cursors only when next/previous exist", () => {
    assert.deepEqual(toGraphPage({ data: [1], paging: { cursors: { before: "B", after: "A" }, next: "n" } }), { items: [1], nextCursor: "A", previousCursor: null });
  });
});

describe("media", () => {
  test("readChunks yields fixed-size chunks from a stream", async () => {
    const out = [];
    for await (const c of readChunks({ type: "stream", stream: parts([1, 2, 3], [4, 5]), size: 5, mimeType: "x" }, 2)) out.push([...c.data]);
    assert.deepEqual(out, [[1, 2], [3, 4], [5]]);
  });

  test("range reader serves sequential arbitrary ranges", async () => {
    const r = createRangeReader({ type: "stream", stream: parts([1, 2], [3, 4, 5], [6]), size: 6, mimeType: "x" });
    assert.deepEqual([...(await r.read(0, 3))], [1, 2, 3]);
    assert.deepEqual([...(await r.read(3, 6))], [4, 5, 6]);
    await assert.rejects(r.read(0, 1), /forward/);
  });
});

describe("meta graph helpers", () => {
  test("form encoding, errors and appsecret_proof", () => {
    assert.deepEqual(toGraphForm({ a: ["1", "2"], b: { x: 1 }, c: [{ y: 1 }], d: undefined, e: false }), {
      a: "1,2",
      b: '{"x":1}',
      c: '[{"y":1}]',
      e: false,
    });
    assert.deepEqual(parseGraphError(400, { error: { message: "m", code: 190, error_subcode: 463 } }), { message: "m", providerCode: "190:463" });
    assert.equal(appSecretProof("tok", "sec").length, 64);
  });
});
