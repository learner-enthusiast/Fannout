import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as root from "../index";
import { LinkedInProvider } from "../linkedin";
import { ProviderError } from "../common/provider-error";
import { XProvider } from "../x";
import { YouTubeProvider } from "../youtube";
import { YouTubeAnalyticsProvider } from "../youtube-analytics";
import { json, mockFetch, noSleep } from "./helpers";

describe("root exports", () => {
  test("exports all five providers plus namespaces", () => {
    for (const name of ["LinkedInProvider", "XProvider", "YouTubeProvider", "ThreadsProvider", "FacebookProvider", "YouTubeAnalyticsProvider"]) {
      assert.equal(typeof (root as Record<string, unknown>)[name], "function", name);
    }
    assert.ok(root.threads.CreateContainerInputSchema);
    assert.ok(root.facebook.CreatePostInputSchema);
    assert.ok(root.linkedin.CreatePostInputSchema);
  });
});

describe("LinkedInProvider", () => {
  test("sends version headers, reads userinfo and returns created ids", async () => {
    const m = mockFetch(
      json({ sub: "abc", name: "Ann", picture: "https://p" }),
      json(null, 201, { "x-restli-id": "urn:li:share:1" }),
    );
    const p = new LinkedInProvider({ accessToken: "t", fetch: m.fetch, sleep: noSleep, version: "202610" });
    assert.equal(m.calls.length, 0);
    assert.deepEqual(await p.getAuthenticatedAccount(), { provider: "LINKEDIN", id: "abc", username: null, displayName: "Ann", profilePictureUrl: "https://p" });
    const created = await p.createTextPost({ author: "urn:li:person:abc", commentary: "hi", visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED" } });
    assert.deepEqual(created, { id: "urn:li:share:1" });
    const post = m.calls[1]!;
    assert.equal(post.headers.get("linkedin-version"), "202610");
    assert.equal(post.headers.get("x-restli-protocol-version"), "2.0.0");
    assert.equal((post.json as { lifecycleState: string }).lifecycleState, "PUBLISHED");
  });

  test("rejects bad URNs before any request", async () => {
    const m = mockFetch();
    const p = new LinkedInProvider({ accessToken: "t", fetch: m.fetch });
    await assert.rejects(p.deletePost("not-a-urn"), ProviderError);
    assert.equal(m.calls.length, 0);
  });
});

describe("XProvider", () => {
  test("routes XDK requests through the injected fetch with bearer auth", async () => {
    const m = mockFetch(json({ data: { id: "42", username: "bob", name: "Bob", profile_image_url: "https://img" } }));
    const p = new XProvider({ accessToken: "xtok", fetch: m.fetch, sleep: noSleep });
    const account = await p.getAuthenticatedAccount();
    assert.equal(account.id, "42");
    assert.equal(account.username, "bob");
    assert.equal(m.calls[0]!.url.pathname, "/2/users/me");
    assert.equal(m.calls[0]!.headers.get("authorization"), "Bearer xtok");
  });

  test("normalises X errors", async () => {
    const m = mockFetch(json({ title: "Forbidden", detail: "nope" }, 403));
    const p = new XProvider({ accessToken: "x", fetch: m.fetch, sleep: noSleep });
    await assert.rejects(p.getMe(), (e: unknown) => e instanceof ProviderError && e.code === "FORBIDDEN");
  });
});

describe("YouTubeProvider", () => {
  test("uses the official client with the injected fetch and validates input", async () => {
    const m = mockFetch(json({ items: [{ id: "UC1", snippet: { title: "Chan", customUrl: "@chan", thumbnails: { default: { url: "https://t" } } } }] }));
    const p = new YouTubeProvider({ accessToken: "yt", fetch: m.fetch, sleep: noSleep, channelId: "UC1" });
    assert.equal(m.calls.length, 0);
    const account = await p.getAuthenticatedAccount();
    assert.equal(account.id, "UC1");
    assert.equal(account.displayName, "Chan");
    const call = m.calls[0]!;
    assert.equal(call.url.pathname, "/youtube/v3/channels");
    assert.equal(call.url.searchParams.get("id"), "UC1");
    assert.equal(call.headers.get("authorization"), "Bearer yt");
    await assert.rejects(p.listChannels({ part: [] }), ProviderError);
  });

  test("Google errors are normalised", async () => {
    const m = mockFetch(json({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }, 403));
    const p = new YouTubeProvider({ accessToken: "yt", fetch: m.fetch, sleep: noSleep, retry: { maxRetries: 0 } });
    await assert.rejects(p.listChannels({ part: ["snippet"], mine: true }), (e: unknown) => e instanceof ProviderError && e.status === 403);
  });
});

describe("YouTubeAnalyticsProvider", () => {
  test("queries reports through the official client", async () => {
    const m = mockFetch(json({ kind: "youtubeAnalytics#resultTable", columnHeaders: [{ name: "views" }], rows: [[10]] }));
    const p = new YouTubeAnalyticsProvider({ accessToken: "a", fetch: m.fetch, sleep: noSleep });
    const res = await p.queryReports({ ids: "channel==MINE", startDate: "2026-01-01", endDate: "2026-01-31", metrics: "views" });
    assert.deepEqual(res.rows, [[10]]);
    assert.equal(m.calls[0]!.url.pathname, "/v2/reports");
    assert.equal(m.calls[0]!.url.searchParams.get("metrics"), "views");
  });
});
