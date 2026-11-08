export const LINKEDIN_API_BASE_URL = "https://api.linkedin.com/rest";
/** v2 (Share on LinkedIn / UGC) endpoints — the w_member_social product. */
export const LINKEDIN_V2_BASE_URL = "https://api.linkedin.com/v2";
/** OIDC UserInfo (Sign In with LinkedIn using OpenID Connect). Not versioned. */
export const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
/**
 * Default `LinkedIn-Version` (YYYYMM). LinkedIn supports each version for
 * ~12 months; 202511 sunsets 2026-11-16. Override per instance via `version`.
 */
export const LINKEDIN_DEFAULT_VERSION = "202610";
export const LINKEDIN_RESTLI_PROTOCOL_VERSION = "2.0.0";

/** Videos API splits uploads into 4 MiB parts (byte ranges 0–4194303, …). */
export const LINKEDIN_VIDEO_PART_BYTES = 4 * 1024 * 1024;
export const LINKEDIN_VIDEO_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const LINKEDIN_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
export const LINKEDIN_MULTI_IMAGE = { min: 2, max: 20 } as const;
export const LINKEDIN_POLL = { questionMax: 140, optionMax: 30, minOptions: 2, maxOptions: 4 } as const;
export const LINKEDIN_ALT_TEXT_MAX = 4086;
export const LINKEDIN_POSTS_FINDER_MAX_COUNT = 100;
export const LINKEDIN_MEDIA_FINDER_MAX_COUNT = 1000;

/** Scopes referenced by the APIs implemented here (product access controls availability). */
export const LINKEDIN_SCOPES = {
  openid: "openid",
  profile: "profile",
  email: "email",
  memberSocialWrite: "w_member_social",
  memberSocialRead: "r_member_social", // restricted
  organizationSocialWrite: "w_organization_social",
  organizationSocialRead: "r_organization_social",
  memberSocialFeedWrite: "w_member_social_feed",
  memberSocialFeedRead: "r_member_social_feed", // restricted
  organizationSocialFeedWrite: "w_organization_social_feed",
  organizationSocialFeedRead: "r_organization_social_feed",
  organizationAdminRead: "r_organization_admin",
  organizationAdminWrite: "rw_organization_admin",
} as const;

/** Share on LinkedIn (UGC): images per post. */
export const LINKEDIN_UGC_MAX_IMAGES = 9;

/**
 * v2 assets upload mechanism threshold — NOT a size limit. LinkedIn allows a
 * single upload below 200 MB and multipart at any size, so we switch early:
 * below 190 MB (decimal, 190 000 000 bytes) → SINGLE_REQUEST_UPLOAD (one PUT);
 * from there → MULTIPART_UPLOAD + fileSize. The 10 MB margin keeps us clear of
 * the limit whether LinkedIn means MB or MiB. Max video size is
 * LINKEDIN_VIDEO_MAX_BYTES (5 GB).
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api
 */
export const LINKEDIN_SINGLE_UPLOAD_MAX_BYTES = 190_000_000;
