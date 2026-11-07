/** Paths relative to `${FACEBOOK_GRAPH_BASE_URL}/${version}`. */
export const FacebookEndpoints = {
  page: (pageId: string) => pageId,
  feed: (pageId: string) => `${pageId}/feed`,
  tagged: (pageId: string) => `${pageId}/tagged`,
  photos: (pageId: string) => `${pageId}/photos`,
  /** Sent to FACEBOOK_GRAPH_VIDEO_BASE_URL. */
  videos: (pageId: string) => `${pageId}/videos`,
  videoReels: (pageId: string) => `${pageId}/video_reels`,
  insights: (objectId: string) => `${objectId}/insights`,
  subscribedApps: (pageId: string) => `${pageId}/subscribed_apps`,

  /** Post, comment, photo and video nodes (GET / POST update / DELETE). */
  node: (id: string) => id,
  comments: (objectId: string) => `${objectId}/comments`,
  reactions: (objectId: string) => `${objectId}/reactions`,
  likes: (objectId: string) => `${objectId}/likes`,
} as const;
