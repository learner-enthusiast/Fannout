/** Paths relative to `${INSTAGRAM_API_BASE_URL}/${version}`. */
export const InstagramEndpoints = {
  /** Instagram professional account node (profile fields). */
  account: (igUserId: string) => igUserId,
  createContainer: (igUserId: string) => `${igUserId}/media`,
  /** Same edge, GET: the account's recent media. */
  recentMedia: (igUserId: string) => `${igUserId}/media`,
  publish: (igUserId: string) => `${igUserId}/media_publish`,
  publishingLimit: (igUserId: string) => `${igUserId}/content_publishing_limit`,
  accountInsights: (igUserId: string) => `${igUserId}/insights`,
  /** Media object, container (status_code) share the node path. */
  node: (id: string) => id,
  mediaInsights: (mediaId: string) => `${mediaId}/insights`,
} as const;
