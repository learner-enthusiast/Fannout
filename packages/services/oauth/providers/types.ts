import type * as oauth from "oauth4webapi";
import type { ConnectedAccount, OAuthProviderSlug, SocialProvider, TokenSet } from "../model";

/** Options spread into every oauth4webapi call (custom fetch in tests, timeouts). */
export type HttpOptions = {
  [oauth.customFetch]?: (
    url: string,
    options: oauth.CustomFetchOptions<string, unknown>,
  ) => Promise<Response>;
  signal?: (url: string) => AbortSignal;
};

export type ProviderCredentials = {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string;
  scopes: string;
  /** Versioned APIs (Meta Graph API, e.g. "v23.0"). */
  apiVersion?: string;
};

export type ResolveAccountsInput = {
  accessToken: string;
  /** Verified ID token claims (OIDC providers only). */
  idTokenClaims: oauth.IDToken | undefined;
  http: HttpOptions;
};

/**
 * Everything that differs between providers. The shared flow (state, PKCE,
 * code exchange, token storage) lives in the OAuth service.
 */
export interface OAuthProviderAdapter {
  slug: OAuthProviderSlug;
  provider: SocialProvider;
  redirectUri: string;
  scopes: string[];
  /** Scopes that must be granted or the connection is rejected. */
  requiredScopes: string[];
  usePkce: boolean;
  useNonce: boolean;
  /** OIDC providers must return a signed ID token. */
  isOidc: boolean;
  /** May return more than one account per grant (YouTube channels). */
  allowsAccountSelection: boolean;
  extraAuthorizationParams: Record<string, string>;
  /** Joiner for the `scope` parameter. Default " "; Meta uses ",". */
  scopeSeparator?: string;

  /** Adjust HTTP for token-endpoint quirks (e.g. Threads omits token_type). */
  wrapHttp?(http: HttpOptions): HttpOptions;
  /** Post-process code-exchange tokens, e.g. swap for a long-lived token (Meta). */
  upgradeTokens?(tokens: TokenSet, http: HttpOptions, now: Date): Promise<TokenSet>;
  /** Scopes actually granted, for providers whose token response doesn't say. */
  getGrantedScopes?(accessToken: string, http: HttpOptions): Promise<string[]>;
  /**
   * Non-standard refresh that renews the access token itself instead of using
   * a refresh token (Threads). Runs when the token is within `leewayMs` of expiry.
   */
  refreshAccessToken?: {
    leewayMs: number;
    run(accessToken: string, http: HttpOptions, now: Date): Promise<TokenSet>;
  };

  isConfigured(): boolean;
  getClient(): oauth.Client;
  getClientAuth(): oauth.ClientAuth;
  getAuthorizationServer(http: HttpOptions): Promise<oauth.AuthorizationServer>;
  /** Signing-key cache for ID token signature validation. */
  jwksCache: oauth.JWKSCacheInput;
  resolveAccounts(input: ResolveAccountsInput): Promise<ConnectedAccount[]>;
}

export class ProviderIdentityError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderIdentityError";
  }
}
