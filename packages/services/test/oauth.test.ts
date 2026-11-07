import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { AppError } from "@repo/errors";
import type {
  CreateOAuthTransactionInput,
  OAuthTransactionRow,
  OAuthTransactionStore,
} from "../oauth-transactions/model";
import { isSafeReturnTo, type OAuthCallbackResult, type OAuthProviderSlug } from "../oauth/model";
import { createProviderRegistry } from "../oauth/providers";
import {
  createOAuthService,
  type ConnectionStore,
  type EncryptedTokenPatch,
} from "../oauth/service";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "../oauth/token-encryption";
import type { SocialConnectionRow } from "../social-connections/model";

// ---------------------------------------------------------------------------
// Fixtures: signing keys, in-memory stores, fake provider HTTP
// ---------------------------------------------------------------------------

function rsaKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
  };
}
const signingKey = rsaKey("test-key");
const rogueKey = rsaKey("test-key"); // same kid, different key → bad signature

function signJwt(claims: Record<string, unknown>, key: { kid: string; privateKey: KeyObject }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", typ: "JWT", kid: key.kid })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(key.privateKey)
    .toString("base64url");
  return `${input}.${signature}`;
}

const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const USER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();

const credentials = (slug: OAuthProviderSlug, scopes: string) => ({
  clientId: `${slug}-client-id`,
  clientSecret: `${slug}-client-secret`,
  redirectUri: `https://api.test/api/oauth/${slug}/callback`,
  scopes,
});

function memoryTransactions(): OAuthTransactionStore & { rows: Map<string, OAuthTransactionRow> } {
  const rows = new Map<string, OAuthTransactionRow>();
  const byState = (hash: string) => [...rows.values()].find((r) => r.stateHash === hash) ?? null;
  return {
    rows,
    async create(input: CreateOAuthTransactionInput) {
      const row: OAuthTransactionRow = {
        ...input,
        id: randomUUID(),
        status: "pending",
        pendingPayloadEncrypted: null,
        consumedAt: null,
        createdAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    },
    async consume(hash, now) {
      const row = byState(hash);
      if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
      Object.assign(row, { status: "consumed", consumedAt: now });
      return { ...row };
    },
    async findByStateHash(hash) {
      return byState(hash);
    },
    async markAwaitingSelection(id, payload, expiresAt) {
      const row = rows.get(id)!;
      Object.assign(row, {
        status: "awaiting_selection",
        pendingPayloadEncrypted: payload,
        expiresAt,
      });
    },
    async getAwaitingSelection(id, userId, now) {
      const row = rows.get(id);
      return row &&
        row.userId === userId &&
        row.status === "awaiting_selection" &&
        row.expiresAt > now
        ? { ...row }
        : null;
    },
    async completeSelection(id, userId, now) {
      const row = rows.get(id);
      if (
        !row ||
        row.userId !== userId ||
        row.status !== "awaiting_selection" ||
        row.expiresAt <= now
      ) {
        return null;
      }
      const snapshot = { ...row, status: "completed" as const };
      Object.assign(row, { status: "completed", pendingPayloadEncrypted: null });
      return snapshot;
    },
    async deleteExpired() {},
  };
}

function memoryConnections(): ConnectionStore & { rows: Map<string, SocialConnectionRow> } {
  const rows = new Map<string, SocialConnectionRow>();
  const apply = (row: SocialConnectionRow, patch: EncryptedTokenPatch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (row as Record<string, unknown>)[key] = value;
    }
  };
  return {
    rows,
    async upsert(userId, account, tokens) {
      const existing = [...rows.values()].find(
        (r) =>
          r.userId === userId &&
          r.provider === account.provider &&
          r.providerAccountId === account.providerAccountId,
      );
      const row: SocialConnectionRow = existing ?? {
        id: randomUUID(),
        userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        accountType: null,
        username: null,
        displayName: null,
        profilePictureUrl: null,
        config: null,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessExpiry: null,
        refreshExpiry: null,
        scopes: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      Object.assign(row, {
        accountType: account.accountType,
        username: account.username,
        displayName: account.displayName,
        profilePictureUrl: account.profilePictureUrl,
        config: account.config,
        isActive: true,
      });
      apply(row, tokens);
      rows.set(row.id, row);
      return { id: row.id };
    },
    async withLock(userId, id, fn) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) throw new Error("not found");
      return fn({ ...row }, async (patch) => apply(row, patch));
    },
  };
}

type TokenHandler = (body: URLSearchParams, headers: Record<string, string>) => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes oauth4webapi requests to scenario handlers; fails loudly on anything unexpected. */
function fakeProviders() {
  const state = {
    tokenHandler: undefined as TokenHandler | undefined,
    xMe: () =>
      json({
        data: {
          id: "x-123",
          name: "Ada",
          username: "ada",
          profile_image_url: "https://pbs.test/a_normal.jpg",
        },
      }),
    youtubeChannels: () =>
      json({
        items: [
          {
            id: "UC-one",
            snippet: {
              title: "Main",
              customUrl: "@main",
              thumbnails: { high: { url: "https://yt.test/1.jpg" } },
            },
          },
        ],
      }),
    jwks: [signingKey.jwk] as unknown[],
    requests: [] as string[],
    /** Full URLs (with query) of GET requests, for asserting Meta parameters. */
    getUrls: [] as string[],
    fbPermissions: [
      { permission: "public_profile", status: "granted" },
      { permission: "pages_show_list", status: "granted" },
    ],
    fbPages: [
      {
        id: "page-1",
        name: "Bakery",
        access_token: "page-token-1",
        category: "Food",
        tasks: ["CREATE_CONTENT"],
        picture: { data: { url: "https://fb.test/p1.jpg" } },
      },
    ] as unknown[],
    threadsRefresh: () => json({ access_token: "threads-long-2", expires_in: 5184000 }),
  };

  const discovery = (issuer: string, base: string) =>
    json({
      issuer,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
    });

  const fetch = async (
    url: string,
    options: { method: string; body?: unknown; headers: Record<string, string> },
  ) => {
    state.requests.push(`${options.method} ${url.split("?")[0]}`);
    if (options.method === "GET") state.getUrls.push(url);
    const path = url.split("?")[0];
    const query = new URL(url).searchParams;
    if (
      path === "https://graph.facebook.com/v23.0/oauth/access_token" &&
      options.method === "GET"
    ) {
      assert.equal(query.get("grant_type"), "fb_exchange_token");
      return json({ access_token: "fb-long-user", token_type: "bearer", expires_in: 5184000 });
    }
    switch (path) {
      case "https://accounts.google.com/.well-known/openid-configuration":
        return discovery("https://accounts.google.com", "https://google.test");
      case "https://www.linkedin.com/oauth/.well-known/openid-configuration":
        return discovery("https://www.linkedin.com/oauth", "https://linkedin.test");
      case "https://google.test/jwks":
      case "https://linkedin.test/jwks":
        return json({ keys: state.jwks });
      case "https://google.test/token":
      case "https://linkedin.test/token":
      case "https://api.x.com/2/oauth2/token": {
        assert.ok(state.tokenHandler, "unexpected token request");
        return state.tokenHandler(new URLSearchParams(String(options.body)), options.headers);
      }
      case "https://api.x.com/2/users/me":
        return state.xMe();
      case "https://www.googleapis.com/youtube/v3/channels":
        return state.youtubeChannels();
      case "https://graph.facebook.com/v23.0/oauth/access_token":
      case "https://graph.threads.net/oauth/access_token": {
        assert.ok(state.tokenHandler, "unexpected token request");
        return state.tokenHandler(new URLSearchParams(String(options.body)), options.headers);
      }
      case "https://graph.facebook.com/v23.0/me/permissions":
        return json({ data: state.fbPermissions });
      case "https://graph.facebook.com/v23.0/me":
        return json({ id: "fb-user-1", name: "Ada Lovelace" });
      case "https://graph.facebook.com/v23.0/me/accounts":
        return json({ data: state.fbPages });
      case "https://graph.threads.net/access_token":
        assert.equal(query.get("grant_type"), "th_exchange_token");
        return json({ access_token: "threads-long", token_type: "bearer", expires_in: 5184000 });
      case "https://graph.threads.net/refresh_access_token":
        assert.equal(query.get("grant_type"), "th_refresh_token");
        return state.threadsRefresh();
      case "https://graph.threads.net/v1.0/me":
        return json({
          id: "th-1",
          username: "ada.codes",
          name: "Ada",
          threads_profile_picture_url: "https://th.test/a.jpg",
        });
      default:
        throw new Error(`Unexpected request ${options.method} ${url}`);
    }
  };
  return { state, fetch };
}

function setup(options: { configured?: Partial<Record<OAuthProviderSlug, boolean>> } = {}) {
  let currentTime = new Date("2026-11-05T10:00:00Z");
  const transactions = memoryTransactions();
  const connections = memoryConnections();
  const http = fakeProviders();
  const cfg = (slug: OAuthProviderSlug, scopes: string) =>
    options.configured?.[slug] === false
      ? { ...credentials(slug, scopes), clientId: undefined, clientSecret: undefined }
      : credentials(slug, scopes);
  const providers = createProviderRegistry({
    linkedin: cfg("linkedin", "openid profile email w_member_social"),
    x: cfg("x", "tweet.read users.read offline.access"),
    youtube: cfg(
      "youtube",
      "openid email profile https://www.googleapis.com/auth/youtube.readonly",
    ),
    facebook: cfg("facebook", "public_profile,pages_show_list"),
    threads: cfg("threads", "threads_basic"),
  });
  const service = createOAuthService({
    providers,
    transactions,
    connections,
    encryptionKey: ENCRYPTION_KEY,
    fetch: http.fetch as never,
    now: () => currentTime,
  });
  return {
    service,
    transactions,
    connections,
    http: http.state,
    advance: (ms: number) => (currentTime = new Date(currentTime.getTime() + ms)),
    now: () => currentTime,
  };
}

type Env = ReturnType<typeof setup>;

async function start(env: Env, provider: OAuthProviderSlug, returnTo = "/connections") {
  const result = await env.service.startConnection({ userId: USER_ID, provider, returnTo });
  const url = new URL(result.authorizationUrl);
  return {
    ...result,
    url,
    state: url.searchParams.get("state")!,
    nonce: url.searchParams.get("nonce"),
  };
}

function callbackUrl(provider: OAuthProviderSlug, params: Record<string, string>) {
  const url = new URL(`https://api.test/api/oauth/${provider}/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/** iat/exp use the real clock: oauth4webapi validates them against Date.now(). */
function idToken(_env: Env, overrides: Record<string, unknown>, key = signingKey) {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt({ iat, exp: iat + 3600, ...overrides }, key);
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function googleTokens(
  env: Env,
  nonce: string | null,
  extra: Record<string, unknown> = {},
  key = signingKey,
): TokenHandler {
  return () =>
    json({
      access_token: "google-access",
      refresh_token: "google-refresh",
      expires_in: 3599,
      token_type: "Bearer",
      scope:
        "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/youtube.readonly",
      id_token: idToken(
        env,
        {
          iss: "https://accounts.google.com",
          aud: "youtube-client-id",
          sub: "google-sub-1",
          email: "ada@example.com",
          email_verified: true,
          nonce,
          ...extra,
        },
        key,
      ),
    });
}

async function connectYouTube(env: Env, tokenExtra: Record<string, unknown> = {}) {
  const flow = await start(env, "youtube");
  env.http.tokenHandler = googleTokens(env, flow.nonce, tokenExtra);
  return env.service.handleCallback({
    provider: "youtube",
    callbackUrl: callbackUrl("youtube", { code: "auth-code", state: flow.state }),
    bindingToken: flow.bindingToken,
  });
}

function xTokens(overrides: Record<string, unknown> = {}): TokenHandler {
  return () =>
    json({
      access_token: "x-access",
      refresh_token: "x-refresh",
      expires_in: 7200,
      token_type: "bearer",
      scope: "tweet.read users.read offline.access",
      ...overrides,
    });
}

async function connectX(env: Env, tokens = xTokens()) {
  const flow = await start(env, "x");
  env.http.tokenHandler = tokens;
  return env.service.handleCallback({
    provider: "x",
    callbackUrl: callbackUrl("x", { code: "auth-code", state: flow.state }),
    bindingToken: flow.bindingToken,
  });
}

function expectFailure(result: OAuthCallbackResult, reason: string) {
  assert.equal(
    result.status,
    "failed",
    `expected failure ${reason}, got ${JSON.stringify(result)}`,
  );
  if (result.status === "failed") assert.equal(result.reason, reason);
}

// ---------------------------------------------------------------------------

describe("OAuth initiation", () => {
  let env: Env;
  beforeEach(() => (env = setup()));

  test("builds a PKCE S256 + nonce authorization URL for YouTube and stores only hashes/ciphertext", async () => {
    const flow = await start(env, "youtube", "/connections?tab=youtube");
    assert.equal(flow.url.origin + flow.url.pathname, "https://google.test/authorize");
    assert.equal(flow.url.searchParams.get("client_id"), "youtube-client-id");
    assert.equal(
      flow.url.searchParams.get("redirect_uri"),
      "https://api.test/api/oauth/youtube/callback",
    );
    assert.equal(flow.url.searchParams.get("response_type"), "code");
    assert.equal(flow.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(flow.url.searchParams.get("access_type"), "offline");
    assert.ok(flow.nonce);
    assert.ok(flow.state.length >= 32);

    const [row] = [...env.transactions.rows.values()];
    assert.ok(row);
    assert.notEqual(row.stateHash, flow.state);
    assert.equal(row.status, "pending");
    assert.equal(row.returnTo, "/connections?tab=youtube");
    assert.equal(row.expiresAt.getTime() - env.now().getTime(), 10 * 60 * 1000);
    const verifier = decryptSecret(row.codeVerifierEncrypted, parseEncryptionKey(ENCRYPTION_KEY));
    assert.equal(s256(verifier), flow.url.searchParams.get("code_challenge"));
  });

  test("X uses PKCE without nonce; LinkedIn sends neither", async () => {
    const x = await start(env, "x");
    assert.equal(x.url.origin, "https://x.com");
    assert.equal(x.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(x.nonce, null);
    const linkedin = await start(env, "linkedin");
    assert.equal(linkedin.url.searchParams.get("code_challenge"), null);
    assert.equal(linkedin.url.searchParams.get("scope"), "openid profile email w_member_social");
  });

  test("rejects unconfigured providers and unsafe returnTo values", async () => {
    const unconfigured = setup({ configured: { x: false } });
    await assert.rejects(
      unconfigured.service.startConnection({ userId: USER_ID, provider: "x" }),
      (error: unknown) => error instanceof AppError && error.code === "BAD_REQUEST",
    );
    await assert.rejects(
      env.service.startConnection({
        userId: USER_ID,
        provider: "x",
        returnTo: "https://evil.test",
      }),
    );
  });

  test("returnTo only accepts same-app relative paths", () => {
    for (const ok of ["/connections", "/connections?oauth=1#top", "/a/b"])
      assert.ok(isSafeReturnTo(ok), ok);
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "connections",
      "/\nfoo",
      "javascript:alert(1)",
    ]) {
      assert.equal(isSafeReturnTo(bad), false, bad);
    }
  });
});

describe("OAuth callback: state and request validation", () => {
  let env: Env;
  beforeEach(() => (env = setup()));

  test("unknown state is rejected", async () => {
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c", state: "not-a-real-state" }),
        bindingToken: "whatever",
      }),
      "invalid_state",
    );
  });

  test("expired state is rejected as expired", async () => {
    const flow = await start(env, "x");
    env.advance(10 * 60 * 1000 + 1);
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c", state: flow.state }),
        bindingToken: flow.bindingToken,
      }),
      "expired_state",
    );
  });

  test("state is single use: replaying a successful callback fails", async () => {
    const flow = await start(env, "x");
    env.http.tokenHandler = xTokens();
    const input = {
      provider: "x" as const,
      callbackUrl: callbackUrl("x", { code: "c", state: flow.state }),
      bindingToken: flow.bindingToken,
    };
    assert.equal((await env.service.handleCallback(input)).status, "connected");
    expectFailure(await env.service.handleCallback(input), "invalid_state");
  });

  test("concurrent callbacks with the same state: exactly one wins", async () => {
    const flow = await start(env, "x");
    env.http.tokenHandler = xTokens();
    const input = {
      provider: "x" as const,
      callbackUrl: callbackUrl("x", { code: "c", state: flow.state }),
      bindingToken: flow.bindingToken,
    };
    const results = await Promise.all([
      env.service.handleCallback(input),
      env.service.handleCallback(input),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["connected", "failed"]);
    assert.equal(env.connections.rows.size, 1);
  });

  test("state for one provider cannot be used on another provider's callback", async () => {
    const flow = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "linkedin",
        callbackUrl: callbackUrl("linkedin", { code: "c", state: flow.state }),
        bindingToken: flow.bindingToken,
      }),
      "invalid_state",
    );
  });

  test("missing or wrong browser-binding cookie is rejected", async () => {
    const a = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c", state: a.state }),
        bindingToken: undefined,
      }),
      "session_mismatch",
    );
    const b = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c", state: b.state }),
        bindingToken: a.bindingToken,
      }),
      "session_mismatch",
    );
  });

  test("a signed-in session for a different app user is rejected", async () => {
    const flow = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c", state: flow.state }),
        bindingToken: flow.bindingToken,
        sessionUserId: OTHER_USER_ID,
      }),
      "session_mismatch",
    );
  });

  test("missing state or code is an invalid request", async () => {
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { code: "c" }),
        bindingToken: "b",
      }),
      "invalid_request",
    );
    const flow = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { state: flow.state }),
        bindingToken: flow.bindingToken,
      }),
      "invalid_request",
    );
  });

  test("provider authorization errors are reported and consume the state", async () => {
    const flow = await start(env, "linkedin", "/settings");
    const result = await env.service.handleCallback({
      provider: "linkedin",
      callbackUrl: callbackUrl("linkedin", {
        error: "access_denied",
        error_description: "user cancelled",
        state: flow.state,
      }),
      bindingToken: flow.bindingToken,
    });
    expectFailure(result, "access_denied");
    assert.equal(result.returnTo, "/settings");
    assert.equal(env.http.requests.filter((r) => r.includes("/token")).length, 0);

    const other = await start(env, "x");
    expectFailure(
      await env.service.handleCallback({
        provider: "x",
        callbackUrl: callbackUrl("x", { error: "server_error", state: other.state }),
        bindingToken: other.bindingToken,
      }),
      "provider_error",
    );
  });

  test("token endpoint errors fail the exchange", async () => {
    expectFailure(
      await connectX(env, () => json({ error: "invalid_grant" }, 400)),
      "token_exchange_failed",
    );
    assert.equal(env.connections.rows.size, 0);
  });
});

describe("OAuth callback: providers", () => {
  let env: Env;
  beforeEach(() => (env = setup()));

  test("X: exchanges the code with the PKCE verifier and Basic auth, then looks up /2/users/me", async () => {
    const flow = await start(env, "x");
    env.http.tokenHandler = (body, headers) => {
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "auth-code");
      assert.equal(body.get("redirect_uri"), "https://api.test/api/oauth/x/callback");
      assert.equal(s256(body.get("code_verifier")!), flow.url.searchParams.get("code_challenge"));
      assert.match(headers.authorization ?? "", /^Basic /);
      return xTokens()(body, headers);
    };
    const result = await env.service.handleCallback({
      provider: "x",
      callbackUrl: callbackUrl("x", { code: "auth-code", state: flow.state }),
      bindingToken: flow.bindingToken,
    });
    assert.equal(result.status, "connected");
    assert.ok(env.http.requests.includes("GET https://api.x.com/2/users/me"));

    const [row] = [...env.connections.rows.values()];
    assert.ok(row);
    assert.equal(row.provider, "X");
    assert.equal(row.providerAccountId, "x-123");
    assert.equal(row.username, "ada");
    assert.equal(row.displayName, "Ada");
    assert.equal(row.profilePictureUrl, "https://pbs.test/a_400x400.jpg");
    assert.deepEqual(row.scopes, ["tweet.read", "users.read", "offline.access"]);
    // Tokens are stored encrypted, never in plaintext.
    assert.ok(row.accessTokenEncrypted?.startsWith("v1."));
    assert.notEqual(row.accessTokenEncrypted, "x-access");
    const key = parseEncryptionKey(ENCRYPTION_KEY);
    assert.equal(decryptSecret(row.accessTokenEncrypted!, key), "x-access");
    assert.equal(decryptSecret(row.refreshTokenEncrypted!, key), "x-refresh");
    assert.equal(row.accessExpiry?.getTime(), env.now().getTime() + 7200 * 1000);
  });

  test("X: a failed /2/users/me lookup fails the connection", async () => {
    env.http.xMe = () => json({ title: "Unauthorized" }, 401);
    expectFailure(await connectX(env), "identity_failed");
  });

  test("LinkedIn: validates the ID token and saves the OIDC subject", async () => {
    const flow = await start(env, "linkedin");
    env.http.tokenHandler = (body) => {
      assert.equal(body.get("client_secret"), "linkedin-client-secret"); // client_secret_post
      assert.equal(body.get("code_verifier"), null);
      return json({
        access_token: "li-access",
        expires_in: 5183999,
        token_type: "Bearer",
        scope: "email,openid,profile,w_member_social",
        id_token: idToken(env, {
          iss: "https://www.linkedin.com/oauth",
          aud: "linkedin-client-id",
          sub: "li-sub-9",
          name: "Grace Hopper",
          picture: "https://media.licdn.test/g.jpg",
          email: "grace@example.com",
          email_verified: true,
        }),
      });
    };
    const result = await env.service.handleCallback({
      provider: "linkedin",
      callbackUrl: callbackUrl("linkedin", { code: "auth-code", state: flow.state }),
      bindingToken: flow.bindingToken,
    });
    assert.equal(result.status, "connected");
    const [row] = [...env.connections.rows.values()];
    assert.equal(row?.providerAccountId, "li-sub-9");
    assert.equal(row?.displayName, "Grace Hopper");
    assert.equal(row?.refreshTokenEncrypted, null);
    assert.deepEqual(row?.config, {
      email: "grace@example.com",
      emailVerified: true,
      locale: null,
    });
    assert.ok(env.http.requests.includes("GET https://linkedin.test/jwks"));
  });

  test("OIDC: ID tokens with a bad signature, wrong audience, wrong nonce or past expiry are rejected", async () => {
    const cases: Array<[string, (e: Env, nonce: string | null) => TokenHandler]> = [
      ["bad signature", (e, nonce) => googleTokens(e, nonce, {}, rogueKey)],
      ["wrong audience", (e, nonce) => googleTokens(e, nonce, { aud: "someone-else" })],
      ["wrong nonce", (e) => googleTokens(e, "not-the-nonce")],
      [
        "expired",
        (e, nonce) =>
          googleTokens(e, nonce, {
            iat: Math.floor(Date.now() / 1000) - 7200,
            exp: Math.floor(Date.now() / 1000) - 3600,
          }),
      ],
      ["wrong issuer", (e, nonce) => googleTokens(e, nonce, { iss: "https://evil.test" })],
    ];
    for (const [label, handler] of cases) {
      const caseEnv = setup();
      const flow = await start(caseEnv, "youtube");
      caseEnv.http.tokenHandler = handler(caseEnv, flow.nonce);
      const result = await caseEnv.service.handleCallback({
        provider: "youtube",
        callbackUrl: callbackUrl("youtube", { code: "c", state: flow.state }),
        bindingToken: flow.bindingToken,
      });
      assert.equal(result.status, "failed", label);
      if (result.status === "failed") assert.equal(result.reason, "id_token_invalid", label);
      assert.equal(caseEnv.connections.rows.size, 0, label);
    }
  });

  test("YouTube: single channel connects with Google identity kept separate from channel identity", async () => {
    const result = await connectYouTube(env);
    assert.equal(result.status, "connected");
    assert.ok(env.http.requests.includes("GET https://www.googleapis.com/youtube/v3/channels"));
    const [row] = [...env.connections.rows.values()];
    assert.equal(row?.provider, "YOUTUBE");
    assert.equal(row?.providerAccountId, "UC-one");
    assert.equal(row?.accountType, "youtube_channel");
    assert.equal(row?.username, "@main");
    const config = row?.config as {
      google: { sub: string; email: string };
      channel: { id: string };
    };
    assert.equal(config.google.sub, "google-sub-1");
    assert.equal(config.google.email, "ada@example.com");
    assert.equal(config.channel.id, "UC-one");
  });

  test("YouTube: missing youtube.readonly grant is rejected", async () => {
    const flow = await start(env, "youtube");
    env.http.tokenHandler = () =>
      json({
        access_token: "a",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email",
        id_token: idToken(env, {
          iss: "https://accounts.google.com",
          aud: "youtube-client-id",
          sub: "google-sub-1",
          nonce: flow.nonce,
        }),
      });
    expectFailure(
      await env.service.handleCallback({
        provider: "youtube",
        callbackUrl: callbackUrl("youtube", { code: "c", state: flow.state }),
        bindingToken: flow.bindingToken,
      }),
      "insufficient_scope",
    );
  });

  test("YouTube: an account with no channel fails with no_account", async () => {
    env.http.youtubeChannels = () => json({ items: [] });
    expectFailure(await connectYouTube(env), "no_account");
  });

  test("YouTube: multiple channels require a selection before anything is saved", async () => {
    env.http.youtubeChannels = () =>
      json({
        items: [
          { id: "UC-one", snippet: { title: "Main", customUrl: "@main" } },
          { id: "UC-two", snippet: { title: "Brand", customUrl: "@brand" } },
        ],
      });
    const result = await connectYouTube(env);
    assert.equal(result.status, "select_channel");
    assert.equal(env.connections.rows.size, 0);
    if (result.status !== "select_channel") return;

    const selection = await env.service.getChannelSelection(USER_ID, result.selectionId);
    assert.equal(selection.accountLabel, "ada@example.com");
    assert.deepEqual(
      selection.channels.map((c) => c.id),
      ["UC-one", "UC-two"],
    );
    assert.equal(JSON.stringify(selection).includes("google-access"), false);

    await assert.rejects(env.service.getChannelSelection(OTHER_USER_ID, result.selectionId));
    await assert.rejects(
      env.service.finalizeChannelSelection(USER_ID, {
        selectionId: result.selectionId,
        channelIds: ["UC-nope"],
      }),
    );

    const done = await env.service.finalizeChannelSelection(USER_ID, {
      selectionId: result.selectionId,
      channelIds: ["UC-two"],
    });
    assert.equal(done.connectionIds.length, 1);
    const [row] = [...env.connections.rows.values()];
    assert.equal(row?.providerAccountId, "UC-two");

    // Single use.
    await assert.rejects(
      env.service.finalizeChannelSelection(USER_ID, {
        selectionId: result.selectionId,
        channelIds: ["UC-one"],
      }),
    );
  });

  test("duplicate connections update the existing record instead of creating another", async () => {
    await connectX(env);
    await connectX(env, xTokens({ access_token: "x-access-2", refresh_token: "x-refresh-2" }));
    assert.equal(env.connections.rows.size, 1);
    const [row] = [...env.connections.rows.values()];
    assert.equal(
      decryptSecret(row!.accessTokenEncrypted!, parseEncryptionKey(ENCRYPTION_KEY)),
      "x-access-2",
    );
  });
});

describe("Access token refresh", () => {
  test("refreshes an expiring X token and stores the rotated refresh token", async () => {
    const env = setup();
    await connectX(env);
    const [row] = [...env.connections.rows.values()];
    env.advance(7200 * 1000);
    env.http.tokenHandler = (body) => {
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "x-refresh");
      return xTokens({ access_token: "x-access-new", refresh_token: "x-refresh-new" })(body, {});
    };
    assert.equal(await env.service.getValidAccessToken(USER_ID, row!.id), "x-access-new");
    const key = parseEncryptionKey(ENCRYPTION_KEY);
    assert.equal(decryptSecret(row!.refreshTokenEncrypted!, key), "x-refresh-new");
  });

  test("returns the current token without refreshing when it is still valid", async () => {
    const env = setup();
    await connectX(env);
    const [row] = [...env.connections.rows.values()];
    env.http.tokenHandler = () => assert.fail("should not refresh");
    assert.equal(await env.service.getValidAccessToken(USER_ID, row!.id), "x-access");
  });

  test("invalid_grant on refresh clears tokens and requires reconnecting", async () => {
    const env = setup();
    await connectX(env);
    const [row] = [...env.connections.rows.values()];
    env.advance(7200 * 1000);
    env.http.tokenHandler = () => json({ error: "invalid_grant" }, 400);
    await assert.rejects(
      env.service.getValidAccessToken(USER_ID, row!.id),
      (error: unknown) => error instanceof AppError && error.code === "CONFLICT",
    );
    assert.equal(row!.accessTokenEncrypted, null);
    assert.equal(row!.refreshTokenEncrypted, null);
  });
});

describe("Token encryption", () => {
  const key = parseEncryptionKey(ENCRYPTION_KEY);

  test("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("secret-token", key);
    const b = encryptSecret("secret-token", key);
    assert.notEqual(a, b);
    assert.equal(a.includes("secret-token"), false);
    assert.equal(decryptSecret(a, key), "secret-token");
  });

  test("rejects tampered ciphertext and the wrong key", () => {
    const payload = encryptSecret("secret-token", key);
    const parts = payload.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64url");
    assert.throws(() => decryptSecret(parts.join("."), key));
    assert.throws(() => decryptSecret(payload, randomBytes(32)));
  });

  test("requires a 32-byte base64 key", () => {
    assert.throws(() => parseEncryptionKey(undefined));
    assert.throws(() => parseEncryptionKey(randomBytes(16).toString("base64")));
  });
});

describe("Meta providers", () => {
  async function connect(env: Env, provider: "facebook" | "threads", tokens: TokenHandler) {
    const flow = await start(env, provider);
    env.http.tokenHandler = tokens;
    const result = await env.service.handleCallback({
      provider,
      callbackUrl: callbackUrl(provider, { code: "auth-code", state: flow.state }),
      bindingToken: flow.bindingToken,
    });
    return { flow, result };
  }

  const fbShortToken: TokenHandler = (body) => {
    assert.equal(body.get("client_secret"), "facebook-client-secret");
    assert.ok(body.get("code_verifier"));
    return json({ access_token: "fb-short", token_type: "bearer", expires_in: 3600 });
  };

  test("Facebook: comma scopes + PKCE, long-lived exchange, Page token stored per Page", async () => {
    const env = setup();
    const { flow, result } = await connect(env, "facebook", fbShortToken);
    assert.equal(
      flow.url.origin + flow.url.pathname,
      "https://www.facebook.com/v23.0/dialog/oauth",
    );
    assert.equal(flow.url.searchParams.get("scope"), "public_profile,pages_show_list");
    assert.equal(flow.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(result.status, "connected");

    const [row] = [...env.connections.rows.values()];
    assert.equal(row?.provider, "FACEBOOK");
    assert.equal(row?.providerAccountId, "page-1");
    assert.equal(row?.accountType, "facebook_page");
    assert.equal(row?.displayName, "Bakery");
    const key = parseEncryptionKey(ENCRYPTION_KEY);
    assert.equal(decryptSecret(row!.accessTokenEncrypted!, key), "page-token-1");
    assert.equal(row?.accessExpiry, null);
    assert.equal(row?.refreshTokenEncrypted, null);
    assert.deepEqual(row?.scopes, ["public_profile", "pages_show_list"]);
    const config = row?.config as { facebookUser: { id: string }; page: { tasks: string[] } };
    assert.equal(config.facebookUser.id, "fb-user-1");
    assert.deepEqual(config.page.tasks, ["CREATE_CONTENT"]);

    // Graph calls use the long-lived user token with appsecret_proof.
    const accountsCall = env.http.getUrls.find((u) => u.includes("/me/accounts"))!;
    const params = new URL(accountsCall).searchParams;
    assert.equal(params.get("access_token"), "fb-long-user");
    const expectedProof = createHmac("sha256", "facebook-client-secret")
      .update("fb-long-user")
      .digest("hex");
    assert.equal(params.get("appsecret_proof"), expectedProof);
  });

  test("Facebook: declining pages_show_list fails with insufficient_scope", async () => {
    const env = setup();
    env.http.fbPermissions = [
      { permission: "public_profile", status: "granted" },
      { permission: "pages_show_list", status: "declined" },
    ];
    expectFailure((await connect(env, "facebook", fbShortToken)).result, "insufficient_scope");
  });

  test("Facebook: no Pages fails with no_account", async () => {
    const env = setup();
    env.http.fbPages = [];
    expectFailure((await connect(env, "facebook", fbShortToken)).result, "no_account");
  });

  test("Facebook: several Pages require a selection; each keeps its own token", async () => {
    const env = setup();
    env.http.fbPages = [
      { id: "page-1", name: "Bakery", access_token: "page-token-1" },
      { id: "page-2", name: "Cafe", access_token: "page-token-2" },
    ];
    const { result } = await connect(env, "facebook", fbShortToken);
    assert.equal(result.status, "select_channel");
    if (result.status !== "select_channel") return;

    const selection = await env.service.getChannelSelection(USER_ID, result.selectionId);
    assert.equal(selection.accountLabel, "Ada Lovelace");
    assert.deepEqual(
      selection.channels.map((c) => c.id),
      ["page-1", "page-2"],
    );
    assert.equal(JSON.stringify(selection).includes("page-token"), false);

    await env.service.finalizeChannelSelection(USER_ID, {
      selectionId: result.selectionId,
      channelIds: ["page-1", "page-2"],
    });
    const key = parseEncryptionKey(ENCRYPTION_KEY);
    const tokens = [...env.connections.rows.values()]
      .map((r) => decryptSecret(r.accessTokenEncrypted!, key))
      .sort();
    assert.deepEqual(tokens, ["page-token-1", "page-token-2"]);
  });

  test("Threads: handles the missing token_type, exchanges for a 60-day token", async () => {
    const env = setup();
    const { flow, result } = await connect(env, "threads", (body) => {
      assert.equal(body.get("client_secret"), "threads-client-secret");
      assert.equal(body.get("code_verifier"), null);
      return json({ access_token: "threads-short", user_id: 1234567890 });
    });
    assert.equal(flow.url.origin + flow.url.pathname, "https://threads.net/oauth/authorize");
    assert.equal(flow.url.searchParams.get("code_challenge"), null);
    assert.equal(result.status, "connected");

    const [row] = [...env.connections.rows.values()];
    assert.equal(row?.provider, "THREADS");
    assert.equal(row?.providerAccountId, "th-1");
    assert.equal(row?.username, "ada.codes");
    assert.deepEqual(row?.scopes, ["threads_basic"]);
    const key = parseEncryptionKey(ENCRYPTION_KEY);
    assert.equal(decryptSecret(row!.accessTokenEncrypted!, key), "threads-long");
    assert.equal(row?.accessExpiry?.getTime(), env.now().getTime() + 5184000 * 1000);
  });

  test("Threads: renews the long-lived token in its last week, not before", async () => {
    const env = setup();
    await connect(env, "threads", () => json({ access_token: "threads-short" }));
    const [row] = [...env.connections.rows.values()];
    const key = parseEncryptionKey(ENCRYPTION_KEY);

    env.advance(10 * 24 * 60 * 60 * 1000); // 50 days left
    assert.equal(await env.service.getValidAccessToken(USER_ID, row!.id), "threads-long");
    assert.equal(env.http.requests.filter((r) => r.includes("refresh_access_token")).length, 0);

    env.advance(45 * 24 * 60 * 60 * 1000); // 5 days left
    assert.equal(await env.service.getValidAccessToken(USER_ID, row!.id), "threads-long-2");
    assert.equal(decryptSecret(row!.accessTokenEncrypted!, key), "threads-long-2");
  });

  test("Threads: a failed renewal keeps using the still-valid token; an expired one needs reconnecting", async () => {
    const env = setup();
    await connect(env, "threads", () => json({ access_token: "threads-short" }));
    const [row] = [...env.connections.rows.values()];
    env.http.threadsRefresh = () => json({ error: { message: "nope" } }, 400);

    env.advance(55 * 24 * 60 * 60 * 1000);
    assert.equal(await env.service.getValidAccessToken(USER_ID, row!.id), "threads-long");

    env.advance(6 * 24 * 60 * 60 * 1000); // past expiry
    await assert.rejects(
      env.service.getValidAccessToken(USER_ID, row!.id),
      (error: unknown) => error instanceof AppError && error.code === "CONFLICT",
    );
  });
});
