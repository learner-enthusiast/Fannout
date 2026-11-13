import * as oauth from "oauth4webapi";
import { z } from "zod";
import { INSTAGRAM_API_VERSION, INSTAGRAM_SCOPES } from "@repo/providers/instagram";
import { providerGetJson, requireCredentials } from "./shared";
import type { HttpOptions, OAuthProviderAdapter, ProviderCredentials } from "./types";

/**
 * Instagram API with Unified Login (Meta app + Facebook Login for Business configuration).
 *
 * - Authorize at facebook.com/dialog/oauth with `config_id` (never `scope`) and prompt=login.
 * - One code exchange on the Graph token endpoint. There is NO long-lived exchange, NO refresh
 *   token and NO graph.instagram.com: the business-integration system-user (bisu) token is used
 *   as is. A missing/zero `expires_in` means it never expires (access_expiry = null).
 * - Accounts come from /me/assigned_instagram_accounts (paged). `/me`.id is the system user,
 *   never an Instagram account, so it is never stored as provider_account_id.
 * - One connection per shared account, all sharing the same encrypted token.
 * - Graph calls here use `Authorization: Bearer`; only /debug_token takes the app token in the query.
 */
const GRAPH = "https://graph.facebook.com";
const MAX_ACCOUNT_PAGES = 50;
const EXPECTED_SCOPES = [INSTAGRAM_SCOPES.basic, INSTAGRAM_SCOPES.contentPublish, INSTAGRAM_SCOPES.manageInsights];

const DebugTokenSchema = z.object({
  data: z.object({ scopes: z.array(z.string()).optional(), expires_at: z.number().optional(), is_valid: z.boolean().optional() }),
});
const MeSchema = z.object({ id: z.string().min(1), client_business_id: z.string().optional() });
const AssignedSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), username: z.string().optional() })),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});
const AccountSchema = z.object({
  id: z.string().min(1),
  username: z.string().optional(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  followers_count: z.number().optional(),
  media_count: z.number().optional(),
});

export function instagramAuthorizationServer(version: string): oauth.AuthorizationServer {
  return {
    issuer: "https://www.facebook.com",
    authorization_endpoint: "https://www.facebook.com/dialog/oauth",
    token_endpoint: `${GRAPH}/${version}/oauth/access_token`,
  };
}

export function createInstagramProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  const version = credentials.apiVersion ?? INSTAGRAM_API_VERSION;
  const as = instagramAuthorizationServer(version);
  const configId = credentials.configId ?? "";
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const graph = (path: string, params: Record<string, string> = {}) => {
    const url = new URL(`${GRAPH}/${version}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };

  /** Best effort: if /debug_token fails, callers fall back to the configuration's expected scopes. */
  async function debugToken(accessToken: string, http: HttpOptions) {
    try {
      const url = graph("/debug_token", {
        input_token: accessToken,
        access_token: `${credentials.clientId}|${credentials.clientSecret}`,
      });
      return (await providerGetJson(url, http, DebugTokenSchema)).data;
    } catch {
      return null;
    }
  }

  return {
    slug: "instagram",
    provider: "INSTAGRAM",
    redirectUri: credentials.redirectUri,
    scopes: EXPECTED_SCOPES,
    requiredScopes: [INSTAGRAM_SCOPES.basic, INSTAGRAM_SCOPES.contentPublish],
    usePkce: false,
    useNonce: false,
    isOidc: false,
    allowsAccountSelection: false,
    connectsAllAccounts: true,
    omitScopeParam: true,
    extraAuthorizationParams: { config_id: configId, prompt: "login" },
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId && credentials.clientSecret && configId),
    getClient: () => ({ client_id: requireCredentials(credentials, "Instagram") }),
    getClientAuth: () => oauth.ClientSecretPost(credentials.clientSecret ?? ""),
    getAuthorizationServer: async () => as,

    // No exchange: only normalise "expires_in: 0" (never expires) to a null expiry.
    async upgradeTokens(tokens, _http, now) {
      const expiry = tokens.accessExpiry;
      return expiry && expiry.getTime() <= now.getTime() ? { ...tokens, accessExpiry: null } : tokens;
    },

    async getGrantedScopes(accessToken, http) {
      const debug = await debugToken(accessToken, http);
      return debug?.scopes?.length ? debug.scopes : EXPECTED_SCOPES;
    },

    async resolveAccounts({ accessToken, http }) {
      const debug = await debugToken(accessToken, http);
      const scopesSource = debug?.scopes?.length ? "debug_token" : "configuration";

      // `id` here is the system user, NOT an Instagram account.
      const me = await providerGetJson(graph("/me", { fields: "client_business_id" }), http, MeSchema, bearer(accessToken));

      const assigned = new Map<string, { id: string; username?: string }>();
      let after: string | undefined;
      for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
        const result = await providerGetJson(
          graph("/me/assigned_instagram_accounts", { fields: "id,username", ...(after ? { after } : {}) }),
          http,
          AssignedSchema,
          bearer(accessToken),
        );
        if (result.data.length === 0) break;
        for (const item of result.data) assigned.set(item.id, item);
        after = result.paging?.cursors?.after;
        if (!after || !result.paging?.next) break;
      }

      const accounts = [];
      for (const item of assigned.values()) {
        // A profile lookup that fails must not drop an account the user shared.
        const profile = await providerGetJson(
          graph(`/${item.id}`, { fields: "id,username,name,profile_picture_url,followers_count,media_count" }),
          http,
          AccountSchema,
          bearer(accessToken),
        ).catch(() => null);
        accounts.push({
          provider: "INSTAGRAM" as const,
          providerAccountId: item.id,
          accountType: "professional",
          username: profile?.username ?? item.username ?? null,
          displayName: profile?.name ?? null,
          profilePictureUrl: profile?.profile_picture_url ?? null,
          config: {
            clientBusinessId: me.client_business_id ?? null,
            configId,
            tokenType: "bisu",
            scopesSource,
          },
        });
      }
      return accounts;
    },
  };
}
