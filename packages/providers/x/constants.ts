export const X_API_BASE_URL = "https://api.x.com";

/** Raw bytes per APPEND segment (sent base64 in JSON by the XDK). */
export const X_MEDIA_CHUNK_BYTES = 2 * 1024 * 1024;
export const X_POST_MAX_CHARS = 280;
export const X_MAX_MEDIA_PER_POST = 4;
export const X_POLL = { minOptions: 2, maxOptions: 4, optionMax: 25, minMinutes: 5, maxMinutes: 10080 } as const;

/** max_results bounds per X API v2 endpoint (from the endpoint reference). */
export const X_LIMITS = {
  followers: { min: 1, max: 1000 },
  blockingMuting: { min: 1, max: 1000 },
  userPosts: { min: 5, max: 100 },
  timeline: { min: 1, max: 100 },
  likedPosts: { min: 10, max: 100 },
  likingUsers: { min: 1, max: 100 },
  repostedBy: { min: 1, max: 100 },
  quotes: { min: 10, max: 100 },
  bookmarks: { min: 1, max: 100 },
  searchRecent: { min: 10, max: 100 },
  searchAll: { min: 10, max: 500 },
  lists: { min: 1, max: 100 },
  listPosts: { min: 1, max: 100 },
  dmEvents: { min: 1, max: 100 },
  userSearch: { min: 1, max: 1000 },
  spaceSearch: { min: 1, max: 100 },
} as const;

/** OAuth 2.0 scopes referenced by the implemented endpoints. */
export const X_SCOPES = {
  tweetRead: "tweet.read",
  tweetWrite: "tweet.write",
  usersRead: "users.read",
  followsRead: "follows.read",
  followsWrite: "follows.write",
  offlineAccess: "offline.access",
  spaceRead: "space.read",
  muteRead: "mute.read",
  muteWrite: "mute.write",
  likeRead: "like.read",
  likeWrite: "like.write",
  listRead: "list.read",
  listWrite: "list.write",
  blockRead: "block.read",
  blockWrite: "block.write",
  bookmarkRead: "bookmark.read",
  bookmarkWrite: "bookmark.write",
  dmRead: "dm.read",
  dmWrite: "dm.write",
  mediaWrite: "media.write",
} as const;

/**
 * Chunked v2 upload limits. Segments should be ≤ 5 MB (server max 8 MB);
 * segment_index is 0–999. tweet_video: 8 GB / 20 min default, 16 GB / 125 min
 * Premium (X rejects over-allowance videos at post time with 403).
 * https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 */
export const X_VIDEO_SEGMENT_BYTES = 4 * 1024 * 1024;
export const X_MAX_SEGMENT_BYTES = 5 * 1024 * 1024;
export const X_MAX_SEGMENTS = 1000;
export const X_VIDEO_MAX_BYTES = 16 * 1024 * 1024 * 1024;
export const X_VIDEO_MAX_SECONDS = 125 * 60;
/** Media ids expire after expires_after_secs (86 400 s in the docs' examples). */
export const X_MEDIA_TTL_SECONDS = 86_400;
/** Request timeout for /2/media/upload calls (one segment per request). */
export const X_MEDIA_REQUEST_TIMEOUT_MS = 120_000;
