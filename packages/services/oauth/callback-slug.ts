import { findOAuthTransactionByStateHash } from "../oauth-transactions";
import { type OAuthProviderSlug } from "./model";
import { sha256 } from "./token-encryption";

/**
 * Instagram Unified Login uses FACEBOOK_REDIRECT_URI, so Meta returns to
 * /api/oauth/facebook/callback. Resolve the slug from the pending transaction.
 */
export async function oauthCallbackSlug(
  routeSlug: OAuthProviderSlug,
  state: string | null | undefined,
): Promise<OAuthProviderSlug> {
  if (!state || routeSlug !== "facebook") return routeSlug;
  const tx = await findOAuthTransactionByStateHash(sha256(state));
  return tx?.provider === "INSTAGRAM" ? "instagram" : routeSlug;
}