import { logger } from "@repo/logger";
import { z } from "zod";
import { env } from "../../env";
import { getValidAccessToken } from "../../oauth";

const DebugTokenSchema = z.looseObject({
  data: z.looseObject({
    type: z.string().optional(),
    is_valid: z.boolean().optional(),
    app_id: z.string().optional(),
    profile_id: z.string().optional(),
    user_id: z.string().optional(),
    scopes: z.array(z.string()).default([]),
    granular_scopes: z.array(z.looseObject({ scope: z.string(), target_ids: z.array(z.string()).optional() })).optional(),
    expires_at: z.number().optional(),
  }),
});

export type FacebookTokenInfo = {
  pageId: string;
  tokenType: string | null;
  isValid: boolean | null;
  /** The Page the token belongs to (PAGE tokens). */
  profileId: string | null;
  scopes: string[];
  /** Scopes granted for this Page specifically (granular scopes). */
  pageScopes: string[];
  missing: string[];
};

/** What publishing to a Page (incl. videos) needs. `publish_video` is not a valid Login permission. */
export const FACEBOOK_VIDEO_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"];

/**
 * GET /debug_token for the connection's stored token (app token =
 * app_id|app_secret). Logs type/scopes/page — never token values.
 */
export async function inspectFacebookToken(userId: string, connectionId: string, pageId: string): Promise<FacebookTokenInfo | null> {
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) {
    logger.warn("Facebook token check skipped: FACEBOOK_CLIENT_ID/SECRET not set", { pageId });
    return null;
  }
  try {
    const token = await getValidAccessToken(userId, connectionId);
    const url = new URL(`https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION}/debug_token`);
    url.searchParams.set("input_token", token);
    url.searchParams.set("access_token", `${env.FACEBOOK_CLIENT_ID}|${env.FACEBOOK_CLIENT_SECRET}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const parsed = DebugTokenSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) {
      logger.warn("Facebook token check failed", { pageId, status: response.status });
      return null;
    }
    const d = parsed.data.data;
    const pageScopes = (d.granular_scopes ?? []).filter((g) => !g.target_ids || g.target_ids.includes(pageId)).map((g) => g.scope);
    const info: FacebookTokenInfo = {
      pageId,
      tokenType: d.type ?? null,
      isValid: d.is_valid ?? null,
      profileId: d.profile_id ?? null,
      scopes: d.scopes,
      pageScopes,
      missing: FACEBOOK_VIDEO_SCOPES.filter((s) => !d.scopes.includes(s)),
    };
    logger.info("Facebook token check", info);
    return info;
  } catch (error) {
    logger.warn("Facebook token check errored", { pageId, error: (error as Error).message });
    return null;
  }
}
