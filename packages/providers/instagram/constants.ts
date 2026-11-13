/**
 * Instagram API with Unified Login (Meta app, Facebook Login for Business config_id).
 * Business-integration system-user token, called on graph.facebook.com — NOT graph.instagram.com.
 */
export const INSTAGRAM_API_BASE_URL = "https://graph.facebook.com";
export const INSTAGRAM_API_VERSION = "v27.0";

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAGS_MAX = 30;
export const INSTAGRAM_MENTIONS_MAX = 20;
export const INSTAGRAM_ALT_TEXT_MAX = 1000;
export const INSTAGRAM_COLLABORATORS_MAX = 3;

/** One constant for the carousel ceiling (children 2–20). */
export const INSTAGRAM_CAROUSEL_MAX = 20;
export const INSTAGRAM_CAROUSEL_MIN = 2;

const MB = 1024 * 1024;
export const INSTAGRAM_REEL = { maxBytes: 300 * MB, minSeconds: 3, maxSeconds: 15 * 60, mimeTypes: ["video/mp4", "video/quicktime"] } as const;
export const INSTAGRAM_IMAGE = { maxBytes: 8 * MB, mimeTypes: ["image/jpeg"] } as const;

/** Container status polling: once a minute, at most 10 checks. */
export const INSTAGRAM_CONTAINER_POLL = { intervalSeconds: 60, maxChecks: 10 } as const;
/** Containers expire after 24 h; recreate ones older than this. */
export const INSTAGRAM_CONTAINER_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export const INSTAGRAM_SCOPES = {
  basic: "instagram_basic",
  contentPublish: "instagram_content_publish",
  manageInsights: "instagram_manage_insights",
} as const;
