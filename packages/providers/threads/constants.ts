/** Threads Graph API host. graph.threads.com and graph.threads.net are both supported; .net matches the OAuth adapter. */
export const THREADS_API_BASE_URL = "https://graph.threads.net";
export const THREADS_API_VERSION = "v1.0";
/** oEmbed is served from the public site, not the Graph host. */
export const THREADS_OEMBED_URL = "https://www.threads.com/oembed";

export const THREADS_TEXT_MAX = 500;
export const THREADS_ALT_TEXT_MAX = 1000;
export const THREADS_TEXT_ATTACHMENT_MAX = 10_000;
export const THREADS_CAROUSEL = { min: 2, max: 20 } as const;
export const THREADS_POLL_OPTION = { min: 1, max: 25 } as const;
export const THREADS_TOPIC_TAG = { min: 1, max: 50 } as const;
export const THREADS_MAX_LINKS = 5;
export const THREADS_MAX_SPOILER_ENTITIES = 10;
export const THREADS_PAGE_LIMIT_MAX = 100;
/** Earliest `since` accepted by media/user list endpoints and keyword search. */
export const THREADS_MIN_SINCE = 1688540400;
/** Earliest `since`/`until` accepted by user insights. */
export const THREADS_INSIGHTS_MIN_SINCE = 1712991600;
export const THREADS_OEMBED_MAXWIDTH = { min: 320, max: 658 } as const;

/** Documented 24-hour quotas (check live usage with getPublishingLimit). */
export const THREADS_LIMITS = {
  postsPer24h: 250,
  repliesPer24h: 1000,
  deletesPerDay: 100,
  locationSearchesPer24h: 500,
  keywordSearchesPer24h: 2200,
  profileLookupsPer24h: 1000,
} as const;

/** Container polling guidance: query once per minute, for no more than 5 minutes. */
export const THREADS_CONTAINER_POLL = { intervalMs: 60_000, maxAttempts: 5 } as const;

export const THREADS_SCOPES = {
  basic: "threads_basic",
  contentPublish: "threads_content_publish",
  readReplies: "threads_read_replies",
  manageReplies: "threads_manage_replies",
  manageInsights: "threads_manage_insights",
  manageMentions: "threads_manage_mentions",
  delete: "threads_delete",
  keywordSearch: "threads_keyword_search",
  profileDiscovery: "threads_profile_discovery",
  locationTagging: "threads_location_tagging",
} as const;
