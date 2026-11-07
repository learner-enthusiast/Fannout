import { z } from "zod";
import { composeField, utf8Length, type ComposeCapabilities } from "../common/compose";
import { graphCursorFields, graphFields, graphListSchema, NO_BEFORE_AND_AFTER, noBeforeAndAfter } from "../common/meta-graph";
import {
  THREADS_ALT_TEXT_MAX,
  THREADS_CAROUSEL,
  THREADS_INSIGHTS_MIN_SINCE,
  THREADS_MAX_SPOILER_ENTITIES,
  THREADS_MIN_SINCE,
  THREADS_OEMBED_MAXWIDTH,
  THREADS_PAGE_LIMIT_MAX,
  THREADS_POLL_OPTION,
  THREADS_TEXT_ATTACHMENT_MAX,
  THREADS_TEXT_MAX,
  THREADS_TOPIC_TAG,
} from "./constants";

/*
 * Zod schemas for the Threads API (graph.threads.net/v1.0), following the
 * Threads reference: Publishing, Media Retrieval, Reply Management, User,
 * Locations, Location Search, Insights and oEmbed.
 * Response schemas are loose: documented fields are typed, extra fields kept.
 */

// ---------- ids & shared ----------

export const ThreadsIdSchema = z.string().regex(/^\d+$/, "Expected a numeric Threads ID");
const ref = z.looseObject({ id: z.string() });

/** Unix seconds, or any string PHP strtotime() can parse (per the docs). */
const timeValue = z.union([z.number().int().min(0), z.string().min(1)]);
const sinceUntil = (minSince: number) => ({
  since: z.union([z.number().int().min(minSince), z.string().min(1)]).optional(),
  until: timeValue.optional(),
});

const listParams = {
  ...sinceUntil(THREADS_MIN_SINCE),
  ...graphCursorFields,
  limit: z.number().int().min(0).max(THREADS_PAGE_LIMIT_MAX).optional(),
};

// ---------- media object ----------

/** Every field selectable on GET /{threads-media-id}. */
export const THREADS_MEDIA_FIELDS = [
  "id", "media_product_type", "media_type", "media_url", "permalink", "owner", "username", "text", "timestamp",
  "shortcode", "thumbnail_url", "children", "is_quote_post", "alt_text", "link_attachment_url", "has_replies",
  "is_reply", "is_reply_owned_by_me", "root_post", "replied_to", "hide_status", "reply_audience", "quoted_post",
  "reposted_post", "gif_url", "poll_attachment", "topic_tag", "is_spoiler_media", "text_entities",
  "text_attachment", "location_id",
] as const;

/** GET /{threads-user-id}/threads fields. */
export const THREADS_USER_THREADS_FIELDS = [
  "id", "media_product_type", "media_type", "media_url", "permalink", "owner", "username", "text", "timestamp",
  "shortcode", "thumbnail_url", "children", "is_quote_post", "alt_text", "link_attachment_url", "has_replies",
  "reply_audience", "quoted_post", "reposted_post", "gif_url", "is_spoiler_media", "text_entities",
  "text_attachment", "is_verified", "profile_picture_url",
] as const;

/** GET /profile_posts fields. */
export const THREADS_PROFILE_POSTS_FIELDS = [
  "id", "media_product_type", "media_type", "media_url", "permalink", "username", "text", "timestamp", "shortcode",
  "thumbnail_url", "children", "is_quote_post", "alt_text", "link_attachment_url", "has_replies", "reply_audience",
  "quoted_post", "reposted_post", "gif_url", "is_spoiler_media", "text_entities",
] as const;

/** GET /{threads-user-id}/replies fields. */
export const THREADS_USER_REPLIES_FIELDS = [
  "id", "media_product_type", "media_type", "media_url", "permalink", "username", "text", "timestamp", "shortcode",
  "thumbnail_url", "children", "is_quote_post", "has_replies", "root_post", "replied_to", "is_reply",
  "is_reply_owned_by_me", "reply_audience", "quoted_post", "reposted_post", "gif_url", "is_verified",
  "profile_picture_url",
] as const;

/** Fields for /replies, /conversation (reply objects). */
export const THREADS_REPLY_FIELDS = [
  "id", "media_product_type", "media_type", "media_url", "permalink", "username", "text", "timestamp", "shortcode",
  "thumbnail_url", "children", "is_quote_post", "has_replies", "root_post", "replied_to", "is_reply",
  "is_reply_owned_by_me", "hide_status", "reply_audience", "quoted_post", "reposted_post", "gif_url", "topic_tag",
  "is_verified", "profile_picture_url",
] as const;

/** /pending_replies also accepts reply_approval_status. */
export const THREADS_PENDING_REPLY_FIELDS = [...THREADS_REPLY_FIELDS, "reply_approval_status"] as const;

/** Keyword search omits owner, is_reply_owned_by_me, hide_status, is_spoiler_media, text_entities, text_attachment, location_id. */
export const THREADS_KEYWORD_SEARCH_FIELDS = THREADS_MEDIA_FIELDS.filter(
  (f) =>
    !["owner", "is_reply_owned_by_me", "hide_status", "is_spoiler_media", "text_entities", "text_attachment", "location_id"].includes(f),
) as unknown as readonly ["id", ...string[]];

export const ThreadsTextEntitySchema = z.object({
  entity_type: z.enum(["SPOILER", "spoiler"]),
  offset: z.number().int().min(0),
  length: z.number().int().min(1),
});

export const ThreadsPollAttachmentResponseSchema = z.looseObject({
  option_a: z.string().optional(),
  option_b: z.string().optional(),
  option_c: z.string().optional(),
  option_d: z.string().optional(),
  option_a_votes_percentage: z.number().optional(),
  option_b_votes_percentage: z.number().optional(),
  option_c_votes_percentage: z.number().optional(),
  option_d_votes_percentage: z.number().optional(),
  total_votes: z.number().optional(),
  expiration_timestamp: z.string().optional(),
});

export const ThreadsMediaSchema = z.looseObject({
  id: z.string(),
  media_product_type: z.string().optional(),
  media_type: z.string().optional(),
  media_url: z.string().optional(),
  permalink: z.string().optional(),
  owner: ref.optional(),
  username: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.string().optional(),
  shortcode: z.string().optional(),
  thumbnail_url: z.string().optional(),
  children: z.looseObject({ data: z.array(ref) }).optional(),
  is_quote_post: z.boolean().optional(),
  alt_text: z.string().optional(),
  link_attachment_url: z.string().optional(),
  has_replies: z.boolean().optional(),
  is_reply: z.boolean().optional(),
  is_reply_owned_by_me: z.boolean().optional(),
  root_post: ref.optional(),
  replied_to: ref.optional(),
  hide_status: z.string().optional(),
  reply_audience: z.string().optional(),
  quoted_post: ref.optional(),
  reposted_post: ref.optional(),
  gif_url: z.string().optional(),
  poll_attachment: ThreadsPollAttachmentResponseSchema.optional(),
  topic_tag: z.string().optional(),
  is_spoiler_media: z.boolean().optional(),
  text_entities: z.unknown().optional(),
  text_attachment: z.looseObject({}).optional(),
  location_id: z.string().optional(),
  is_verified: z.boolean().optional(),
  profile_picture_url: z.string().optional(),
  reply_approval_status: z.string().optional(),
});
export type ThreadsMedia = z.infer<typeof ThreadsMediaSchema>;
export const ThreadsMediaListSchema = graphListSchema(ThreadsMediaSchema);

// ---------- user ----------

export const THREADS_PROFILE_FIELDS = [
  "id", "username", "name", "threads_profile_picture_url", "threads_biography", "is_verified",
  "recently_searched_keywords",
] as const;

export const ThreadsProfileSchema = z.looseObject({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  threads_profile_picture_url: z.string().optional(),
  threads_biography: z.string().optional(),
  is_verified: z.boolean().optional(),
  recently_searched_keywords: z.array(z.looseObject({ query: z.string().optional(), timestamp: z.number().optional() })).optional(),
});
export type ThreadsProfile = z.infer<typeof ThreadsProfileSchema>;

export const GetProfileInputSchema = z.object({
  /** Defaults to the provider's configured userId. */
  userId: ThreadsIdSchema.optional(),
  fields: graphFields(THREADS_PROFILE_FIELDS).optional(),
});
export type GetProfileInput = z.input<typeof GetProfileInputSchema>;

export const ProfileLookupInputSchema = z.object({
  /** Exact handle, without "@". */
  username: z.string().min(1).regex(/^[^@]/, "Omit the @"),
});
export type ProfileLookupInput = z.input<typeof ProfileLookupInputSchema>;

export const ThreadsPublicProfileSchema = z.looseObject({
  username: z.string().optional(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  biography: z.string().optional(),
  is_verified: z.boolean().optional(),
  follower_count: z.number().int().optional(),
  likes_count: z.number().int().optional(),
  quotes_count: z.number().int().optional(),
  reposts_count: z.number().int().optional(),
  views_count: z.number().int().optional(),
  replies_count: z.number().int().optional(),
});
export type ThreadsPublicProfile = z.infer<typeof ThreadsPublicProfileSchema>;

export const ListUserThreadsInputSchema = z
  .object({ userId: ThreadsIdSchema.optional(), fields: graphFields(THREADS_USER_THREADS_FIELDS).optional(), ...listParams })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListUserThreadsInput = z.input<typeof ListUserThreadsInputSchema>;

export const ListUserRepliesInputSchema = z
  .object({ userId: ThreadsIdSchema.optional(), fields: graphFields(THREADS_USER_REPLIES_FIELDS).optional(), ...listParams })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListUserRepliesInput = z.input<typeof ListUserRepliesInputSchema>;

/** /mentions and /ghost_posts accept any media fields. */
export const ListUserMediaInputSchema = z
  .object({ userId: ThreadsIdSchema.optional(), fields: graphFields(THREADS_MEDIA_FIELDS).optional(), ...listParams })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListUserMediaInput = z.input<typeof ListUserMediaInputSchema>;

export const ProfilePostsInputSchema = z
  .object({
    username: z.string().min(1),
    fields: graphFields(THREADS_PROFILE_POSTS_FIELDS).optional(),
    ...listParams,
  })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ProfilePostsInput = z.input<typeof ProfilePostsInputSchema>;

export const THREADS_PUBLISHING_LIMIT_FIELDS = [
  "quota_usage", "config", "reply_quota_usage", "reply_config", "delete_quota_usage", "delete_config",
  "location_search_quota_usage", "location_search_config",
] as const;

const quotaConfig = z.looseObject({ quota_total: z.number().optional(), quota_duration: z.number().optional() });
export const ThreadsPublishingLimitSchema = z.looseObject({
  quota_usage: z.number().optional(),
  config: quotaConfig.optional(),
  reply_quota_usage: z.number().optional(),
  reply_config: quotaConfig.optional(),
  delete_quota_usage: z.number().optional(),
  delete_config: quotaConfig.optional(),
  location_search_quota_usage: z.number().optional(),
  location_search_config: quotaConfig.optional(),
});
export type ThreadsPublishingLimit = z.infer<typeof ThreadsPublishingLimitSchema>;
export const ThreadsPublishingLimitResponseSchema = z.looseObject({ data: z.array(ThreadsPublishingLimitSchema) });

export const GetPublishingLimitInputSchema = z.object({
  userId: ThreadsIdSchema.optional(),
  fields: graphFields(THREADS_PUBLISHING_LIMIT_FIELDS).optional(),
});
export type GetPublishingLimitInput = z.input<typeof GetPublishingLimitInputSchema>;

// ---------- publishing ----------

export const ThreadsReplyControlSchema = z.enum([
  "everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only",
]);

const topicTag = z
  .string()
  .min(THREADS_TOPIC_TAG.min)
  .max(THREADS_TOPIC_TAG.max)
  .refine((v) => !/[.&]/.test(v), "Topic tags cannot contain periods or ampersands");

const pollOption = z.string().min(THREADS_POLL_OPTION.min).max(THREADS_POLL_OPTION.max);
export const ThreadsPollAttachmentInputSchema = z.object({
  option_a: pollOption,
  option_b: pollOption,
  option_c: pollOption.optional(),
  option_d: pollOption.optional(),
});

export const ThreadsGifAttachmentSchema = z.object({ gif_id: z.string().min(1), provider: z.literal("GIPHY") });

export const ThreadsTextAttachmentSchema = z.object({
  plaintext: z.string().min(1).max(THREADS_TEXT_ATTACHMENT_MAX),
  link_attachment_url: z.url().optional(),
  /** Styling ranges (offset, length, styling_info); sent as documented by Meta. */
  text_with_styling_info: z
    .array(
      z.object({
        offset: z.number().int().min(0),
        length: z.number().int().min(1),
        styling_info: z.array(z.enum(["bold", "italic", "highlight", "underline", "strikethrough"])).min(1),
      }),
    )
    .optional(),
});

/** Parameters valid on any top-level container. */
const containerCommon = {
  reply_to_id: ThreadsIdSchema.optional(),
  reply_control: ThreadsReplyControlSchema.optional(),
  allowlisted_country_codes: z.array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")).min(1).optional(),
  quote_post_id: ThreadsIdSchema.optional(),
  topic_tag: topicTag.optional(),
  location_id: z.string().min(1).optional(),
  is_made_with_ai: z.boolean().optional(),
  enable_reply_approvals: z.boolean().optional(),
  is_ghost_post: z.boolean().optional(),
  crossreshare_to_ig: z.boolean().optional(),
  crossreshare_to_ig_dark_mode: z.boolean().optional(),
};

const textEntities = z.array(ThreadsTextEntitySchema).min(1).max(THREADS_MAX_SPOILER_ENTITIES);
const text = z.string().max(THREADS_TEXT_MAX);

export const ThreadsTextContainerSchema = z
  .object({
    media_type: z.literal("TEXT"),
    text: text.min(1),
    link_attachment: z.url().optional(),
    gif_attachment: ThreadsGifAttachmentSchema.optional(),
    poll_attachment: ThreadsPollAttachmentInputSchema.optional(),
    text_attachment: ThreadsTextAttachmentSchema.optional(),
    text_entities: textEntities.optional(),
    /** Publish on creation (skips threads_publish). Text posts only. */
    auto_publish_text: z.boolean().optional(),
    ...containerCommon,
  })
  .refine((v) => !(v.poll_attachment && v.text_attachment), {
    message: "A text attachment can't be combined with a poll",
    path: ["text_attachment"],
  })
  .refine((v) => !(v.link_attachment && v.text_attachment?.link_attachment_url), {
    message: "text_attachment.link_attachment_url can't be used when the post has link_attachment",
    path: ["text_attachment", "link_attachment_url"],
  });

const mediaCommon = {
  text: text.optional(),
  alt_text: z.string().max(THREADS_ALT_TEXT_MAX).optional(),
  is_spoiler_media: z.boolean().optional(),
  text_entities: textEntities.optional(),
};

export const ThreadsImageContainerSchema = z.object({
  media_type: z.literal("IMAGE"),
  /** Must be publicly reachable; Meta downloads it. */
  image_url: z.url(),
  ...mediaCommon,
  ...containerCommon,
});

export const ThreadsVideoContainerSchema = z.object({
  media_type: z.literal("VIDEO"),
  /** Must be publicly reachable; Meta downloads it. */
  video_url: z.url(),
  ...mediaCommon,
  ...containerCommon,
});

/** Child of a carousel: is_carousel_item=true; `is_made_with_ai` must be set on the parent instead. */
export const ThreadsCarouselItemSchema = z.discriminatedUnion("media_type", [
  z.object({
    media_type: z.literal("IMAGE"),
    image_url: z.url(),
    alt_text: z.string().max(THREADS_ALT_TEXT_MAX).optional(),
  }),
  z.object({
    media_type: z.literal("VIDEO"),
    video_url: z.url(),
    alt_text: z.string().max(THREADS_ALT_TEXT_MAX).optional(),
  }),
]);
export type ThreadsCarouselItem = z.input<typeof ThreadsCarouselItemSchema>;

export const ThreadsCarouselContainerSchema = z.object({
  media_type: z.literal("CAROUSEL"),
  /** Child container IDs (created with is_carousel_item=true). */
  children: z.array(ThreadsIdSchema).min(THREADS_CAROUSEL.min).max(THREADS_CAROUSEL.max),
  text: text.optional(),
  is_spoiler_media: z.boolean().optional(),
  text_entities: textEntities.optional(),
  ...containerCommon,
});

export const CreateContainerInputSchema = z.discriminatedUnion("media_type", [
  ThreadsTextContainerSchema,
  ThreadsImageContainerSchema,
  ThreadsVideoContainerSchema,
  ThreadsCarouselContainerSchema,
]);
export type CreateContainerInput = z.input<typeof CreateContainerInputSchema>;
export type ThreadsTextContainerInput = z.input<typeof ThreadsTextContainerSchema>;
export type ThreadsImageContainerInput = z.input<typeof ThreadsImageContainerSchema>;
export type ThreadsVideoContainerInput = z.input<typeof ThreadsVideoContainerSchema>;

export const CreateCarouselItemInputSchema = ThreadsCarouselItemSchema;

/** High-level carousel: children are created, awaited and attached for you. */
export const PublishCarouselInputSchema = ThreadsCarouselContainerSchema.omit({ children: true, media_type: true }).extend({
  items: z.array(ThreadsCarouselItemSchema).min(THREADS_CAROUSEL.min).max(THREADS_CAROUSEL.max),
});
export type PublishCarouselInput = z.input<typeof PublishCarouselInputSchema>;

export const PublishContainerInputSchema = z.object({ creation_id: ThreadsIdSchema });
export type PublishContainerInput = z.input<typeof PublishContainerInputSchema>;

export const ThreadsContainerStatusValueSchema = z.enum(["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"]);
export const ThreadsContainerErrorSchema = z.enum([
  "FAILED_DOWNLOADING_VIDEO", "FAILED_PROCESSING_AUDIO", "FAILED_PROCESSING_VIDEO", "INVALID_ASPEC_RATIO",
  "INVALID_BIT_RATE", "INVALID_DURATION", "INVALID_FRAME_RATE", "INVALID_AUDIO_CHANNELS",
  "INVALID_AUDIO_CHANNEL_LAYOUT", "UNKNOWN",
]);
export const ThreadsContainerStatusSchema = z.looseObject({
  id: z.string(),
  status: ThreadsContainerStatusValueSchema,
  /** Present with ERROR; kept as string so new codes don't break parsing. */
  error_message: z.string().optional(),
});
export type ThreadsContainerStatus = z.infer<typeof ThreadsContainerStatusSchema>;

export const WaitForContainerOptionsSchema = z.object({
  intervalMs: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});
export type WaitForContainerOptions = z.input<typeof WaitForContainerOptionsSchema>;

export const DeleteMediaResponseSchema = z.looseObject({ success: z.boolean(), deleted_id: z.string().optional() });
export type DeleteMediaResponse = z.infer<typeof DeleteMediaResponseSchema>;

export const GetMediaInputSchema = z.object({
  mediaId: ThreadsIdSchema,
  fields: graphFields(THREADS_MEDIA_FIELDS).optional(),
});
export type GetMediaInput = z.input<typeof GetMediaInputSchema>;

// ---------- replies ----------

const replyListBase = {
  mediaId: ThreadsIdSchema,
  /** Default true (reverse chronological). */
  reverse: z.boolean().optional(),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
};

export const ListRepliesInputSchema = z
  .object({ ...replyListBase, fields: graphFields(THREADS_REPLY_FIELDS).optional() })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListRepliesInput = z.input<typeof ListRepliesInputSchema>;

export const ListPendingRepliesInputSchema = z
  .object({ ...replyListBase, fields: graphFields(THREADS_PENDING_REPLY_FIELDS).optional() })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListPendingRepliesInput = z.input<typeof ListPendingRepliesInputSchema>;

export const ManageReplyInputSchema = z.object({ replyId: ThreadsIdSchema, hide: z.boolean() });
export type ManageReplyInput = z.input<typeof ManageReplyInputSchema>;

export const ManagePendingReplyInputSchema = z.object({ replyId: ThreadsIdSchema, approve: z.boolean() });
export type ManagePendingReplyInput = z.input<typeof ManagePendingReplyInputSchema>;

/** Convenience: create + publish a reply to `replyToId`. */
export const CreateReplyInputSchema = ThreadsTextContainerSchema.safeExtend({ reply_to_id: ThreadsIdSchema });
/** Convenience: create + publish a quote of `quote_post_id`. */
export const CreateQuotePostInputSchema = ThreadsTextContainerSchema.safeExtend({ quote_post_id: ThreadsIdSchema });

// ---------- insights ----------

export const ThreadsMediaMetricSchema = z.enum(["views", "likes", "replies", "reposts", "quotes", "shares"]);
export const ThreadsUserMetricSchema = z.enum([
  "views", "likes", "replies", "reposts", "quotes", "clicks", "followers_count", "follower_demographics",
]);
export const ThreadsDemographicBreakdownSchema = z.enum(["country", "city", "age", "gender"]);

export const GetMediaInsightsInputSchema = z.object({
  mediaId: ThreadsIdSchema,
  metric: z.array(ThreadsMediaMetricSchema).min(1),
});
export type GetMediaInsightsInput = z.input<typeof GetMediaInsightsInputSchema>;

export const GetUserInsightsInputSchema = z
  .object({
    userId: ThreadsIdSchema.optional(),
    metric: z.array(ThreadsUserMetricSchema).min(1),
    ...sinceUntil(THREADS_INSIGHTS_MIN_SINCE),
    /** Only with follower_demographics (one value). */
    breakdown: ThreadsDemographicBreakdownSchema.optional(),
  })
  .refine(
    (v) =>
      !(v.since !== undefined || v.until !== undefined) ||
      !v.metric.some((m) => m === "followers_count" || m === "follower_demographics"),
    { message: "followers_count and follower_demographics don't accept since/until", path: ["since"] },
  )
  .refine((v) => !v.breakdown || v.metric.includes("follower_demographics"), {
    message: "breakdown applies only to follower_demographics",
    path: ["breakdown"],
  });
export type GetUserInsightsInput = z.input<typeof GetUserInsightsInputSchema>;

export const ThreadsInsightSchema = z.looseObject({
  name: z.string(),
  period: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  id: z.string().optional(),
  values: z.array(z.looseObject({ value: z.number(), end_time: z.string().optional() })).optional(),
  total_value: z
    .looseObject({ value: z.number().optional(), breakdowns: z.array(z.looseObject({})).optional() })
    .optional(),
  link_total_values: z.array(z.looseObject({ value: z.number(), link_url: z.string() })).optional(),
});
export type ThreadsInsight = z.infer<typeof ThreadsInsightSchema>;
export const ThreadsInsightsResponseSchema = z.looseObject({ data: z.array(ThreadsInsightSchema) });

// ---------- search & discovery ----------

export const KeywordSearchInputSchema = z.object({
  q: z.string().min(1),
  search_type: z.enum(["TOP", "RECENT"]).optional(),
  search_mode: z.enum(["KEYWORD", "TAG"]).optional(),
  media_type: z.enum(["TEXT", "IMAGE", "VIDEO"]).optional(),
  ...sinceUntil(THREADS_MIN_SINCE),
  limit: z.number().int().min(0).max(THREADS_PAGE_LIMIT_MAX).optional(),
  author_username: z.string().min(1).regex(/^[^@]/, "Omit the @").optional(),
  fields: z.array(z.enum(THREADS_KEYWORD_SEARCH_FIELDS as unknown as [string, ...string[]])).min(1).optional(),
});
export type KeywordSearchInput = z.input<typeof KeywordSearchInputSchema>;

export const THREADS_LOCATION_FIELDS = [
  "id", "name", "address", "city", "country", "latitude", "longitude", "postal_code",
] as const;

export const ThreadsLocationSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  postal_code: z.string().optional(),
});
export type ThreadsLocation = z.infer<typeof ThreadsLocationSchema>;

export const LocationSearchInputSchema = z
  .object({
    query: z.string().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    fields: graphFields(THREADS_LOCATION_FIELDS).optional(),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "latitude and longitude must be used together",
    path: ["longitude"],
  })
  .refine((v) => v.query !== undefined || v.latitude !== undefined, {
    message: "Provide query or latitude/longitude",
    path: ["query"],
  });
export type LocationSearchInput = z.input<typeof LocationSearchInputSchema>;

export const GetLocationInputSchema = z.object({
  locationId: z.string().min(1),
  fields: graphFields(THREADS_LOCATION_FIELDS).optional(),
});
export type GetLocationInput = z.input<typeof GetLocationInputSchema>;

export const OEmbedInputSchema = z.object({
  url: z
    .url()
    .regex(
      /^https:\/\/www\.threads\.(com|net)\/(@[^/]+(\/post\/[^/?#]+)?|t\/[^/?#]+)\/?$/,
      "Expected a threads.com post or profile permalink",
    ),
  maxwidth: z.number().int().min(THREADS_OEMBED_MAXWIDTH.min).max(THREADS_OEMBED_MAXWIDTH.max).optional(),
});
export type OEmbedInput = z.input<typeof OEmbedInputSchema>;

export const ThreadsOEmbedSchema = z.looseObject({
  html: z.string(),
  provider_name: z.string().optional(),
  provider_url: z.string().optional(),
  type: z.string().optional(),
  version: z.string().optional(),
  width: z.number().nullable().optional(),
});
export type ThreadsOEmbed = z.infer<typeof ThreadsOEmbedSchema>;

// ---------- webhooks ----------

/** Threads webhook notification (topics: moderate → replies/delete; interaction → mentions/publish). */
export const ThreadsWebhookEventSchema = z.looseObject({
  app_id: z.union([z.string(), z.number()]).optional(),
  topic: z.string(),
  target_id: z.union([z.string(), z.number()]).optional(),
  time: z.number().optional(),
  subscription_id: z.union([z.string(), z.number()]).optional(),
  values: z.looseObject({ field: z.string(), value: z.unknown() }),
});
export type ThreadsWebhookEvent = z.infer<typeof ThreadsWebhookEventSchema>;

// ---------------------------------------------------------------------------
// Compose (Fannout composer). Single source for the UI fields and validation.
// ---------------------------------------------------------------------------


export const THREADS_COMPOSE: ComposeCapabilities = {
  supportsVideo: true,
  supportsPhotos: true,
  maxPhotos: THREADS_CAROUSEL.max,
  minCarousel: 1,
  supportsThumbnail: false,
  // Meta downloads media from a URL, so storage must be publicly reachable.
  mediaRules: { maxVideoBytes: 1024 * 1024 * 1024, maxVideoSeconds: 5 * 60, maxImageBytes: 8 * 1024 * 1024, requiresPublicUrl: true },
  // DELETE /{threads-media-id} (threads_delete, 100/day) — https://developers.facebook.com/docs/threads/posts/delete-posts
  supportsDelete: true,
  deleteNote: "Needs the threads_delete permission. Threads allows 100 deletes per day.",
  supportsEdit: false,
  editableFields: [],
  editNote: "The Threads API can't edit published posts. Delete and repost instead.",
};

export const ThreadsComposeInputSchema = z.object({
  // Threads' 500 limit is enforced on UTF-8 bytes here (multi-byte scripts such as Bengali hit it sooner).
  text: composeField(
    z.string().refine((v) => utf8Length(v) <= THREADS_TEXT_MAX, `Posts can be at most ${THREADS_TEXT_MAX} bytes`).optional(),
    { label: "Post text", description: "Post text (max 500 UTF-8 bytes).", kind: "textarea", countMode: "bytes", maxLength: THREADS_TEXT_MAX, ai: true },
  ),
  reply_control: composeField(ThreadsReplyControlSchema.optional(), {
    label: "Who can reply", description: "Who can reply; omit for everyone.",
    kind: "select",
    options: [
      { value: "everyone", label: "Everyone" },
      { value: "accounts_you_follow", label: "Accounts you follow" },
      { value: "mentioned_only", label: "Mentioned only" },
      { value: "followers_only", label: "Followers only" },
    ],
  }),
  topic_tag: composeField(topicTag.optional(), { label: "Topic", description: "Topic tag for the post (no periods or ampersands).", kind: "text", countMode: "chars", maxLength: THREADS_TOPIC_TAG.max }),
  is_spoiler_media: composeField(z.boolean().optional(), { label: "Mark media as spoiler", description: "Blur the media as a spoiler.", kind: "toggle" }),
});
export type ThreadsComposeInput = z.infer<typeof ThreadsComposeInputSchema>;
