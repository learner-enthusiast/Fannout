import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { AppError } from "@repo/errors";
import { FacebookProvider, LinkedInProvider, ThreadsProvider, XProvider, YouTubeProvider, type FetchLike } from "@repo/providers";
import { createProviderFactory } from "../provider-factory/factory";
import type { SocialConnectionRow } from "../social-connections/model";

const USER = randomUUID();

function row(overrides: Partial<SocialConnectionRow>): SocialConnectionRow {
  return {
    id: randomUUID(),
    userId: USER,
    provider: "LINKEDIN",
    providerAccountId: "123",
    accountType: null,
    username: null,
    displayName: null,
    profilePictureUrl: null,
    config: null,
    accessTokenEncrypted: "enc",
    refreshTokenEncrypted: null,
    accessExpiry: null,
    refreshExpiry: null,
    scopes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(rows: SocialConnectionRow[], tokens: string[] = ["token"], fetch?: FetchLike) {
  const tokenCalls: string[] = [];
  const factory = createProviderFactory({
    // Mirrors getSocialConnectionById: scoped by user id.
    getConnection: async (userId, id) => rows.find((r) => r.id === id && r.userId === userId) ?? null,
    getValidAccessToken: async (_userId, id) => {
      tokenCalls.push(id);
      return tokens[Math.min(tokenCalls.length - 1, tokens.length - 1)]!;
    },
    facebook: { appSecret: "app-secret", graphVersion: "v24.0" },
    providerOptions: fetch ? { fetch, sleep: async () => {} } : undefined,
  });
  return { ...factory, tokenCalls };
}

describe("createProviderForConnection", () => {
  test("builds the right class per provider with provider-specific identity", async () => {
    const li = row({ provider: "LINKEDIN" });
    const x = row({ provider: "X", providerAccountId: "42" });
    const yt = row({ provider: "YOUTUBE", providerAccountId: "UCabc", config: { google: { sub: "g-1" } } });
    const th = row({ provider: "THREADS", providerAccountId: "777" });
    const fb = row({ provider: "FACEBOOK", providerAccountId: "999" });
    const { createProviderForConnection, tokenCalls } = setup([li, x, yt, th, fb]);

    assert.ok((await createProviderForConnection({ userId: USER, connectionId: li.id })) instanceof LinkedInProvider);
    assert.ok((await createProviderForConnection({ userId: USER, connectionId: x.id })) instanceof XProvider);

    const youtube = await createProviderForConnection({ userId: USER, connectionId: yt.id });
    assert.ok(youtube instanceof YouTubeProvider);
    assert.equal(youtube.channelId, "UCabc");
    assert.equal(youtube.googleSubject, "g-1");

    const threads = await createProviderForConnection({ userId: USER, connectionId: th.id });
    assert.ok(threads instanceof ThreadsProvider);
    assert.equal(threads.userId, "777");

    const facebook = await createProviderForConnection({ userId: USER, connectionId: fb.id });
    assert.ok(facebook instanceof FacebookProvider);
    assert.equal(facebook.pageId, "999");
    assert.equal(facebook.version, "v24.0");

    assert.equal(tokenCalls.length, 0, "tokens are fetched lazily, not at construction");
  });

  test("another user's connection is not found (ownership check)", async () => {
    const r = row({});
    const { createProviderForConnection } = setup([r]);
    await assert.rejects(createProviderForConnection({ userId: randomUUID(), connectionId: r.id }), (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
  });

  test("inactive or token-less connections require reconnecting", async () => {
    const a = row({ isActive: false });
    const b = row({ accessTokenEncrypted: null });
    const { createProviderForConnection } = setup([a, b]);
    for (const r of [a, b]) {
      await assert.rejects(createProviderForConnection({ userId: USER, connectionId: r.id }), (e: unknown) => e instanceof AppError && e.code === "CONFLICT");
    }
  });

  test("unknown providers are rejected; bad ids fail validation", async () => {
    const r = row({ provider: "INSTAGRAM" });
    const { createProviderForConnection } = setup([r]);
    await assert.rejects(createProviderForConnection({ userId: USER, connectionId: r.id }), (e: unknown) => e instanceof AppError && e.code === "BAD_REQUEST");
    await assert.rejects(createProviderForConnection({ userId: "nope", connectionId: r.id }));
  });

  test("tokens come from the OAuth service per call; a 401 retries only if the token changed", async () => {
    const seen: string[] = [];
    let status = 401;
    const fetch: FetchLike = async (input) => {
      seen.push(new URL(input).searchParams.get("access_token") ?? "");
      const res = status === 401 ? { error: { message: "expired", code: 190 } } : { id: "777", username: "t" };
      const out = new Response(JSON.stringify(res), { status, headers: { "content-type": "application/json" } });
      status = 200;
      return out;
    };
    const th = row({ provider: "THREADS", providerAccountId: "777" });
    const { createProviderForConnection } = setup([th], ["old", "new"], fetch);
    const threads = (await createProviderForConnection({ userId: USER, connectionId: th.id })) as ThreadsProvider;
    await threads.getProfile();
    assert.deepEqual(seen, ["old", "new"]);

    // Same token after refresh → surface the 401 instead of looping.
    const seen2: string[] = [];
    const fetch2: FetchLike = async (input) => {
      seen2.push(new URL(input).searchParams.get("access_token") ?? "");
      return new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), { status: 401, headers: { "content-type": "application/json" } });
    };
    const { createProviderForConnection: create2 } = setup([th], ["same"], fetch2);
    const t2 = (await create2({ userId: USER, connectionId: th.id })) as ThreadsProvider;
    await assert.rejects(t2.getProfile(), /expired/);
    assert.deepEqual(seen2, ["same"]);
  });
});
