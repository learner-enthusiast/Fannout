export const FACEBOOK_GRAPH_BASE_URL = "https://graph.facebook.com";
/** Video uploads to /{page-id}/videos go to the graph-video host. */
export const FACEBOOK_GRAPH_VIDEO_BASE_URL = "https://graph-video.facebook.com";
/** Matches the OAuth adapter's default (FACEBOOK_GRAPH_VERSION); override per instance with `version`. */
export const FACEBOOK_DEFAULT_GRAPH_VERSION = "v23.0";

export const FACEBOOK_FEED_LIMIT_MAX = 100;
/** Feed posts: scheduled_publish_time must be 10 minutes – 75 days ahead. */
export const FACEBOOK_FEED_SCHEDULE_WINDOW = { minSeconds: 10 * 60, maxSeconds: 75 * 24 * 60 * 60 } as const;
/** Reels: scheduled_publish_time must be > 10 minutes and < 29 days ahead. */
export const FACEBOOK_REEL_SCHEDULE_WINDOW = { minSeconds: 10 * 60, maxSeconds: 29 * 24 * 60 * 60 } as const;
export const FACEBOOK_CHILD_ATTACHMENTS = { min: 2, max: 5, maxOptimized: 10 } as const;
/** Insights: since/until may span at most 90 days per request. */
export const FACEBOOK_INSIGHTS_MAX_RANGE_DAYS = 90;
export const FACEBOOK_LIMITS = { reelsPer24h: 30 } as const;

/** Permissions used by the Pages APIs implemented here (App Review + Page tasks apply). */
export const FACEBOOK_SCOPES = {
  pagesShowList: "pages_show_list",
  pagesReadEngagement: "pages_read_engagement",
  pagesReadUserContent: "pages_read_user_content",
  pagesManagePosts: "pages_manage_posts",
  pagesManageEngagement: "pages_manage_engagement",
  pagesManageMetadata: "pages_manage_metadata",
  readInsights: "read_insights",
  publishVideo: "publish_video",
} as const;
