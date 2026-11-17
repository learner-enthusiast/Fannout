/** Default YouTube Data API v3 quota is 10,000 units/day per project. */
export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;

/** Quota cost of common calls (YouTube Data API quota calculator). */
export const YOUTUBE_QUOTA_COST = {
  list: 1,
  search: 100,
  videosInsert: 100,
  write: 50,
  captionsInsert: 400,
  captionsDownload: 200,
} as const;

export const YOUTUBE_SCOPES = {
  readonly: "https://www.googleapis.com/auth/youtube.readonly",
  manage: "https://www.googleapis.com/auth/youtube",
  upload: "https://www.googleapis.com/auth/youtube.upload",
  forceSsl: "https://www.googleapis.com/auth/youtube.force-ssl",
  partner: "https://www.googleapis.com/auth/youtubepartner",
  channelMemberships: "https://www.googleapis.com/auth/youtube.channel-memberships.creator",
} as const;

/**
 * Resumable-upload chunk size. Must be a multiple of 256 KiB (all chunks but
 * the last). https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */
export const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Image posts in the YouTube app take up to 10 images. There is no Data API v3 endpoint for them. */
export const YOUTUBE_COMMUNITY_POST_MAX_IMAGES = 10;
/** Fannout's own cap for the text of a manual image post (YouTube documents no limit). */
export const YOUTUBE_COMMUNITY_POST_MAX = 5000;
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const youtubeStudioEditUrl = (videoId: string) => `https://studio.youtube.com/video/${videoId}/edit`;
