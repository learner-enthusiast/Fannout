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
