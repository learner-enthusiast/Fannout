import { createHmac } from "node:crypto";
import * as oauth from "oauth4webapi";
import { z } from "zod";
import { expiryFrom, providerGetJson, requireCredentials, splitScopes } from "./shared";
import type { OAuthProviderAdapter, ProviderCredentials } from "./types";

/**
 * Facebook Login (manual OAuth 2.0 flow) for publishing to Facebook Pages.
 *
 * - Authorization code + PKCE S256, client_secret_post at the Graph token endpoint.
 * - The short-lived user token is swapped for a long-lived one
 *   (grant_type=fb_exchange_token); Page tokens derived from it don't expire.
 * - Facebook returns no `scope` in the token response and users can untick
 *   permissions, so granted permissions are read from /me/permissions.
 * - Each Page is its own connection (provider_account_id = Page id) and stores
 *   its own Page access token. The Facebook user is kept in config.facebookUser.
 *   Several Pages → the user picks which to connect.
 * - Graph calls with the user token send appsecret_proof.
 */
export const DEFAULT_GRAPH_VERSION = "v23.0";

const LongLivedTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

const PermissionsSchema = z.object({
  data: z.array(z.object({ permission: z.string(), status: z.string() })),
});

const MeSchema = z.object({ id: z.string().min(1), name: z.string().optional() });

const PagesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      access_token: z.string().min(1).optional(),
      category: z.string().optional(),
      tasks: z.array(z.string()).optional(),
      picture: z.object({ data: z.object({ url: z.string().optional() }) }).optional(),
    }),
  ),
});

export function facebookAuthorizationServer(version: string): oauth.AuthorizationServer {
  return {
    issuer: "https://www.facebook.com",
    authorization_endpoint: `https://www.facebook.com/${version}/dialog/oauth`,
    token_endpoint: `https://graph.facebook.com/${version}/oauth/access_token`,
  };
}

export function createFacebookProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  const version = credentials.apiVersion ?? DEFAULT_GRAPH_VERSION;
  const as = facebookAuthorizationServer(version);
  const graph = (path: string, accessToken: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://graph.facebook.com/${version}${path}`);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", credentials.clientSecret ?? "")
        .update(accessToken)
        .digest("hex"),
    );
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };

  return {
    slug: "facebook",
    provider: "FACEBOOK",
    redirectUri: credentials.redirectUri,
    scopes: splitScopes(credentials.scopes),
    requiredScopes: ["pages_show_list"],
    usePkce: true,
    useNonce: false,
    isOidc: false,
    allowsAccountSelection: true,
    extraAuthorizationParams: {},
    scopeSeparator: ",",
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId && credentials.clientSecret),
    getClient: () => ({ client_id: requireCredentials(credentials, "Facebook") }),
    getClientAuth: () => oauth.ClientSecretPost(credentials.clientSecret ?? ""),
    getAuthorizationServer: async () => as,

    async upgradeTokens(tokens, http, now) {
      const url = new URL(as.token_endpoint!);
      url.searchParams.set("grant_type", "fb_exchange_token");
      url.searchParams.set("client_id", requireCredentials(credentials, "Facebook"));
      url.searchParams.set("client_secret", credentials.clientSecret ?? "");
      url.searchParams.set("fb_exchange_token", tokens.accessToken);
      const longLived = await providerGetJson(url, http, LongLivedTokenSchema);
      return {
        ...tokens,
        accessToken: longLived.access_token,
        accessExpiry: expiryFrom(longLived.expires_in, now),
      };
    },

    async getGrantedScopes(accessToken, http) {
      const { data } = await providerGetJson(
        graph("/me/permissions", accessToken),
        http,
        PermissionsSchema,
      );
      return data.filter((p) => p.status === "granted").map((p) => p.permission);
    },

    async resolveAccounts({ accessToken, http }) {
      const me = await providerGetJson(
        graph("/me", accessToken, { fields: "id,name" }),
        http,
        MeSchema,
      );
      const pages = await providerGetJson(
        graph("/me/accounts", accessToken, {
          fields: "id,name,access_token,category,tasks,picture{url}",
          limit: "100",
        }),
        http,
        PagesSchema,
      );

      return pages.data
        .filter((page) => page.access_token)
        .map((page) => ({
          provider: "FACEBOOK" as const,
          providerAccountId: page.id,
          accountType: "facebook_page",
          username: null,
          displayName: page.name ?? null,
          profilePictureUrl: page.picture?.data.url ?? null,
          config: {
            facebookUser: { id: me.id, name: me.name ?? null },
            page: { id: page.id, category: page.category ?? null, tasks: page.tasks ?? [] },
          },
          accessToken: page.access_token,
        }));
    },
  };
}
