import { z } from "zod";
import { MediaSourceSchema } from "../common/media";
import { graphCursorFields, graphListSchema, NO_BEFORE_AND_AFTER, noBeforeAndAfter } from "../common/meta-graph";
import { FACEBOOK_CHILD_ATTACHMENTS, FACEBOOK_FEED_LIMIT_MAX } from "./constants";

/*
 * Zod schemas for the Facebook Pages APIs (Graph API): Page, Page feed,
 * PagePost, Page photos, Page videos (incl. chunked upload), Page video_reels,
 * Comments, Reactions, Likes, Insights, Page tagged and subscribed_apps.
 * Response schemas are loose: documented fields are typed, extra fields kept.
 */

// ---------- ids & shared ----------

/** Graph node IDs are numeric; Page post IDs are `{page-id}_{post-id}`. */
export const GraphNodeIdSchema = z.string().regex(/^\d+(_\d+)?$/, "Expected a Graph node ID");
export const PagePostIdSchema = z.string().regex(/^\d+_\d+$/, "Expected {page-id}_{post-id}");

/** Graph field selector, e.g. "message", "attachments{media}", "reactions.summary(total_count)". */
export const GraphFieldSchema = z.string().regex(/^[a-z_][a-z0-9_]*([.{(][^\s]*)?$/i, "Invalid Graph field");
const fields = z.array(GraphFieldSchema).min(1).optional();

/** UNIX seconds, ISO 8601, or a strtotime()-parsable string (documented for scheduling). */
const timeValue = z.union([z.number().int().min(0), z.string().min(1)]);

const cursor = { ...graphCursorFields, limit: z.number().int().min(1).max(FACEBOOK_FEED_LIMIT_MAX).optional() };

const pictureSchema = z.looseObject({ data: z.looseObject({ url: z.string().optional() }).optional() });
const fromSchema = z.looseObject({ id: z.string(), name: z.string().optional() });

// ---------- page ----------

export const FacebookPageSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  username: z.string().optional(),
  about: z.string().optional(),
  category: z.string().optional(),
  link: z.string().optional(),
  fan_count: z.number().int().optional(),
  followers_count: z.number().int().optional(),
  picture: pictureSchema.optional(),
});
export type FacebookPage = z.infer<typeof FacebookPageSchema>;

export const GetPageInputSchema = z.object({ fields });
export type GetPageInput = z.input<typeof GetPageInputSchema>;

// ---------- posts ----------

export const FacebookPostSchema = z.looseObject({
  id: z.string(),
  message: z.string().optional(),
  story: z.string().optional(),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
  permalink_url: z.string().optional(),
  full_picture: z.string().optional(),
  is_published: z.boolean().optional(),
  is_hidden: z.boolean().optional(),
  status_type: z.string().optional(),
  shares: z.looseObject({ count: z.number().int() }).optional(),
  from: fromSchema.optional(),
  scheduled_publish_time: z.number().optional(),
  privacy: z.looseObject({}).optional(),
  /** Only on /tagged. */
  tagged_time: z.string().optional(),
});
export type FacebookPost = z.infer<typeof FacebookPostSchema>;
export const FacebookPostListSchema = graphListSchema(FacebookPostSchema);

export const ListFeedInputSchema = z.object({ fields, ...cursor }).refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListFeedInput = z.input<typeof ListFeedInputSchema>;

const geoLocations = z.looseObject({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  regions: z.array(z.looseObject({ key: z.string() })).optional(),
  cities: z.array(z.looseObject({ key: z.string() })).optional(),
  zips: z.array(z.looseObject({ key: z.string() })).optional(),
});
export const FacebookTargetingSchema = z.looseObject({ geo_locations: geoLocations.optional() });

export const ChildAttachmentSchema = z.object({
  link: z.url(),
  name: z.string().optional(),
  description: z.string().optional(),
  picture: z.url().optional(),
  image_hash: z.string().optional(),
});

export const BackdatedGranularitySchema = z.enum(["year", "month", "day", "hour", "minute"]);

/** POST /{page-id}/feed. Either `message` or `link` is required. */
export const CreatePostInputSchema = z
  .object({
    message: z.string().min(1).optional(),
    link: z.url().optional(),
    /** Link preview overrides. */
    name: z.string().optional(),
    description: z.string().optional(),
    picture: z.url().optional(),
    object_attachment: GraphNodeIdSchema.optional(),
    place: GraphNodeIdSchema.optional(),
    /** User IDs tagged; requires `place`. */
    tags: z.array(GraphNodeIdSchema).min(1).optional(),
    /** Default true. Set false with scheduled_publish_time to schedule. */
    published: z.boolean().optional(),
    /** 10 minutes – 75 days ahead. */
    scheduled_publish_time: timeValue.optional(),
    backdated_time: timeValue.optional(),
    backdated_time_granularity: BackdatedGranularitySchema.optional(),
    child_attachments: z.array(ChildAttachmentSchema).min(FACEBOOK_CHILD_ATTACHMENTS.min).max(FACEBOOK_CHILD_ATTACHMENTS.maxOptimized).optional(),
    multi_share_optimized: z.boolean().optional(),
    multi_share_end_card: z.boolean().optional(),
    targeting: FacebookTargetingSchema.optional(),
    feed_targeting: FacebookTargetingSchema.optional(),
    call_to_action: z.looseObject({ type: z.string(), value: z.looseObject({}).optional() }).optional(),
    og_action_type_id: z.string().optional(),
    og_object_id: z.string().optional(),
    og_icon_id: z.string().optional(),
  })
  .refine((v) => v.message !== undefined || v.link !== undefined, { message: "message or link is required", path: ["message"] })
  .refine((v) => !v.tags || v.place, { message: "tags requires place", path: ["tags"] })
  .refine((v) => v.scheduled_publish_time === undefined || v.published === false, {
    message: "scheduled_publish_time requires published=false",
    path: ["published"],
  })
  .refine(
    (v) => !v.child_attachments || v.multi_share_optimized || v.child_attachments.length <= FACEBOOK_CHILD_ATTACHMENTS.max,
    { message: `More than ${FACEBOOK_CHILD_ATTACHMENTS.max} child_attachments requires multi_share_optimized`, path: ["child_attachments"] },
  );
export type CreatePostInput = z.input<typeof CreatePostInputSchema>;

export const GetPostInputSchema = z.object({ postId: PagePostIdSchema, fields });
export type GetPostInput = z.input<typeof GetPostInputSchema>;

/** POST /{page-post-id}. Only posts created by the same app can be updated. */
export const UpdatePostInputSchema = z
  .object({
    postId: PagePostIdSchema,
    message: z.string().optional(),
    is_hidden: z.boolean().optional(),
    is_published: z.boolean().optional(),
    is_pinned: z.boolean().optional(),
    scheduled_publish_time: z.number().int().optional(),
    backdated_time: timeValue.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "Nothing to update", path: ["message"] });
export type UpdatePostInput = z.input<typeof UpdatePostInputSchema>;

// ---------- photos ----------

export const UploadPhotoInputSchema = z
  .object({
    /** `url` sources are passed to Meta as `url`; bytes are uploaded as multipart `source`. */
    media: MediaSourceSchema,
    caption: z.string().optional(),
    /** false = upload without publishing (use the returned id later). */
    published: z.boolean().optional(),
    /** Required true when an unpublished photo will be used in a scheduled post. */
    temporary: z.boolean().optional(),
    scheduled_publish_time: z.number().int().optional(),
    unpublished_content_type: z.enum(["SCHEDULED", "DRAFT", "PUBLISHED"]).optional(),
    no_story: z.boolean().optional(),
    alt_text_custom: z.string().optional(),
    place: GraphNodeIdSchema.optional(),
    backdated_time: timeValue.optional(),
  })
  .refine((v) => v.scheduled_publish_time === undefined || v.published === false, {
    message: "scheduled_publish_time requires published=false",
    path: ["published"],
  });
export type UploadPhotoInput = z.input<typeof UploadPhotoInputSchema>;

export const UploadPhotoResponseSchema = z.looseObject({ id: z.string(), post_id: z.string().optional() });
export type UploadPhotoResponse = z.infer<typeof UploadPhotoResponseSchema>;

export const ListPhotosInputSchema = z
  .object({ type: z.enum(["profile", "tagged", "uploaded"]).optional(), fields, ...cursor })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListPhotosInput = z.input<typeof ListPhotosInputSchema>;

export const FacebookPhotoSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  created_time: z.string().optional(),
  link: z.string().optional(),
  alt_text: z.string().optional(),
});
export type FacebookPhoto = z.infer<typeof FacebookPhotoSchema>;

// ---------- videos ----------

export const VideoContentCategorySchema = z.enum([
  "BEAUTY_FASHION", "BUSINESS", "CARS_TRUCKS", "COMEDY", "CUTE_ANIMALS", "ENTERTAINMENT", "FAMILY", "FOOD_HEALTH",
  "HOME", "LIFESTYLE", "MUSIC", "NEWS", "POLITICS", "SCIENCE", "SPORTS", "TECHNOLOGY", "VIDEO_GAMING", "OTHER",
]);

const videoMetadata = {
  title: z.string().optional(),
  description: z.string().optional(),
  content_category: VideoContentCategorySchema.optional(),
  /** Default true. */
  published: z.boolean().optional(),
  /** 10 minutes – 6 months ahead; requires published=false. */
  scheduled_publish_time: z.number().int().optional(),
  unpublished_content_type: z.enum(["SCHEDULED", "DRAFT", "PUBLISHED"]).optional(),
  no_story: z.boolean().optional(),
  secret: z.boolean().optional(),
  hide_from_newsfeed: z.boolean().optional(),
};
export const VideoMetadataSchema = z.object(videoMetadata);
export type VideoMetadata = z.input<typeof VideoMetadataSchema>;

export const UploadVideoInputSchema = z
  .object({
    /** `url` sources use `file_url` (single request); bytes use the chunked upload_phase protocol. */
    media: MediaSourceSchema,
    ...videoMetadata,
  })
  .refine((v) => v.scheduled_publish_time === undefined || v.published === false, {
    message: "scheduled_publish_time requires published=false",
    path: ["published"],
  });
export type UploadVideoInput = z.input<typeof UploadVideoInputSchema>;

export const StartVideoUploadInputSchema = z.object({ file_size: z.number().int().min(1) });
export const StartVideoUploadResponseSchema = z.looseObject({
  video_id: z.string(),
  upload_session_id: z.string(),
  start_offset: z.coerce.number().int(),
  end_offset: z.coerce.number().int(),
});
export type StartVideoUploadResponse = z.infer<typeof StartVideoUploadResponseSchema>;

export const TransferVideoChunkInputSchema = z.object({
  upload_session_id: z.string().min(1),
  start_offset: z.number().int().min(0),
  video_file_chunk: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: "Expected bytes" }),
});
export type TransferVideoChunkInput = z.input<typeof TransferVideoChunkInputSchema>;

export const TransferVideoChunkResponseSchema = z.looseObject({
  start_offset: z.coerce.number().int(),
  end_offset: z.coerce.number().int(),
});

export const FinishVideoUploadInputSchema = z.object({ upload_session_id: z.string().min(1), ...videoMetadata });
export type FinishVideoUploadInput = z.input<typeof FinishVideoUploadInputSchema>;

export const UploadVideoResponseSchema = z.looseObject({
  id: z.string().optional(),
  video_id: z.string().optional(),
  success: z.boolean().optional(),
  post_id: z.string().optional(),
});
export type UploadVideoResponse = z.infer<typeof UploadVideoResponseSchema>;

const phaseStatus = z.looseObject({ status: z.string().optional(), bytes_transfered: z.number().optional() });
export const FacebookVideoStatusSchema = z.looseObject({
  id: z.string(),
  status: z
    .looseObject({
      video_status: z.string().optional(),
      uploading_phase: phaseStatus.optional(),
      processing_phase: phaseStatus.optional(),
      publishing_phase: phaseStatus.optional(),
    })
    .optional(),
});
export type FacebookVideoStatus = z.infer<typeof FacebookVideoStatusSchema>;

// ---------- reels ----------

export const StartReelUploadResponseSchema = z.looseObject({ video_id: z.string(), upload_url: z.string() });
export type StartReelUploadResponse = z.infer<typeof StartReelUploadResponseSchema>;

export const UploadReelInputSchema = z.object({
  /** `upload_url` from startReelUpload. */
  uploadUrl: z.url(),
  /** URL sources are fetched by Meta (file_url header; Meta CDN URLs are rejected). */
  media: MediaSourceSchema,
});
export type UploadReelInput = z.input<typeof UploadReelInputSchema>;

const finishReelBase = z.object({
    video_id: GraphNodeIdSchema,
    video_state: z.enum(["PUBLISHED", "DRAFT", "SCHEDULED"]),
    description: z.string().optional(),
    title: z.string().optional(),
    place: GraphNodeIdSchema.optional(),
    /** > 10 minutes and < 29 days ahead; required with SCHEDULED. */
    scheduled_publish_time: timeValue.optional(),
    is_ai_generated: z.boolean().optional(),
    targeting: FacebookTargetingSchema.optional(),
    feed_targeting: FacebookTargetingSchema.optional(),
  });
const scheduledRule: [
  (v: { video_state: string; scheduled_publish_time?: unknown }) => boolean,
  { message: string; path: string[] },
] = [
  (v) => (v.video_state === "SCHEDULED") === (v.scheduled_publish_time !== undefined),
  { message: "scheduled_publish_time is required with (and only with) video_state=SCHEDULED", path: ["scheduled_publish_time"] },
];
export const FinishReelInputSchema = finishReelBase.refine(...scheduledRule);
export type FinishReelInput = z.input<typeof FinishReelInputSchema>;

export const FinishReelResponseSchema = z.looseObject({
  success: z.boolean().optional(),
  message: z.string().optional(),
  post_id: z.string().optional(),
  video_id: z.string().optional(),
});
export type FinishReelResponse = z.infer<typeof FinishReelResponseSchema>;

/** startReelUpload → uploadReel → finishReel in one call. */
export const PublishReelInputSchema = finishReelBase
  .omit({ video_id: true })
  .extend({ media: MediaSourceSchema })
  .refine(...scheduledRule);
export type PublishReelInput = z.input<typeof PublishReelInputSchema>;

// ---------- comments ----------

export const FacebookCommentSchema = z.looseObject({
  id: z.string(),
  message: z.string().optional(),
  created_time: z.string().optional(),
  from: fromSchema.optional(),
  can_comment: z.boolean().optional(),
  can_reply_privately: z.boolean().optional(),
  comment_count: z.number().int().optional(),
  is_private: z.boolean().optional(),
  is_hidden: z.boolean().optional(),
  like_count: z.number().int().optional(),
  live_broadcast_timestamp: z.number().optional(),
  parent: z.looseObject({ id: z.string() }).optional(),
  user_likes: z.boolean().optional(),
});
export type FacebookComment = z.infer<typeof FacebookCommentSchema>;

export const FacebookCommentListSchema = graphListSchema(FacebookCommentSchema).extend({
  summary: z
    .looseObject({
      order: z.enum(["chronological", "reverse_chronological"]).optional(),
      total_count: z.number().int().optional(),
    })
    .optional(),
});

export const ListCommentsInputSchema = z
  .object({
    objectId: GraphNodeIdSchema,
    /** Default toplevel; stream = all comments incl. replies, chronological. */
    filter: z.enum(["toplevel", "stream"]).optional(),
    order: z.enum(["chronological", "reverse_chronological"]).optional(),
    summary: z.boolean().optional(),
    fields,
    ...cursor,
  })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListCommentsInput = z.input<typeof ListCommentsInputSchema>;

const commentContent = {
  message: z.string().min(1).optional(),
  attachment_id: GraphNodeIdSchema.optional(),
  attachment_share_url: z.url().optional(),
  attachment_url: z.url().optional(),
};
const hasContent = (v: { message?: string; attachment_id?: string; attachment_share_url?: string; attachment_url?: string }) =>
  Boolean(v.message || v.attachment_id || v.attachment_share_url || v.attachment_url);

export const CreateCommentInputSchema = z
  .object({ objectId: GraphNodeIdSchema, ...commentContent })
  .refine(hasContent, { message: "Provide message or an attachment", path: ["message"] });
export type CreateCommentInput = z.input<typeof CreateCommentInputSchema>;

export const GetCommentInputSchema = z.object({ commentId: GraphNodeIdSchema, fields });
export type GetCommentInput = z.input<typeof GetCommentInputSchema>;

export const UpdateCommentInputSchema = z
  .object({ commentId: GraphNodeIdSchema, ...commentContent, is_hidden: z.boolean().optional() })
  .refine((v) => hasContent(v) || v.is_hidden !== undefined, { message: "Nothing to update", path: ["message"] });
export type UpdateCommentInput = z.input<typeof UpdateCommentInputSchema>;

// ---------- reactions ----------

export const FacebookReactionTypeSchema = z.enum(["NONE", "LIKE", "LOVE", "WOW", "HAHA", "SORRY", "ANGRY"]);

export const FacebookReactionSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
});
export type FacebookReaction = z.infer<typeof FacebookReactionSchema>;

export const FacebookReactionListSchema = graphListSchema(FacebookReactionSchema).extend({
  summary: z.looseObject({ total_count: z.number().int().optional(), viewer_reaction: z.string().optional() }).optional(),
});

export const ListReactionsInputSchema = z
  .object({
    objectId: GraphNodeIdSchema,
    type: FacebookReactionTypeSchema.optional(),
    summary: z.array(z.enum(["total_count", "viewer_reaction"])).min(1).optional(),
    ...cursor,
  })
  .refine(noBeforeAndAfter, NO_BEFORE_AND_AFTER);
export type ListReactionsInput = z.input<typeof ListReactionsInputSchema>;

// ---------- insights ----------

export const InsightsPeriodSchema = z.enum(["day", "week", "days_28", "month", "lifetime", "total_over_range"]);

const insightsParams = {
  metric: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
  period: InsightsPeriodSchema.optional(),
  since: timeValue.optional(),
  until: timeValue.optional(),
  date_preset: z.string().regex(/^[a-z0-9_]+$/).optional(),
  breakdown: z.string().regex(/^[a-z0-9_]+$/).optional(),
  show_description_from_api_doc: z.boolean().optional(),
};

export const GetPageInsightsInputSchema = z.object(insightsParams);
export type GetPageInsightsInput = z.input<typeof GetPageInsightsInputSchema>;

export const GetPostInsightsInputSchema = z.object({ postId: PagePostIdSchema, ...insightsParams });
export type GetPostInsightsInput = z.input<typeof GetPostInsightsInputSchema>;

export const FacebookInsightSchema = z.looseObject({
  name: z.string(),
  period: z.string().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  id: z.string().optional(),
  values: z
    .array(
      z.looseObject({
        /** Number for most metrics; an object keyed by dimension for breakdown metrics. */
        value: z.union([z.number(), z.record(z.string(), z.number())]),
        end_time: z.string().optional(),
      }),
    )
    .optional(),
});
export type FacebookInsight = z.infer<typeof FacebookInsightSchema>;
export const FacebookInsightsResponseSchema = graphListSchema(FacebookInsightSchema);

// ---------- webhooks ----------

export const PageWebhookFieldSchema = z.string().regex(/^[a-z_]+$/);

export const SubscribeAppInputSchema = z.object({
  /** e.g. feed, mention, videos, follow (must also be subscribed at app level). */
  subscribed_fields: z.array(PageWebhookFieldSchema).min(1),
});
export type SubscribeAppInput = z.input<typeof SubscribeAppInputSchema>;

export const SubscribedAppSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  subscribed_fields: z.array(z.string()).optional(),
});
export const SubscribedAppsResponseSchema = graphListSchema(SubscribedAppSchema);
export type SubscribedApp = z.infer<typeof SubscribedAppSchema>;

export const PageWebhookPayloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      id: z.string(),
      time: z.number(),
      changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })).optional(),
    }),
  ),
});
export type PageWebhookPayload = z.infer<typeof PageWebhookPayloadSchema>;
