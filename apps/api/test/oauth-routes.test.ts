import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import type { HandleCallbackInput } from "@repo/services/oauth";
import type { OAuthCallbackResult, StartConnectionInput } from "@repo/services/oauth/model";
import { createOAuthRouter } from "../src/routes/oauth";

const WEB_URL = "http://web.test:3000";
let signedInUser: string | null = "11111111-1111-4111-8111-111111111111";
let started: StartConnectionInput[] = [];
let callbacks: HandleCallbackInput[] = [];
let nextCallbackResult: OAuthCallbackResult;

const app = express();
app.use(
  "/api/oauth",
  createOAuthRouter({
    resolveUserId: async () => signedInUser,
    startConnection: async (input) => {
      started.push(input);
      return {
        authorizationUrl: `https://provider.test/authorize?state=abc&provider=${input.provider}`,
        bindingToken: "binding-token-value",
        expiresAt: new Date(Date.now() + 600_000),
      };
    },
    handleCallback: async (input) => {
      callbacks.push(input);
      return nextCallbackResult;
    },
    webUrl: WEB_URL,
    secureCookies: true,
  }),
);

const server = app.listen(0);
let base: string;
before(async () => {
  await once(server, "listening");
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  signedInUser = "11111111-1111-4111-8111-111111111111";
  started = [];
  callbacks = [];
});

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { redirect: "manual", headers });

test("connect requires a signed-in user", async () => {
  signedInUser = null;
  const response = await get("/api/oauth/x/connect");
  assert.equal(response.status, 401);
  assert.equal(started.length, 0);
});

test("connect rejects unknown providers and unsafe returnTo", async () => {
  assert.equal((await get("/api/oauth/instagram/connect")).status, 404);
  assert.equal((await get("/api/oauth/x/connect?returnTo=https://evil.test")).status, 400);
  assert.equal((await get("/api/oauth/x/connect?returnTo=//evil.test")).status, 400);
  assert.equal(started.length, 0);
});

test("connect redirects browsers and sets an HttpOnly, path-scoped binding cookie", async () => {
  const response = await get("/api/oauth/youtube/connect?returnTo=/connections");
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "https://provider.test/authorize?state=abc&provider=youtube",
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^fannout_oauth_youtube=binding-token-value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/oauth\/youtube/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(started[0], {
    userId: "11111111-1111-4111-8111-111111111111",
    provider: "youtube",
    returnTo: "/connections",
  });
});

test("connect returns JSON for fetch callers", async () => {
  const response = await get("/api/oauth/linkedin/connect", { accept: "application/json" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authorizationUrl: "https://provider.test/authorize?state=abc&provider=linkedin",
  });
});

test("callback forwards the query and binding cookie, clears the cookie and redirects to the web app", async () => {
  nextCallbackResult = {
    status: "connected",
    provider: "X",
    returnTo: "/connections",
    connectionIds: ["c1"],
  };
  const response = await get("/api/oauth/x/callback?code=the-code&state=the-state", {
    cookie: "other=1; fannout_oauth_x=binding-token-value",
  });
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    `${WEB_URL}/connections?oauth=connected&provider=x`,
  );
  assert.match(
    response.headers.get("set-cookie") ?? "",
    /fannout_oauth_x=;.*Expires=Thu, 01 Jan 1970/,
  );

  const [input] = callbacks;
  assert.equal(input?.provider, "x");
  assert.equal(input?.bindingToken, "binding-token-value");
  assert.equal(input?.callbackUrl.searchParams.get("code"), "the-code");
  assert.equal(input?.callbackUrl.searchParams.get("state"), "the-state");
});

test("callback failures redirect with a safe reason; never to another origin", async () => {
  nextCallbackResult = {
    status: "failed",
    provider: "X",
    returnTo: "//evil.test/steal",
    reason: "invalid_state",
  };
  const response = await get("/api/oauth/x/callback?state=s&code=c");
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, WEB_URL);
  assert.equal(location.pathname, "/connections");
  assert.equal(location.searchParams.get("oauth"), "error");
  assert.equal(location.searchParams.get("reason"), "invalid_state");
});

test("callback for YouTube channel selection passes the selection id", async () => {
  nextCallbackResult = {
    status: "select_channel",
    provider: "YOUTUBE",
    returnTo: "/connections",
    selectionId: "22222222-2222-4222-8222-222222222222",
  };
  const response = await get("/api/oauth/youtube/callback?state=s&code=c");
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.searchParams.get("oauth"), "select_channel");
  assert.equal(location.searchParams.get("selection"), "22222222-2222-4222-8222-222222222222");
});

test("callback on an unknown provider redirects with invalid_request", async () => {
  const response = await get("/api/oauth/instagram/callback?state=s&code=c");
  assert.equal(
    new URL(response.headers.get("location")!).searchParams.get("reason"),
    "invalid_request",
  );
  assert.equal(callbacks.length, 0);
});
