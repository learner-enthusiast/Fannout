import * as oauth from "oauth4webapi";
import { z } from "zod";
import { requireCredentials, splitScopes } from "./shared";
import {
  ProviderIdentityError,
  type OAuthProviderAdapter,
  type ProviderCredentials,
} from "./types";

/**
 * X (Twitter): OAuth 2.0 authorization code + PKCE (S256). Not OIDC, so the
 * identity comes from GET /2/users/me with the new access token.
 * Confidential clients authenticate with HTTP Basic; public clients (no
 * secret) send only client_id. Refresh tokens rotate on every refresh.
 */
export const X_AUTHORIZATION_SERVER: oauth.AuthorizationServer = {
  issuer: "https://x.com",
  authorization_endpoint: "https://x.com/i/oauth2/authorize",
  token_endpoint: "https://api.x.com/2/oauth2/token",
  revocation_endpoint: "https://api.x.com/2/oauth2/revoke",
};

export const X_ME_URL = "https://api.x.com/2/users/me?user.fields=profile_image_url";

const XMeResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    username: z.string().min(1),
    profile_image_url: z.string().optional(),
  }),
});

export function createXProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  return {
    slug: "x",
    provider: "X",
    redirectUri: credentials.redirectUri,
    scopes: splitScopes(credentials.scopes),
    requiredScopes: ["users.read", "tweet.read"],
    usePkce: true,
    useNonce: false,
    isOidc: false,
    allowsAccountSelection: false,
    extraAuthorizationParams: {},
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId),
    getClient: () => ({ client_id: requireCredentials(credentials, "X") }),
    getClientAuth: () =>
      credentials.clientSecret ? oauth.ClientSecretBasic(credentials.clientSecret) : oauth.None(),
    getAuthorizationServer: async () => X_AUTHORIZATION_SERVER,

    async resolveAccounts({ accessToken, http }) {
      const response = await oauth.protectedResourceRequest(
        accessToken,
        "GET",
        new URL(X_ME_URL),
        undefined,
        undefined,
        http,
      );
      if (!response.ok) {
        throw new ProviderIdentityError("X user lookup failed", response.status);
      }
      const parsed = XMeResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderIdentityError("Unexpected X user lookup response");
      const user = parsed.data.data;

      return [
        {
          provider: "X",
          providerAccountId: user.id,
          accountType: "user",
          username: user.username,
          displayName: user.name ?? null,
          // `_normal` is 48px; ask for the 400px variant instead.
          profilePictureUrl: user.profile_image_url?.replace("_normal.", "_400x400.") ?? null,
          config: {},
        },
      ];
    },
  };
}
