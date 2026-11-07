import * as oauth from "oauth4webapi";
import { cachedDiscovery, requireCredentials, splitScopes, stringClaim } from "./shared";
import {
  ProviderIdentityError,
  type OAuthProviderAdapter,
  type ProviderCredentials,
} from "./types";

/**
 * LinkedIn: OAuth 2.0 authorization code + OpenID Connect ("Sign In with
 * LinkedIn using OpenID Connect"). Identity comes from the verified ID token.
 *
 * - Token endpoint expects client_secret_post.
 * - LinkedIn's web-app flow does not document PKCE or `nonce`, so neither is
 *   sent (state + confidential client auth protect the code exchange).
 */
export const LINKEDIN_ISSUER = new URL("https://www.linkedin.com/oauth");

export function createLinkedInProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  return {
    slug: "linkedin",
    provider: "LINKEDIN",
    redirectUri: credentials.redirectUri,
    scopes: splitScopes(credentials.scopes),
    // w_member_social (Share on LinkedIn) is what lets us post for the member.
    requiredScopes: ["openid", "profile", "w_member_social"],
    usePkce: false,
    useNonce: false,
    isOidc: true,
    allowsAccountSelection: false,
    extraAuthorizationParams: {},
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId && credentials.clientSecret),
    getClient: () => ({ client_id: requireCredentials(credentials, "LinkedIn") }),
    getClientAuth: () => oauth.ClientSecretPost(credentials.clientSecret ?? ""),
    getAuthorizationServer: cachedDiscovery(LINKEDIN_ISSUER),

    async resolveAccounts({ idTokenClaims }) {
      if (!idTokenClaims?.sub) throw new ProviderIdentityError("LinkedIn ID token has no subject");
      const name =
        stringClaim(idTokenClaims.name) ??
        ([stringClaim(idTokenClaims.given_name), stringClaim(idTokenClaims.family_name)]
          .filter(Boolean)
          .join(" ") ||
          null);

      return [
        {
          provider: "LINKEDIN",
          providerAccountId: idTokenClaims.sub,
          accountType: "member",
          username: null,
          displayName: name,
          profilePictureUrl: stringClaim(idTokenClaims.picture),
          config: {
            email: stringClaim(idTokenClaims.email),
            emailVerified:
              idTokenClaims.email_verified === true || idTokenClaims.email_verified === "true",
            locale: idTokenClaims.locale ?? null,
          },
        },
      ];
    },
  };
}
