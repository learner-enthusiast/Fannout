/** Paths relative to `${THREADS_API_BASE_URL}/${version}`. */
export const ThreadsEndpoints = {
  user: (userId: string) => userId,
  userThreads: (userId: string) => `${userId}/threads`,
  userReplies: (userId: string) => `${userId}/replies`,
  userMentions: (userId: string) => `${userId}/mentions`,
  userGhostPosts: (userId: string) => `${userId}/ghost_posts`,
  publishingLimit: (userId: string) => `${userId}/threads_publishing_limit`,
  userInsights: (userId: string) => `${userId}/threads_insights`,

  createContainer: (userId: string) => `${userId}/threads`,
  publish: (userId: string) => `${userId}/threads_publish`,
  /** Media object, container (status) and DELETE share the node path. */
  media: (mediaId: string) => mediaId,
  repost: (mediaId: string) => `${mediaId}/repost`,
  mediaInsights: (mediaId: string) => `${mediaId}/insights`,

  replies: (mediaId: string) => `${mediaId}/replies`,
  conversation: (mediaId: string) => `${mediaId}/conversation`,
  pendingReplies: (mediaId: string) => `${mediaId}/pending_replies`,
  manageReply: (replyId: string) => `${replyId}/manage_reply`,
  managePendingReply: (replyId: string) => `${replyId}/manage_pending_reply`,

  keywordSearch: "keyword_search",
  profileLookup: "profile_lookup",
  profilePosts: "profile_posts",
  locationSearch: "location_search",
  location: (locationId: string) => locationId,
} as const;
