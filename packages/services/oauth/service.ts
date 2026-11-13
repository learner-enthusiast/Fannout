import * as oauth from "oauth4webapi";
import { AppError, ErrorCode } from "@repo/errors";
import { logger } from "@repo/logger";
import type { SocialConnectionRow } from "../social-connections/model";
import type { OAuthTransactionStore } from "../oauth-transactions/model";
import {
  ChannelSelectionSchema,
  DEFAULT_RETURN_TO,
  FinalizeChannelSelectionInputSchema,
  OAuthProviderSlugSchema,
  PendingSelectionPayloadSchema,
  StartConnectionInputSchema,
  type ChannelSelection,
  type ConnectedAccount,
  type FinalizeChannelSelectionInput,
  type OAuthCallbackResult,
  type OAuthFailureReason,
  type OAuthProviderSlug,
  type SocialProvider,
  type StartConnectionInput,
  type StartConnectionResult,
  type TokenSet,
} from "./model";
import type { HttpOptions, OAuthProviderAdapter, ProviderRegistry } from "./providers";
import { ProviderIdentityError } from "./providers";
import { splitScopes } from "./providers/shared";
import {
  decryptSecret,
  encryptSecret,
  matchesHash,
  parseEncryptionKey,
  sha256,
} from "./token-encryption";

export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
/** Keep expired rows a day so a late callback reports "expired", not "invalid". */
const EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Refresh access tokens this long before they expire. */
const REFRESH_LEEWAY_MS = 60 * 1000;
const HTTP_TIMEOUT_MS = 10 * 1000;

export type EncryptedTokenPatch = {
  accessTokenEncrypted: string | null;
  /** undefined = keep the stored refresh token. */
  refreshTokenEncrypted?: string | null;
  accessExpiry: Date | null;
  refreshExpiry?: Date | null;
  scopes?: string[];
};

export interface ConnectionStore {
  upsert(
    userId: string,
    account: ConnectedAccount,
    tokens: EncryptedTokenPatch,
  ): Promise<{ id: string }>;
  /** Run `fn` holding an exclusive lock on the connection row (serialises refreshes). */
  withLock<T>(
    userId: string,
    connectionId: string,
    fn: (
      row: SocialConnectionRow,
      save: (patch: EncryptedTokenPatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
}

export type OAuthServiceDeps = {
  providers: ProviderRegistry;
  transactions: OAuthTransactionStore;
  connections: ConnectionStore;
  /** Base64 32-byte key; validated on first use so the app can boot without OAuth configured. */
  encryptionKey: string | undefined;
  /** Overrides fetch for every provider call (tests). */
  fetch?: HttpOptions[typeof oauth.customFetch];
  now?: () => Date;
};

export type HandleCallbackInput = {
  provider: OAuthProviderSlug;
  /** Full callback URL including the query string. */
  callbackUrl: URL;
  /** Value of the browser-binding cookie, if the browser sent one. */
  bindingToken: string | undefined;
  /** App user id from an authenticated session on the callback request, if any. */
  sessionUserId?: string | null;
};

const ID_TOKEN_ERROR_CODES = new Set<string>([
  oauth.JWT_CLAIM_COMPARISON,
  oauth.JWT_TIMESTAMP_CHECK,
  oauth.KEY_SELECTION,
]);

/** Loggable error summary: never includes response bodies, tokens or codes. */
export function describeOAuthError(error: unknown): Record<string, unknown> {
  if (error instanceof oauth.ResponseBodyError) {
    return { name: error.name, code: error.code, oauthError: error.error, status: error.status };
  }
  if (error instanceof oauth.AuthorizationResponseError) {
    return { name: error.name, code: error.code, oauthError: error.error };
  }
  if (error instanceof oauth.WWWAuthenticateChallengeError) {
    return { name: error.name, code: error.code, status: error.status };
  }
  if (error instanceof oauth.OperationProcessingError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  if (error instanceof ProviderIdentityError) {
    return { name: error.name, message: error.message, status: error.status };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: typeof error };
}

function reconnectRequired(): AppError {
  return new AppError({
    code: ErrorCode.CONFLICT,
    message: "This account needs to be reconnected",
    details: { reason: "reconnect_required" },
  });
}

export function createOAuthService(deps: OAuthServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const http: HttpOptions = {
    signal: () => AbortSignal.timeout(HTTP_TIMEOUT_MS),
    ...(deps.fetch ? { [oauth.customFetch]: deps.fetch } : {}),
  };
  const encryptionKey = () => parseEncryptionKey(deps.encryptionKey);

  function adapterFor(provider: SocialProvider): OAuthProviderAdapter {
    const adapter = Object.values(deps.providers).find((p) => p.provider === provider);
    if (!adapter) throw new Error(`Unknown provider ${provider}`);
    return adapter;
  }

  function toTokenSet(
    adapter: OAuthProviderAdapter,
    response: oauth.TokenEndpointResponse,
    issuedAt: Date,
  ): TokenSet {
    const granted = splitScopes(response.scope);
    const refreshTtl = response.refresh_token_expires_in;
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      accessExpiry:
        typeof response.expires_in === "number"
          ? new Date(issuedAt.getTime() + response.expires_in * 1000)
          : null,
      refreshExpiry:
        typeof refreshTtl === "number" ? new Date(issuedAt.getTime() + refreshTtl * 1000) : null,
      // RFC 6749 §5.1: an omitted scope means "as requested".
      scopes: granted.length > 0 ? granted : adapter.scopes,
    };
  }

  function encryptTokens(tokens: TokenSet): EncryptedTokenPatch {
    const key = encryptionKey();
    return {
      accessTokenEncrypted: encryptSecret(tokens.accessToken, key),
      // Providers that don't re-issue a refresh token keep the stored one.
      refreshTokenEncrypted: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken, key)
        : undefined,
      accessExpiry: tokens.accessExpiry,
      refreshExpiry: tokens.refreshToken ? tokens.refreshExpiry : undefined,
      scopes: tokens.scopes,
    };
  }

  async function persistAccounts(userId: string, accounts: ConnectedAccount[], tokens: TokenSet) {
    const shared = encryptTokens(tokens);
    const ids: string[] = [];
    for (const { accessToken, ...account } of accounts) {
      // Accounts with their own token (Facebook Pages) don't use the grant's
      // token; Page tokens from a long-lived user token don't expire.
      const patch: EncryptedTokenPatch = accessToken
        ? {
            accessTokenEncrypted: encryptSecret(accessToken, encryptionKey()),
            refreshTokenEncrypted: null,
            accessExpiry: null,
            refreshExpiry: null,
            scopes: tokens.scopes,
          }
        : shared;
      const { id } = await deps.connections.upsert(userId, account, patch);
      ids.push(id);
    }
    return ids;
  }

  // ---------- 1. start ----------

  async function startConnection(input: StartConnectionInput): Promise<StartConnectionResult> {
    const { userId, provider: slug, returnTo } = StartConnectionInputSchema.parse(input);
    const adapter = deps.providers[slug];
    if (!adapter.isConfigured()) {
      throw new AppError({ code: ErrorCode.BAD_REQUEST, message: `${slug} is not configured` });
    }
    const key = encryptionKey();
    const as = await adapter.getAuthorizationServer(http);
    if (!as.authorization_endpoint) throw new Error(`${slug} has no authorization endpoint`);

    const state = oauth.generateRandomState();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = adapter.useNonce ? oauth.generateRandomNonce() : null;
    const bindingToken = oauth.generateRandomState();
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + OAUTH_TRANSACTION_TTL_MS);

    await deps.transactions
      .deleteExpired(new Date(issuedAt.getTime() - EXPIRED_RETENTION_MS))
      .catch((error) =>
        logger.error("OAuth transaction cleanup failed", describeOAuthError(error)),
      );

    await deps.transactions.create({
      stateHash: sha256(state),
      userId,
      provider: adapter.provider,
      codeVerifierEncrypted: encryptSecret(codeVerifier, key),
      nonce,
      browserBindingHash: sha256(bindingToken),
      returnTo,
      expiresAt,
    });

    const url = new URL(as.authorization_endpoint);
    url.searchParams.set("client_id", adapter.getClient().client_id);
    url.searchParams.set("redirect_uri", adapter.redirectUri);
    url.searchParams.set("response_type", "code");
    if (!adapter.omitScopeParam) url.searchParams.set("scope", adapter.scopes.join(adapter.scopeSeparator ?? " "));
    url.searchParams.set("state", state);
    if (adapter.usePkce) {
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    if (nonce) url.searchParams.set("nonce", nonce);
    for (const [name, value] of Object.entries(adapter.extraAuthorizationParams)) {
      url.searchParams.set(name, value);
    }

    return { authorizationUrl: url.href, bindingToken, expiresAt };
  }

  // ---------- 2. callback ----------

  async function handleCallback(input: HandleCallbackInput): Promise<OAuthCallbackResult> {
    const adapter = deps.providers[OAuthProviderSlugSchema.parse(input.provider)];
    const provider = adapter.provider;
    let returnTo = DEFAULT_RETURN_TO;

    const fail = (reason: OAuthFailureReason, error?: unknown): OAuthCallbackResult => {
      const meta = { provider, reason, ...(error ? describeOAuthError(error) : {}) };
      if (reason === "server_error") logger.error("OAuth callback failed", meta);
      else logger.info("OAuth callback rejected", meta);
      return { status: "failed", provider, returnTo, reason };
    };

    const params = input.callbackUrl.searchParams;
    const state = params.get("state");
    if (!state || state.length > 512) {
      const providerError = params.get("error");
      if (providerError)
        return fail(providerError === "access_denied" ? "access_denied" : "provider_error");
      return fail("invalid_request");
    }

    const stateHash = sha256(state);
    const currentTime = now();
    const transaction = await deps.transactions.consume(stateHash, currentTime);
    if (!transaction) {
      const existing = await deps.transactions.findByStateHash(stateHash);
      if (existing?.provider === provider) returnTo = existing.returnTo;
      const expired =
        existing?.status === "pending" && existing.expiresAt.getTime() <= currentTime.getTime();
      return fail(expired ? "expired_state" : "invalid_state");
    }
    returnTo = transaction.returnTo;

    if (transaction.provider !== provider) return fail("invalid_state");
    // The browser finishing the flow must be the one that started it.
    if (!input.bindingToken || !matchesHash(input.bindingToken, transaction.browserBindingHash)) {
      return fail("session_mismatch");
    }
    if (input.sessionUserId && input.sessionUserId !== transaction.userId) {
      return fail("session_mismatch");
    }

    try {
      const as = await adapter.getAuthorizationServer(http);
      const client = adapter.getClient();
      const tokenHttp = adapter.wrapHttp?.(http) ?? http;

      let callbackParameters: URLSearchParams;
      try {
        callbackParameters = oauth.validateAuthResponse(as, client, params, state);
      } catch (error) {
        if (error instanceof oauth.AuthorizationResponseError) {
          return fail(error.error === "access_denied" ? "access_denied" : "provider_error", error);
        }
        return fail("invalid_request", error);
      }
      if (!callbackParameters.get("code")) return fail("invalid_request");

      const codeVerifier = decryptSecret(transaction.codeVerifierEncrypted, encryptionKey());
      let tokenResponse: oauth.TokenEndpointResponse;
      let rawResponse: Response;
      try {
        rawResponse = await oauth.authorizationCodeGrantRequest(
          as,
          client,
          adapter.getClientAuth(),
          callbackParameters,
          adapter.redirectUri,
          // LinkedIn's web flow doesn't document PKCE; see providers/linkedin.ts.
          adapter.usePkce ? codeVerifier : oauth.nopkce,
          tokenHttp,
        );
        tokenResponse = await oauth.processAuthorizationCodeResponse(as, client, rawResponse, {
          expectedNonce: transaction.nonce ?? oauth.expectNoNonce,
          requireIdToken: adapter.isOidc,
        });
      } catch (error) {
        const idTokenProblem =
          error instanceof oauth.OperationProcessingError &&
          ID_TOKEN_ERROR_CODES.has(error.code ?? "");
        return fail(idTokenProblem ? "id_token_invalid" : "token_exchange_failed", error);
      }

      if (adapter.isOidc) {
        // iss/aud/exp/nonce were checked above; also verify the JWS signature against the JWKS.
        try {
          await oauth.validateApplicationLevelSignature(as, rawResponse, {
            ...http,
            [oauth.jwksCache]: adapter.jwksCache,
          });
        } catch (error) {
          return fail("id_token_invalid", error);
        }
      }

      let tokens = toTokenSet(adapter, tokenResponse, currentTime);
      if (adapter.upgradeTokens) {
        try {
          tokens = await adapter.upgradeTokens(tokens, http, currentTime);
        } catch (error) {
          return fail("token_exchange_failed", error);
        }
      }
      if (adapter.getGrantedScopes) {
        try {
          tokens = { ...tokens, scopes: await adapter.getGrantedScopes(tokens.accessToken, http) };
        } catch (error) {
          return fail("identity_failed", error);
        }
      }
      if (adapter.requiredScopes.some((scope) => !tokens.scopes.includes(scope))) {
        return fail("insufficient_scope");
      }

      let accounts: ConnectedAccount[];
      try {
        accounts = await adapter.resolveAccounts({
          accessToken: tokens.accessToken,
          idTokenClaims: oauth.getValidatedIdTokenClaims(tokenResponse),
          http,
        });
      } catch (error) {
        return fail("identity_failed", error);
      }
      if (accounts.length === 0) return fail("no_account");

      if (adapter.connectsAllAccounts) {
        const connectionIds = await persistAccounts(transaction.userId, accounts, tokens);
        return { status: "connected", provider, returnTo, connectionIds };
      }

      if (accounts.length > 1 && adapter.allowsAccountSelection) {
        const payload = PendingSelectionPayloadSchema.parse({ tokens, accounts });
        await deps.transactions.markAwaitingSelection(
          transaction.id,
          encryptSecret(JSON.stringify(payload), encryptionKey()),
          new Date(currentTime.getTime() + OAUTH_TRANSACTION_TTL_MS),
        );
        return { status: "select_channel", provider, returnTo, selectionId: transaction.id };
      }

      const connectionIds = await persistAccounts(transaction.userId, accounts.slice(0, 1), tokens);
      return { status: "connected", provider, returnTo, connectionIds };
    } catch (error) {
      return fail("server_error", error);
    }
  }

  // ---------- 3. account selection (YouTube channels, Facebook Pages) ----------

  async function readSelection(userId: string, selectionId: string) {
    const row = await deps.transactions.getAwaitingSelection(selectionId, userId, now());
    if (!row?.pendingPayloadEncrypted) {
      throw new AppError({
        code: ErrorCode.NOT_FOUND,
        message: "Channel selection not found or expired",
      });
    }
    const payload = PendingSelectionPayloadSchema.parse(
      JSON.parse(decryptSecret(row.pendingPayloadEncrypted, encryptionKey())),
    );
    return { row, payload };
  }

  async function getChannelSelection(
    userId: string,
    selectionId: string,
  ): Promise<ChannelSelection> {
    const { row, payload } = await readSelection(userId, selectionId);
    const config = payload.accounts[0]?.config as
      | { google?: { email?: string | null }; facebookUser?: { name?: string | null } }
      | undefined;
    return ChannelSelectionSchema.parse({
      id: row.id,
      provider: row.provider,
      accountLabel: config?.google?.email ?? config?.facebookUser?.name ?? null,
      expiresAt: row.expiresAt,
      channels: payload.accounts.map((account) => ({
        id: account.providerAccountId,
        title: account.displayName,
        handle: account.username,
        thumbnailUrl: account.profilePictureUrl,
      })),
    });
  }

  async function finalizeChannelSelection(
    userId: string,
    input: FinalizeChannelSelectionInput,
  ): Promise<{ connectionIds: string[] }> {
    const { selectionId, channelIds } = FinalizeChannelSelectionInputSchema.parse(input);
    const { payload } = await readSelection(userId, selectionId);
    const chosen = payload.accounts.filter((a) => channelIds.includes(a.providerAccountId));
    if (chosen.length !== new Set(channelIds).size) {
      throw new AppError({ code: ErrorCode.BAD_REQUEST, message: "Unknown channel selected" });
    }
    // Atomic claim: a double-submit only connects once.
    const claimed = await deps.transactions.completeSelection(selectionId, userId, now());
    if (!claimed) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "Channel selection was already completed",
      });
    }
    return { connectionIds: await persistAccounts(userId, chosen, payload.tokens) };
  }

  // ---------- 4. access tokens & refresh ----------

  /**
   * Returns a usable access token, refreshing it first when it is about to
   * expire. Runs under a row lock so concurrent callers don't both spend a
   * rotating refresh token (X invalidates the old one on use).
   */
  async function getValidAccessToken(userId: string, connectionId: string): Promise<string> {
    return deps.connections.withLock(userId, connectionId, async (row, save) => {
      if (!row.isActive || !row.accessTokenEncrypted) throw reconnectRequired();
      const key = encryptionKey();
      const currentTime = now();
      const adapter = adapterFor(row.provider as SocialProvider);
      const selfRefresh = adapter.refreshAccessToken;
      const leeway = selfRefresh?.leewayMs ?? REFRESH_LEEWAY_MS;
      const current = decryptSecret(row.accessTokenEncrypted, key);
      if (!row.accessExpiry || row.accessExpiry.getTime() - currentTime.getTime() > leeway) {
        return current;
      }
      const expired = row.accessExpiry.getTime() <= currentTime.getTime();

      if (selfRefresh) {
        // Token renews itself; only possible while it's still valid.
        if (expired) throw reconnectRequired();
        try {
          const renewed = await selfRefresh.run(current, http, currentTime);
          await save({
            accessTokenEncrypted: encryptSecret(renewed.accessToken, key),
            accessExpiry: renewed.accessExpiry,
          });
          return renewed.accessToken;
        } catch (error) {
          logger.info("OAuth token renewal failed", {
            provider: row.provider,
            ...describeOAuthError(error),
          });
          return current; // still valid; try again on a later call
        }
      }

      if (!row.refreshTokenEncrypted) {
        if (expired) throw reconnectRequired();
        return current;
      }

      const as = await adapter.getAuthorizationServer(http);
      const client = adapter.getClient();
      let response: oauth.TokenEndpointResponse;
      try {
        const raw = await oauth.refreshTokenGrantRequest(
          as,
          client,
          adapter.getClientAuth(),
          decryptSecret(row.refreshTokenEncrypted, key),
          http,
        );
        response = await oauth.processRefreshTokenResponse(as, client, raw);
      } catch (error) {
        logger.info("OAuth token refresh failed", {
          provider: row.provider,
          ...describeOAuthError(error),
        });
        if (error instanceof oauth.ResponseBodyError && error.error === "invalid_grant") {
          await save({
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            accessExpiry: null,
            refreshExpiry: null,
          });
          throw reconnectRequired();
        }
        throw error;
      }

      const tokens = toTokenSet(adapter, response, currentTime);
      await save(encryptTokens(tokens));
      return tokens.accessToken;
    });
  }

  return {
    startConnection,
    handleCallback,
    getChannelSelection,
    finalizeChannelSelection,
    getValidAccessToken,
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
