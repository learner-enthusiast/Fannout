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
/** user_tags per media item (error subcode 2207040 above it). */
export const INSTAGRAM_USER_TAGS_MAX = 20;

/** One constant for the carousel ceiling (children 2–20). */
export const INSTAGRAM_CAROUSEL_MAX = 20;
export const INSTAGRAM_CAROUSEL_MIN = 2;

const MB = 1024 * 1024;
export const INSTAGRAM_REEL = { maxBytes: 300 * MB, minSeconds: 3, maxSeconds: 15 * 60, mimeTypes: ["video/mp4", "video/quicktime"] } as const;
/** Feed / carousel photos: JPEG, ≤ 8 MB, width/height between 4:5 and 1.91:1 (error 2207009 otherwise). */
export const INSTAGRAM_IMAGE = { maxBytes: 8 * MB, mimeTypes: ["image/jpeg"], aspectRatio: { min: 4 / 5, max: 1.91 } } as const;

/**
 * Container status polling with backoff (each wait is an Inngest step.sleep, nothing is held open):
 * 30 s for the first 2 minutes, then every minute up to 12 minutes, then every 2 minutes; give up
 * after ~32 minutes. Long Reels routinely take well over the 5 minutes Meta suggests.
 */
export const INSTAGRAM_CONTAINER_POLL = {
  steps: [
    { checks: 4, intervalSeconds: 30 },
    { checks: 10, intervalSeconds: 60 },
    { checks: 10, intervalSeconds: 120 },
  ],
  maxChecks: 24,
} as const;

/** Reels video facts checked before upload (the container fails with a generic ERROR otherwise). */
export const INSTAGRAM_REEL_CODECS = { video: ["h264", "hevc"], audio: ["aac"], minFps: 23, maxFps: 60 } as const;
/** Containers expire after 24 h; recreate ones older than this. */
export const INSTAGRAM_CONTAINER_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export const INSTAGRAM_SCOPES = {
  basic: "instagram_basic",
  contentPublish: "instagram_content_publish",
  manageInsights: "instagram_manage_insights",
} as const;
