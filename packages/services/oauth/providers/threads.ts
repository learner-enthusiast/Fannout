import * as oauth from "oauth4webapi";
import { z } from "zod";
import { expiryFrom, providerGetJson, requireCredentials, splitScopes } from "./shared";
import type { HttpOptions, OAuthProviderAdapter, ProviderCredentials } from "./types";

/**
 * Threads API (Meta) OAuth 2.0 authorization code flow.
 *
 * - No PKCE or OIDC; state + client_secret_post protect the exchange.
 *   Scopes are comma-separated. Redirect URIs must be HTTPS.
 * - The token endpoint's response has no `token_type`, which oauth4webapi
 *   requires, so `wrapHttp` adds `"bearer"` to that one response.
 * - The 1-hour token is exchanged for a 60-day token (th_exchange_token).
 *   There is no refresh token: the long-lived token renews itself with
 *   th_refresh_token while still valid, so we renew in its last 7 days.
 */
export const THREADS_AUTHORIZATION_SERVER: oauth.AuthorizationServer = {
  issuer: "https://threads.net",
  authorization_endpoint: "https://threads.net/oauth/authorize",
  token_endpoint: "https://graph.threads.net/oauth/access_token",
};

const THREADS_GRAPH = "https://graph.threads.net";
const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

const LongLivedTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

const MeSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().optional(),
  threads_profile_picture_url: z.string().optional(),
});

/** Adds the missing token_type to Threads' code-exchange response. */
function withTokenType(http: HttpOptions): HttpOptions {
  const inner = http[oauth.customFetch] ?? ((url, init) => fetch(url, init as RequestInit));
  return {
    ...http,
    [oauth.customFetch]: async (url, init) => {
      const response = await inner(url, init);
      if (!url.startsWith(THREADS_AUTHORIZATION_SERVER.token_endpoint!) || !response.ok) {
        return response;
      }
      const body = (await response.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ token_type: "bearer", ...body }), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

export function createThreadsProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  const version = credentials.apiVersion ?? "v1.0";
  return {
    slug: "threads",
    provider: "THREADS",
    redirectUri: credentials.redirectUri,
    scopes: splitScopes(credentials.scopes),
    requiredScopes: ["threads_basic"],
    usePkce: false,
    useNonce: false,
    isOidc: false,
    allowsAccountSelection: false,
    extraAuthorizationParams: {},
    scopeSeparator: ",",
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId && credentials.clientSecret),
    getClient: () => ({ client_id: requireCredentials(credentials, "Threads") }),
    getClientAuth: () => oauth.ClientSecretPost(credentials.clientSecret ?? ""),
    getAuthorizationServer: async () => THREADS_AUTHORIZATION_SERVER,
    wrapHttp: withTokenType,

    async upgradeTokens(tokens, http, now) {
      const url = new URL(`${THREADS_GRAPH}/access_token`);
      url.searchParams.set("grant_type", "th_exchange_token");
      url.searchParams.set("client_secret", credentials.clientSecret ?? "");
      url.searchParams.set("access_token", tokens.accessToken);
      const longLived = await providerGetJson(url, http, LongLivedTokenSchema);
      return {
        ...tokens,
        accessToken: longLived.access_token,
        accessExpiry: expiryFrom(longLived.expires_in, now),
      };
    },

    refreshAccessToken: {
      leewayMs: RENEW_WITHIN_MS,
      async run(accessToken, http, now) {
        const url = new URL(`${THREADS_GRAPH}/refresh_access_token`);
        url.searchParams.set("grant_type", "th_refresh_token");
        url.searchParams.set("access_token", accessToken);
        const renewed = await providerGetJson(url, http, LongLivedTokenSchema);
        return {
          accessToken: renewed.access_token,
          refreshToken: null,
          accessExpiry: expiryFrom(renewed.expires_in, now),
          refreshExpiry: null,
          scopes: [],
        };
      },
    },

    async resolveAccounts({ accessToken, http }) {
      const url = new URL(`${THREADS_GRAPH}/${version}/me`);
      url.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
      url.searchParams.set("access_token", accessToken);
      const me = await providerGetJson(url, http, MeSchema);
      return [
        {
          provider: "THREADS",
          providerAccountId: me.id,
          accountType: "user",
          username: me.username,
          displayName: me.name ?? null,
          profilePictureUrl: me.threads_profile_picture_url ?? null,
          config: {},
        },
      ];
    },
  };
}
