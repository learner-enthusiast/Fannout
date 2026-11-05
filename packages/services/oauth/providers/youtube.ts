import * as oauth from "oauth4webapi";
import { z } from "zod";
import { cachedDiscovery, requireCredentials, splitScopes, stringClaim } from "./shared";
import {
  ProviderIdentityError,
  type OAuthProviderAdapter,
  type ProviderCredentials,
} from "./types";

/**
 * YouTube via Google OAuth 2.0 + OpenID Connect (discovered from
 * accounts.google.com), PKCE S256 and nonce.
 *
 * Identity mapping: the Google account (ID token `sub`) is the *grantor*;
 * each YouTube channel is a separate connection. provider_account_id is the
 * channel id, and config.google.sub records which Google account authorised it.
 */
export const GOOGLE_ISSUER = new URL("https://accounts.google.com");
export const YOUTUBE_CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50";
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

const ThumbnailSchema = z.object({ url: z.string() }).optional();

const ChannelsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z
          .object({
            title: z.string().optional(),
            customUrl: z.string().optional(),
            thumbnails: z
              .object({ default: ThumbnailSchema, medium: ThumbnailSchema, high: ThumbnailSchema })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function createYouTubeProvider(credentials: ProviderCredentials): OAuthProviderAdapter {
  return {
    slug: "youtube",
    provider: "YOUTUBE",
    redirectUri: credentials.redirectUri,
    scopes: splitScopes(credentials.scopes),
    requiredScopes: ["openid", YOUTUBE_READONLY_SCOPE],
    usePkce: true,
    useNonce: true,
    isOidc: true,
    allowsAccountSelection: true,
    // offline + consent so Google issues a refresh token on every connect.
    extraAuthorizationParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    jwksCache: {},

    isConfigured: () => Boolean(credentials.clientId && credentials.clientSecret),
    getClient: () => ({ client_id: requireCredentials(credentials, "Google") }),
    getClientAuth: () => oauth.ClientSecretPost(credentials.clientSecret ?? ""),
    getAuthorizationServer: cachedDiscovery(GOOGLE_ISSUER),

    async resolveAccounts({ accessToken, idTokenClaims, http }) {
      if (!idTokenClaims?.sub) throw new ProviderIdentityError("Google ID token has no subject");
      const google = {
        sub: idTokenClaims.sub,
        email: stringClaim(idTokenClaims.email),
        emailVerified: idTokenClaims.email_verified === true,
        name: stringClaim(idTokenClaims.name),
        picture: stringClaim(idTokenClaims.picture),
      };

      const response = await oauth.protectedResourceRequest(
        accessToken,
        "GET",
        new URL(YOUTUBE_CHANNELS_URL),
        undefined,
        undefined,
        http,
      );
      if (!response.ok) {
        throw new ProviderIdentityError("YouTube channel lookup failed", response.status);
      }
      const parsed = ChannelsResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderIdentityError("Unexpected YouTube channels response");

      return (parsed.data.items ?? []).map((channel) => {
        const thumbnails = channel.snippet?.thumbnails;
        const thumbnailUrl =
          thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null;
        const title = channel.snippet?.title ?? null;
        const handle = channel.snippet?.customUrl ?? null;
        return {
          provider: "YOUTUBE" as const,
          providerAccountId: channel.id,
          accountType: "youtube_channel",
          username: handle,
          displayName: title,
          profilePictureUrl: thumbnailUrl,
          config: {
            google,
            channel: { id: channel.id, title, handle, thumbnailUrl },
          },
        };
      });
    },
  };
}
