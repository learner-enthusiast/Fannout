import { and, db, eq, socialConnections } from "@repo/database";
import { errors } from "@repo/errors";
import { env } from "../env";
import { dbOAuthTransactionStore } from "../oauth-transactions";
import { upsertSocialConnection } from "../social-connections";
import { SocialConnectionRowSchema } from "../social-connections/model";
import type { OAuthProviderSlug } from "./model";
import { createProviderRegistry } from "./providers";
import { createOAuthService, type ConnectionStore } from "./service";

/** Postgres-backed connection store used by the OAuth service. */
export const dbConnectionStore: ConnectionStore = {
  async upsert(userId, account, tokens) {
    const row = await upsertSocialConnection({
      userId,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      accountType: account.accountType,
      username: account.username,
      displayName: account.displayName,
      profilePictureUrl: account.profilePictureUrl,
      config: account.config,
      accessTokenEncrypted: tokens.accessTokenEncrypted,
      refreshTokenEncrypted: tokens.refreshTokenEncrypted,
      accessExpiry: tokens.accessExpiry,
      refreshExpiry: tokens.refreshExpiry,
      scopes: tokens.scopes,
      isActive: true,
    });
    return { id: row.id };
  },

  async withLock(userId, connectionId, fn) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(socialConnections)
        .where(and(eq(socialConnections.id, connectionId), eq(socialConnections.userId, userId)))
        .for("update")
        .limit(1);
      if (!row) return errors.notFound("Social connection");
      return fn(SocialConnectionRowSchema.parse(row), async (patch) => {
        await tx
          .update(socialConnections)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(socialConnections.id, connectionId));
      });
    });
  },
};

export const providers = createProviderRegistry({
  linkedin: {
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
    redirectUri: env.LINKEDIN_REDIRECT_URI,
    scopes: env.LINKEDIN_SCOPES,
  },
  x: {
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
    redirectUri: env.X_REDIRECT_URI,
    scopes: env.X_SCOPES,
  },
  youtube: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    scopes: env.YOUTUBE_SCOPES,
  },
  facebook: {
    clientId: env.FACEBOOK_CLIENT_ID,
    clientSecret: env.FACEBOOK_CLIENT_SECRET,
    redirectUri: env.FACEBOOK_REDIRECT_URI,
    scopes: env.FACEBOOK_SCOPES,
    apiVersion: env.FACEBOOK_GRAPH_VERSION,
  },
  threads: {
    clientId: env.THREADS_CLIENT_ID,
    clientSecret: env.THREADS_CLIENT_SECRET,
    redirectUri: env.THREADS_REDIRECT_URI,
    scopes: env.THREADS_SCOPES,
  },
});

export const oauthService = createOAuthService({
  providers,
  transactions: dbOAuthTransactionStore,
  connections: dbConnectionStore,
  encryptionKey: env.TOKEN_ENCRYPTION_KEY,
});

export const {
  startConnection: startOAuthConnection,
  handleCallback: handleOAuthCallback,
  getChannelSelection,
  finalizeChannelSelection,
  getValidAccessToken,
} = oauthService;

/** Which providers have credentials set (drives the UI's connect buttons). */
export function getConfiguredProviders(): Record<OAuthProviderSlug, boolean> {
  return {
    linkedin: providers.linkedin.isConfigured(),
    x: providers.x.isConfigured(),
    youtube: providers.youtube.isConfigured(),
    facebook: providers.facebook.isConfigured(),
    threads: providers.threads.isConfigured(),
  };
}

export { createOAuthService, describeOAuthError, OAUTH_TRANSACTION_TTL_MS } from "./service";
export type {
  ConnectionStore,
  OAuthService,
  OAuthServiceDeps,
  HandleCallbackInput,
} from "./service";
