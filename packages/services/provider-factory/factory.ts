import {
  FacebookProvider,
  LinkedInProvider,
  ThreadsProvider,
  XProvider,
  YouTubeProvider,
  type AnySocialProvider,
  type BaseProviderConfig,
  type TokenProvider,
} from "@repo/providers";
import { AppError, ErrorCode } from "@repo/errors";
import { z } from "zod";
import type { SocialConnectionRow } from "../social-connections/model";

export interface ProviderFactoryDeps {
  /** Must scope by userId — this is the ownership check. */
  getConnection(userId: string, connectionId: string): Promise<SocialConnectionRow | null>;
  /** Decrypts the stored token, refreshing it first when it is near expiry. */
  getValidAccessToken(userId: string, connectionId: string): Promise<string>;
  facebook: { appSecret?: string; graphVersion?: string };
  /** Shared provider options (tests inject fetch / sleep). */
  providerOptions?: Omit<BaseProviderConfig, "accessToken">;
}

export const CreateProviderInputSchema = z.object({
  userId: z.uuid(),
  connectionId: z.uuid(),
});
export type CreateProviderInput = z.input<typeof CreateProviderInputSchema>;

const YouTubeConfigSchema = z.looseObject({ google: z.looseObject({ sub: z.string() }).optional() });

function reconnectRequired(): AppError {
  return new AppError({
    code: ErrorCode.CONFLICT,
    message: "This account needs to be reconnected",
    details: { reason: "reconnect_required" },
  });
}

/**
 * Lazily supplies tokens from the OAuth service. After a 401 the provider asks
 * for a refresh; we re-read the token and report failure (null) when it didn't
 * change, so the 401 surfaces instead of looping.
 */
function connectionTokenSource(deps: ProviderFactoryDeps, userId: string, connectionId: string): TokenProvider {
  let last: string | null = null;
  return {
    async getAccessToken() {
      last = await deps.getValidAccessToken(userId, connectionId);
      return last;
    },
    async refreshAccessToken() {
      const next = await deps.getValidAccessToken(userId, connectionId);
      if (next === last) return null;
      last = next;
      return next;
    },
  };
}

/**
 * Builds the right provider class for a user's social connection.
 * Provider classes never query the database; everything they need comes from here.
 */
export function createProviderFactory(deps: ProviderFactoryDeps) {
  async function createProviderForConnection(input: CreateProviderInput): Promise<AnySocialProvider> {
    const { userId, connectionId } = CreateProviderInputSchema.parse(input);
    const row = await deps.getConnection(userId, connectionId);
    if (!row) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Social connection not found" });
    }
    if (!row.isActive || !row.accessTokenEncrypted) throw reconnectRequired();

    const base = { ...deps.providerOptions, accessToken: connectionTokenSource(deps, userId, connectionId) };

    switch (row.provider) {
      case "LINKEDIN":
        return new LinkedInProvider(base);
      case "X":
        return new XProvider({ ...base, userId: row.providerAccountId });
      case "YOUTUBE": {
        // The connection is the channel; config.google.sub is the Google account that granted access.
        const config = YouTubeConfigSchema.safeParse(row.config ?? {});
        return new YouTubeProvider({
          ...base,
          channelId: row.providerAccountId,
          googleSubject: config.success ? config.data.google?.sub : undefined,
        });
      }
      case "THREADS":
        // Threads user token + Threads user id (never a Facebook Page token).
        return new ThreadsProvider({ ...base, userId: row.providerAccountId });
      case "FACEBOOK":
        // The connection is one Page and stores that Page's access token.
        return new FacebookProvider({
          ...base,
          pageId: row.providerAccountId,
          appSecret: deps.facebook.appSecret,
          version: deps.facebook.graphVersion,
        });
      default:
        throw new AppError({ code: ErrorCode.BAD_REQUEST, message: `Unsupported provider: ${row.provider}` });
    }
  }

  return { createProviderForConnection };
}

export type ProviderFactory = ReturnType<typeof createProviderFactory>;
