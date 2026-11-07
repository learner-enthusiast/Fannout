import { z } from "zod";
import { composeField, xWeightedLength, type ComposeCapabilities } from "../common/compose";
import { MediaSourceSchema } from "../common/media";
import { X_LIMITS, X_MAX_MEDIA_PER_POST, X_POLL, X_POST_MAX_CHARS } from "./constants";

/*
 * Zod schemas for XProvider. Option names are the XDK camelCase names
 * (the SDK converts them to X API snake_case). Field/expansion enums are
 * generated from the XDK type definitions so they match what the SDK accepts;
 * calling the SDK with these types is compile-checked in x.class.ts.
 */

// Generated from @xdevplatform/xdk index.d.ts — keep in sync with the SDK version.
export const XPostFields = ["article", "article_title", "attachments", "card_uri", "community_id", "context_annotations", "conversation_id", "created_at", "display_text_range", "edit_controls", "entities", "geo", "id", "lang", "matched_media_notes", "media_metadata", "non_public_metrics", "note_post", "note_request_suggestions", "organic_metrics", "paid_partnership", "possibly_sensitive", "promoted_metrics", "public_metrics", "reply_settings", "scopes", "source", "suggested_source_links", "suggested_source_links_with_counts", "text", "withheld"] as const;
export const XUserFields = ["confirmed_email", "connection_status", "created_at", "description", "entities", "id", "is_identity_verified", "location", "name", "parody", "profile_banner_url", "profile_image_url", "protected", "public_metrics", "receives_your_dm", "subscribes_to_you", "subscription", "subscription_type", "url", "username", "verified", "verified_followers_count", "verified_type", "withheld"] as const;
export const XMediaFields = ["alt_text", "duration_ms", "height", "media_key", "non_public_metrics", "organic_metrics", "preview_image_url", "promoted_metrics", "public_metrics", "type", "url", "variants", "width"] as const;
export const XPollFields = ["duration_minutes", "end_datetime", "id", "options", "voting_status"] as const;
export const XPlaceFields = ["contained_within", "country", "country_code", "full_name", "geo", "id", "name", "place_type"] as const;
export const XPostExpansions = ["article.cover_media", "article.media_entities", "attachments.media_keys", "attachments.media_source_tweet", "attachments.poll_ids", "author_id", "edit_history_post_ids", "entities.mentions.username", "geo.place_id", "in_reply_to_user_id", "referenced_posts", "username"] as const;
export const XUserExpansions = ["affiliation", "most_recent_post_id", "pinned_post_id"] as const;
export const XListFields = ["created_at", "description", "follower_count", "id", "member_count", "name", "private"] as const;
export const XListExpansions = ["owner_id"] as const;
export const XSpaceFields = ["created_at", "ended_at", "id", "is_ticketed", "lang", "participant_count", "scheduled_start", "started_at", "state", "subscriber_count", "title", "updated_at"] as const;
export const XSpaceExpansions = ["creator_id", "host_ids", "invited_user_ids", "speaker_ids", "topic_ids"] as const;
export const XTopicFields = ["description", "id", "name"] as const;
export const XDmEventFields = ["attachments", "created_at", "dm_conversation_id", "entities", "event_type", "id", "text"] as const;
export const XDmEventExpansions = ["attachments.media_keys", "participant_ids", "referenced_posts", "sender_id"] as const;
export const XDmEventTypes = ["MessageCreate", "ParticipantsJoin", "ParticipantsLeave"] as const;
export const XTimelineExclude = ["replies", "retweets"] as const;

// ---------- shared building blocks ----------

export const XIdSchema = z.string().regex(/^\d{1,19}$/, "Expected a numeric X id");
export const XUsernameSchema = z.string().regex(/^[A-Za-z0-9_]{1,15}$/, "Expected an X username without @");

const arr = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.enum(values)).min(1).optional();
const maxResults = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max).optional();

const postFieldSet = {
  postFields: arr(XPostFields),
  userFields: arr(XUserFields),
  mediaFields: arr(XMediaFields),
  pollFields: arr(XPollFields),
  placeFields: arr(XPlaceFields),
};
const timeWindow = {
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  sinceId: XIdSchema.optional(),
  untilId: XIdSchema.optional(),
};

export const XPostLookupOptionsSchema = z.object({ expansions: arr(XPostExpansions), ...postFieldSet });
export const XUserLookupOptionsSchema = z.object({
  expansions: arr(XUserExpansions),
  userFields: arr(XUserFields),
  postFields: arr(XPostFields),
});
const userListOptions = (b: { min: number; max: number }) =>
  XUserLookupOptionsSchema.extend({ maxResults: maxResults(b), paginationToken: z.string().optional() });
const postListOptions = (b: { min: number; max: number }) =>
  XPostLookupOptionsSchema.extend({ maxResults: maxResults(b), paginationToken: z.string().optional() });

export const XListLookupOptionsSchema = z.object({
  listFields: arr(XListFields),
  expansions: arr(XListExpansions),
  userFields: arr(XUserFields),
});
const listListOptions = XListLookupOptionsSchema.extend({
  maxResults: maxResults(X_LIMITS.lists),
  paginationToken: z.string().optional(),
});
export const XSpaceLookupOptionsSchema = z.object({
  spaceFields: arr(XSpaceFields),
  expansions: arr(XSpaceExpansions),
  userFields: arr(XUserFields),
  topicFields: arr(XTopicFields),
});
export const XDmLookupOptionsSchema = z.object({
  dmEventFields: arr(XDmEventFields),
  expansions: arr(XDmEventExpansions),
  userFields: arr(XUserFields),
  postFields: arr(XPostFields),
  mediaFields: arr(XMediaFields),
});
const dmListOptions = XDmLookupOptionsSchema.extend({
  maxResults: maxResults(X_LIMITS.dmEvents),
  paginationToken: z.string().optional(),
  eventTypes: arr(XDmEventTypes),
});

// ---------- users ----------

export const XGetUserByIdInputSchema = XUserLookupOptionsSchema.extend({ id: XIdSchema });
export const XGetUserByUsernameInputSchema = XUserLookupOptionsSchema.extend({ username: XUsernameSchema });
export const XGetUsersByUsernamesInputSchema = XUserLookupOptionsSchema.extend({
  usernames: z.array(XUsernameSchema).min(1).max(100),
});
export const XGetUsersByIdsInputSchema = XUserLookupOptionsSchema.extend({ ids: z.array(XIdSchema).min(1).max(100) });
export const XSearchUsersInputSchema = XUserLookupOptionsSchema.extend({
  query: z.string().min(1),
  maxResults: maxResults(X_LIMITS.userSearch),
  nextToken: z.string().optional(),
});
/** `userId` defaults to the authenticated user. */
export const XUserConnectionsInputSchema = userListOptions(X_LIMITS.followers).extend({ userId: XIdSchema.optional() });
export const XBlockMuteListInputSchema = userListOptions(X_LIMITS.blockingMuting).extend({ userId: XIdSchema.optional() });
export const XTargetUserInputSchema = z.object({ targetUserId: XIdSchema });
export type XGetUserByIdInput = z.input<typeof XGetUserByIdInputSchema>;
export type XGetUserByUsernameInput = z.input<typeof XGetUserByUsernameInputSchema>;
export type XGetUsersByUsernamesInput = z.input<typeof XGetUsersByUsernamesInputSchema>;
export type XGetUsersByIdsInput = z.input<typeof XGetUsersByIdsInputSchema>;
export type XSearchUsersInput = z.input<typeof XSearchUsersInputSchema>;
export type XUserConnectionsInput = z.input<typeof XUserConnectionsInputSchema>;
export type XBlockMuteListInput = z.input<typeof XBlockMuteListInputSchema>;

// ---------- posts ----------

export const XReplySettingsSchema = z.enum(["following", "mentionedUsers", "subscribers", "verified"]);

export const XCreatePostInputSchema = z
  .object({
    text: z.string().min(1).optional(),
    media: z
      .object({
        mediaIds: z.array(XIdSchema).min(1).max(X_MAX_MEDIA_PER_POST),
        taggedUserIds: z.array(XIdSchema).max(10).optional(),
      })
      .optional(),
    poll: z
      .object({
        options: z.array(z.string().min(1).max(X_POLL.optionMax)).min(X_POLL.minOptions).max(X_POLL.maxOptions),
        durationMinutes: z.number().int().min(X_POLL.minMinutes).max(X_POLL.maxMinutes),
        replySettings: XReplySettingsSchema.optional(),
      })
      .optional(),
    reply: z
      .object({
        inReplyToTweetId: XIdSchema,
        excludeReplyUserIds: z.array(XIdSchema).optional(),
        autoPopulateReplyMetadata: z.boolean().optional(),
      })
      .optional(),
    quoteTweetId: XIdSchema.optional(),
    replySettings: XReplySettingsSchema.optional(),
    geo: z.object({ placeId: z.string().min(1) }).optional(),
    forSuperFollowersOnly: z.boolean().optional(),
    directMessageDeepLink: z.url().optional(),
    communityId: XIdSchema.optional(),
    shareWithFollowers: z.boolean().optional(),
    nullcast: z.boolean().optional(),
    cardUri: z.string().optional(),
    madeWithAi: z.boolean().optional(),
    paidPartnership: z.boolean().optional(),
    /** Edit a post (Premium): id of the post being edited. */
    editOptions: z.object({ previousPostId: XIdSchema }).optional(),
  })
  .refine((v) => v.text !== undefined || v.media !== undefined || v.poll !== undefined || v.quoteTweetId !== undefined, {
    message: "A post needs text, media, a poll, or a quoted post",
  })
  .refine((v) => !(v.media && v.poll), { message: "media and poll are mutually exclusive" });
export type XCreatePostInput = z.input<typeof XCreatePostInputSchema>;

export const XReplyInputSchema = z.object({
  inReplyToTweetId: XIdSchema,
  text: z.string().min(1),
  mediaIds: z.array(XIdSchema).min(1).max(X_MAX_MEDIA_PER_POST).optional(),
  excludeReplyUserIds: z.array(XIdSchema).optional(),
});
export const XQuoteInputSchema = z.object({
  quoteTweetId: XIdSchema,
  text: z.string().min(1).optional(),
  mediaIds: z.array(XIdSchema).min(1).max(X_MAX_MEDIA_PER_POST).optional(),
});
export type XReplyInput = z.input<typeof XReplyInputSchema>;
export type XQuoteInput = z.input<typeof XQuoteInputSchema>;

export const XGetPostInputSchema = XPostLookupOptionsSchema.extend({ id: XIdSchema });
export const XGetPostsInputSchema = XPostLookupOptionsSchema.extend({ ids: z.array(XIdSchema).min(1).max(100) });
export const XPostUsersInputSchema = (b: { min: number; max: number }) => userListOptions(b).extend({ id: XIdSchema });
export const XQuotePostsInputSchema = postListOptions(X_LIMITS.quotes).extend({
  id: XIdSchema,
  exclude: z.array(z.enum(["replies", "retweets"])).min(1).optional(),
});
export const XSearchRecentInputSchema = XPostLookupOptionsSchema.extend({
  query: z.string().min(1).max(512),
  maxResults: maxResults(X_LIMITS.searchRecent),
  nextToken: z.string().optional(),
  sortOrder: z.enum(["recency", "relevancy"]).optional(),
  ...timeWindow,
});
/** Full-archive search (Pro/Enterprise access). Query max 1024 chars. */
export const XSearchAllInputSchema = XSearchRecentInputSchema.extend({
  query: z.string().min(1).max(1024),
  maxResults: maxResults(X_LIMITS.searchAll),
});
export const XRecentCountsInputSchema = z.object({
  query: z.string().min(1).max(512),
  granularity: z.enum(["minute", "hour", "day"]).optional(),
  nextToken: z.string().optional(),
  ...timeWindow,
});
export const XConversationInputSchema = XPostLookupOptionsSchema.extend({
  conversationId: XIdSchema,
  maxResults: maxResults(X_LIMITS.searchRecent),
  nextToken: z.string().optional(),
});
export const XHideReplyInputSchema = z.object({ replyId: XIdSchema, hidden: z.boolean() });
export const XPostIdInputSchema = z.object({ postId: XIdSchema });
export const XUserPostsInputSchema = postListOptions(X_LIMITS.userPosts).extend({
  userId: XIdSchema.optional(),
  exclude: arr(XTimelineExclude),
  ...timeWindow,
});
export const XMentionsInputSchema = postListOptions(X_LIMITS.userPosts).extend({ userId: XIdSchema.optional(), ...timeWindow });
export const XHomeTimelineInputSchema = postListOptions(X_LIMITS.timeline).extend({ exclude: arr(XTimelineExclude), ...timeWindow });
export const XLikedPostsInputSchema = postListOptions(X_LIMITS.likedPosts).extend({ userId: XIdSchema.optional() });
export const XBookmarksInputSchema = postListOptions(X_LIMITS.bookmarks);
export const XBookmarkPostInputSchema = z.object({ postId: XIdSchema, folderId: XIdSchema.optional() });
export type XGetPostInput = z.input<typeof XGetPostInputSchema>;
export type XGetPostsInput = z.input<typeof XGetPostsInputSchema>;
export type XQuotePostsInput = z.input<typeof XQuotePostsInputSchema>;
export type XSearchRecentInput = z.input<typeof XSearchRecentInputSchema>;
export type XSearchAllInput = z.input<typeof XSearchAllInputSchema>;
export type XRecentCountsInput = z.input<typeof XRecentCountsInputSchema>;
export type XConversationInput = z.input<typeof XConversationInputSchema>;
export type XUserPostsInput = z.input<typeof XUserPostsInputSchema>;
export type XMentionsInput = z.input<typeof XMentionsInputSchema>;
export type XHomeTimelineInput = z.input<typeof XHomeTimelineInputSchema>;
export type XLikedPostsInput = z.input<typeof XLikedPostsInputSchema>;
export type XBookmarksInput = z.input<typeof XBookmarksInputSchema>;

// ---------- media ----------

export const XMediaCategorySchema = z.enum([
  "amplify_video",
  "tweet_gif",
  "tweet_image",
  "tweet_video",
  "dm_gif",
  "dm_image",
  "dm_video",
  "subtitles",
]);
export const XMediaTypeSchema = z.enum([
  "video/mp4",
  "video/webm",
  "video/mp2t",
  "video/quicktime",
  "text/srt",
  "text/vtt",
  "image/jpeg",
  "image/gif",
  "image/bmp",
  "image/png",
  "image/webp",
  "image/pjpeg",
  "image/tiff",
  "model/gltf-binary",
  "model/vnd.usdz+zip",
]);
export const XInitializeMediaUploadInputSchema = z.object({
  mediaType: XMediaTypeSchema,
  totalBytes: z.number().int().positive(),
  mediaCategory: XMediaCategorySchema.optional(),
  additionalOwners: z.array(XIdSchema).optional(),
  shared: z.boolean().optional(),
});
export const XAppendMediaUploadInputSchema = z.object({
  mediaId: z.string().min(1),
  segmentIndex: z.number().int().min(0).max(999),
  data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: "Expected bytes" }),
});
/** One-shot upload for images/GIFs that fit in one request. */
export const XUploadMediaInputSchema = z.object({
  source: MediaSourceSchema,
  mediaCategory: z.enum(["tweet_image", "tweet_video", "tweet_gif", "dm_image", "dm_video", "dm_gif", "subtitles"]),
  additionalOwners: z.array(XIdSchema).optional(),
});
export const XUploadMediaChunkedInputSchema = z.object({
  source: MediaSourceSchema,
  mediaType: XMediaTypeSchema,
  mediaCategory: XMediaCategorySchema,
  additionalOwners: z.array(XIdSchema).optional(),
  /** Wait for async processing (video/GIF) to finish. Default true. */
  waitForProcessing: z.boolean().default(true),
  /** Upper bound on processing wait. */
  processingTimeoutMs: z.number().int().positive().default(10 * 60 * 1000),
});
export const XMediaAltTextInputSchema = z.object({ mediaId: XIdSchema, altText: z.string().min(1).max(1000) });
export type XInitializeMediaUploadInput = z.input<typeof XInitializeMediaUploadInputSchema>;
export type XUploadMediaInput = z.input<typeof XUploadMediaInputSchema>;
export type XUploadMediaChunkedInput = z.input<typeof XUploadMediaChunkedInputSchema>;

// ---------- lists ----------

export const XCreateListInputSchema = z.object({
  name: z.string().min(1).max(25),
  description: z.string().max(100).optional(),
  private: z.boolean().optional(),
});
export const XUpdateListInputSchema = XCreateListInputSchema.partial()
  .extend({ listId: XIdSchema })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.private !== undefined, {
    message: "Provide name, description or private",
  });
export const XGetListInputSchema = XListLookupOptionsSchema.extend({ listId: XIdSchema });
export const XListMembersInputSchema = userListOptions(X_LIMITS.lists).extend({ listId: XIdSchema });
export const XListMemberInputSchema = z.object({ listId: XIdSchema, userId: XIdSchema });
export const XListPostsInputSchema = postListOptions(X_LIMITS.listPosts).extend({ listId: XIdSchema });
export const XUserListsInputSchema = listListOptions.extend({ userId: XIdSchema.optional() });
export const XPinnedListsInputSchema = XListLookupOptionsSchema;
export const XListIdInputSchema = z.object({ listId: XIdSchema });
export type XCreateListInput = z.input<typeof XCreateListInputSchema>;
export type XUpdateListInput = z.input<typeof XUpdateListInputSchema>;
export type XGetListInput = z.input<typeof XGetListInputSchema>;
export type XListMembersInput = z.input<typeof XListMembersInputSchema>;
export type XListPostsInput = z.input<typeof XListPostsInputSchema>;
export type XUserListsInput = z.input<typeof XUserListsInputSchema>;

// ---------- spaces ----------

export const XGetSpaceInputSchema = XSpaceLookupOptionsSchema.extend({ spaceId: z.string().min(1) });
export const XGetSpacesInputSchema = XSpaceLookupOptionsSchema.extend({ spaceIds: z.array(z.string().min(1)).min(1).max(100) });
export const XSpacesByCreatorsInputSchema = XSpaceLookupOptionsSchema.extend({ userIds: z.array(XIdSchema).min(1).max(100) });
export const XSearchSpacesInputSchema = XSpaceLookupOptionsSchema.extend({
  query: z.string().min(1),
  state: z.enum(["all", "live", "scheduled"]).optional(),
  maxResults: maxResults(X_LIMITS.spaceSearch),
});
export const XSpacePostsInputSchema = XPostLookupOptionsSchema.extend({ spaceId: z.string().min(1), maxResults: maxResults({ min: 1, max: 100 }) });
export const XSpaceBuyersInputSchema = XUserLookupOptionsSchema.extend({
  spaceId: z.string().min(1),
  maxResults: maxResults({ min: 1, max: 100 }),
  paginationToken: z.string().optional(),
});
export type XGetSpaceInput = z.input<typeof XGetSpaceInputSchema>;
export type XGetSpacesInput = z.input<typeof XGetSpacesInputSchema>;
export type XSpacesByCreatorsInput = z.input<typeof XSpacesByCreatorsInputSchema>;
export type XSearchSpacesInput = z.input<typeof XSearchSpacesInputSchema>;
export type XSpacePostsInput = z.input<typeof XSpacePostsInputSchema>;
export type XSpaceBuyersInput = z.input<typeof XSpaceBuyersInputSchema>;

// ---------- direct messages ----------

const DmAttachmentsSchema = z.array(z.object({ mediaId: XIdSchema })).length(1).optional();
export const XDmEventsInputSchema = dmListOptions;
export const XDmEventInputSchema = XDmLookupOptionsSchema.extend({ eventId: XIdSchema });
export const XDmConversationEventsInputSchema = dmListOptions.extend({ conversationId: z.string().min(1) });
export const XDmParticipantEventsInputSchema = dmListOptions.extend({ participantId: XIdSchema });
const DmMessageSchema = z
  .object({ text: z.string().min(1).max(10000).optional(), attachments: DmAttachmentsSchema })
  .refine((m) => m.text !== undefined || m.attachments !== undefined, { message: "A DM needs text or an attachment" });
export const XSendDmToConversationInputSchema = z.object({ conversationId: z.string().min(1), message: DmMessageSchema });
export const XSendDmToParticipantInputSchema = z.object({ participantId: XIdSchema, message: DmMessageSchema });
export const XCreateDmGroupInputSchema = z.object({
  participantIds: z.array(XIdSchema).min(2).max(49),
  message: DmMessageSchema,
});
export type XDmEventsInput = z.input<typeof XDmEventsInputSchema>;
export type XDmEventInput = z.input<typeof XDmEventInputSchema>;
export type XDmConversationEventsInput = z.input<typeof XDmConversationEventsInputSchema>;
export type XDmParticipantEventsInput = z.input<typeof XDmParticipantEventsInputSchema>;
export type XSendDmToConversationInput = z.input<typeof XSendDmToConversationInputSchema>;
export type XSendDmToParticipantInput = z.input<typeof XSendDmToParticipantInputSchema>;
export type XCreateDmGroupInput = z.input<typeof XCreateDmGroupInputSchema>;

// ---------- responses (XDK returns camelCase keys) ----------

export const XUserSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  profileImageUrl: z.string().optional(),
  description: z.string().optional(),
  verified: z.boolean().optional(),
  protected: z.boolean().optional(),
  publicMetrics: z.looseObject({}).optional(),
  createdAt: z.string().optional(),
});
export const XPostSchema = z.looseObject({
  id: z.string(),
  text: z.string().optional(),
  authorId: z.string().optional(),
  conversationId: z.string().optional(),
  createdAt: z.string().optional(),
  editHistoryTweetIds: z.array(z.string()).optional(),
});
export const XListSchema = z.looseObject({ id: z.string(), name: z.string() });
export const XSpaceSchema = z.looseObject({ id: z.string(), state: z.string().optional(), title: z.string().optional() });
export const XDmEventSchema = z.looseObject({ id: z.string(), eventType: z.string().optional(), text: z.string().optional() });
export const XMetaSchema = z.looseObject({
  resultCount: z.number().optional(),
  nextToken: z.string().optional(),
  previousToken: z.string().optional(),
  newestId: z.string().optional(),
  oldestId: z.string().optional(),
  totalTweetCount: z.number().optional(),
});
const errorsField = z.array(z.looseObject({})).optional();

export function xSingle<T extends z.ZodType>(data: T) {
  return z.looseObject({ data: data.optional(), includes: z.looseObject({}).optional(), errors: errorsField });
}
export function xList<T extends z.ZodType>(item: T) {
  return z.looseObject({
    data: z.array(item).optional(),
    includes: z.looseObject({}).optional(),
    meta: XMetaSchema.optional(),
    errors: errorsField,
  });
}
export const XActionResultSchema = z.looseObject({ data: z.looseObject({}).optional(), errors: errorsField });
export const XCreatedPostSchema = z.looseObject({
  data: z.looseObject({ id: z.string(), text: z.string().optional() }),
  errors: errorsField,
});
export const XMediaUploadDataSchema = z.looseObject({
  id: z.string(),
  mediaKey: z.string().optional(),
  expiresAfterSecs: z.number().optional(),
  size: z.number().optional(),
  processingInfo: z
    .looseObject({
      state: z.string().optional(),
      checkAfterSecs: z.number().optional(),
      progressPercent: z.number().optional(),
    })
    .optional(),
});
export const XMediaUploadResponseSchema = z.looseObject({ data: XMediaUploadDataSchema.optional(), errors: errorsField });
export const XCountsSchema = z.looseObject({
  data: z.array(z.looseObject({ start: z.string(), end: z.string(), tweetCount: z.number().optional() })).optional(),
  meta: XMetaSchema.optional(),
});

export type XUser = z.infer<typeof XUserSchema>;
export type XPost = z.infer<typeof XPostSchema>;
export type XListResponse<T> = { data?: T[]; includes?: Record<string, unknown>; meta?: z.infer<typeof XMetaSchema> };

// ---------------------------------------------------------------------------
// Compose (Fannout composer). Single source for the UI fields and validation.
// ---------------------------------------------------------------------------


export const X_COMPOSE: ComposeCapabilities = {
  supportsVideo: true,
  supportsPhotos: true,
  maxPhotos: X_MAX_MEDIA_PER_POST,
  minCarousel: 1,
  supportsThumbnail: false,
  mediaRules: { maxVideoBytes: 512 * 1024 * 1024, maxVideoSeconds: 140, maxImageBytes: 5 * 1024 * 1024, billed: true },
  // DELETE /2/tweets/{id} (tweet.write) — https://docs.x.com/x-api/posts/delete-post
  supportsDelete: true,
  deleteNote: "Deletes the post on X. X API calls are billed on your plan.",
  supportsEdit: false,
  editableFields: [],
  editNote: "The X API can't edit published posts. Delete and repost instead.",
};

export const XComposeInputSchema = z.object({
  text: composeField(
    z.string().refine((v) => xWeightedLength(v) <= X_POST_MAX_CHARS, `Posts can be at most ${X_POST_MAX_CHARS} characters`).optional(),
    { label: "Post text", description: "Post text (max 280 X-weighted characters; URLs count 23).", kind: "textarea", countMode: "weighted", maxLength: X_POST_MAX_CHARS, ai: true },
  ),
  replySettings: composeField(XReplySettingsSchema.optional(), {
    label: "Who can reply", description: "Who can reply; omit to let everyone reply.",
    kind: "select",
    helper: "Leave empty to let everyone reply.",
    options: [
      { value: "following", label: "Accounts you follow" },
      { value: "mentionedUsers", label: "Only mentioned accounts" },
      { value: "subscribers", label: "Subscribers" },
      { value: "verified", label: "Verified accounts" },
    ],
  }),
  madeWithAi: composeField(z.boolean().optional(), { label: "Made with AI", description: "Label the media as made with AI.", kind: "toggle" }),
  paidPartnership: composeField(z.boolean().optional(), { label: "Paid partnership", description: "Label the post as a paid partnership.", kind: "toggle" }),
});
export type XComposeInput = z.infer<typeof XComposeInputSchema>;
