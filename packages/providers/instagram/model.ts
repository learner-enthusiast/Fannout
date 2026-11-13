import { z } from "zod";
import { composeField, type ComposeCapabilities } from "../common/compose";
import {
  INSTAGRAM_ALT_TEXT_MAX,
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_CAROUSEL_MAX,
  INSTAGRAM_CAROUSEL_MIN,
  INSTAGRAM_COLLABORATORS_MAX,
  INSTAGRAM_HASHTAGS_MAX,
  INSTAGRAM_IMAGE,
  INSTAGRAM_MENTIONS_MAX,
  INSTAGRAM_REEL,
} from "./constants";

// ---------- ids & account ----------

export const InstagramIdSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, "Invalid Instagram id");
export const InstagramUsernameSchema = z.string().trim().regex(/^[A-Za-z0-9_.]{1,30}$/, "Use letters, numbers, periods and underscores (no @)");

export const InstagramAccountSchema = z.looseObject({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  followers_count: z.number().optional(),
  media_count: z.number().optional(),
});
export type InstagramAccount = z.infer<typeof InstagramAccountSchema>;

// ---------- post types & containers ----------

export const InstagramPostTypeSchema = z.enum(["reel", "image", "carousel"]);
export type InstagramPostType = z.infer<typeof InstagramPostTypeSchema>;

export const InstagramContainerStatusCodeSchema = z.enum(["EXPIRED", "ERROR", "FINISHED", "IN_PROGRESS", "PUBLISHED"]);
export const InstagramContainerStatusSchema = z.looseObject({
  id: z.string(),
  status_code: InstagramContainerStatusCodeSchema,
});
export type InstagramContainerStatus = z.infer<typeof InstagramContainerStatusSchema>;

const url = z.url();

export const CreateReelContainerInputSchema = z.object({
  media_type: z.literal("REELS"),
  video_url: url,
  caption: z.string().max(INSTAGRAM_CAPTION_MAX).optional(),
  share_to_feed: z.boolean().optional(),
  /** cover_url wins over thumb_offset when both are sent. */
  cover_url: url.optional(),
  thumb_offset: z.number().int().nonnegative().optional(),
  collaborators: z.array(InstagramUsernameSchema).max(INSTAGRAM_COLLABORATORS_MAX).optional(),
});
export type CreateReelContainerInput = z.input<typeof CreateReelContainerInputSchema>;

export const CreateImageContainerInputSchema = z.object({
  image_url: url,
  caption: z.string().max(INSTAGRAM_CAPTION_MAX).optional(),
  alt_text: z.string().max(INSTAGRAM_ALT_TEXT_MAX).optional(),
});
export type CreateImageContainerInput = z.input<typeof CreateImageContainerInputSchema>;

/** Carousel child: an image or a video, never captioned. */
export const CreateCarouselItemInputSchema = z.union([
  z.object({ image_url: url, alt_text: z.string().max(INSTAGRAM_ALT_TEXT_MAX).optional() }),
  z.object({ media_type: z.literal("VIDEO"), video_url: url }),
]);
export type CreateCarouselItemInput = z.input<typeof CreateCarouselItemInputSchema>;

export const CreateCarouselContainerInputSchema = z.object({
  children: z.array(z.string().min(1)).min(INSTAGRAM_CAROUSEL_MIN).max(INSTAGRAM_CAROUSEL_MAX),
  caption: z.string().max(INSTAGRAM_CAPTION_MAX).optional(),
});
export type CreateCarouselContainerInput = z.input<typeof CreateCarouselContainerInputSchema>;

export const InstagramMediaSchema = z.looseObject({ id: z.string(), permalink: z.string().optional(), timestamp: z.string().optional() });
export type InstagramMedia = z.infer<typeof InstagramMediaSchema>;

export const InstagramRecentMediaSchema = z.looseObject({ data: z.array(InstagramMediaSchema) });

export const InstagramPublishingLimitSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      quota_usage: z.number(),
      config: z.looseObject({ quota_total: z.number(), quota_duration: z.number().optional() }).optional(),
    }),
  ),
});
export type InstagramPublishingLimit = z.infer<typeof InstagramPublishingLimitSchema>;

// ---------- insights ----------

export const InstagramInsightSchema = z.looseObject({
  name: z.string(),
  period: z.string().optional(),
  values: z.array(z.looseObject({ value: z.union([z.number(), z.record(z.string(), z.unknown())]).optional(), end_time: z.string().optional() })).optional(),
  total_value: z.looseObject({ value: z.number().optional() }).optional(),
});
export type InstagramInsight = z.infer<typeof InstagramInsightSchema>;
/** An empty `data` array means "no data yet", not zero. */
export const InstagramInsightsResponseSchema = z.looseObject({ data: z.array(InstagramInsightSchema) });

/** Per post type: asking for an unsupported metric fails the WHOLE request. Never impressions. */
export const INSTAGRAM_MEDIA_METRICS = {
  reel: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
  image: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"],
  carousel: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"],
} as const satisfies Record<InstagramPostType, readonly string[]>;
export const INSTAGRAM_ACCOUNT_METRICS = ["reach", "views", "total_interactions"] as const;

// ---------- compose ----------

const countMatches = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const MENTION = /(?<![\w.])@[A-Za-z0-9._]+/g;

export const InstagramCaptionSchema = z
  .string()
  .max(INSTAGRAM_CAPTION_MAX, `Captions can be at most ${INSTAGRAM_CAPTION_MAX} characters`)
  .refine((v) => countMatches(v, HASHTAG) <= INSTAGRAM_HASHTAGS_MAX, `Use at most ${INSTAGRAM_HASHTAGS_MAX} hashtags`)
  .refine((v) => countMatches(v, MENTION) <= INSTAGRAM_MENTIONS_MAX, `Mention at most ${INSTAGRAM_MENTIONS_MAX} accounts`);

export const InstagramComposeInputSchema = z.object({
  caption: composeField(InstagramCaptionSchema.optional(), {
    label: "Caption",
    description: "Caption (max 2,200 characters, 30 hashtags, 20 @mentions). Mentions are plain @username text.",
    kind: "textarea",
    countMode: "chars",
    maxLength: INSTAGRAM_CAPTION_MAX,
    ai: true,
  }),
  shareToFeed: composeField(z.boolean().default(true), {
    label: "Also share to feed",
    description: "Reels only: also show the reel in the profile feed grid (default true).",
    kind: "toggle",
    defaultValue: true,
    mediaType: "video",
  }),
  thumbOffsetMs: composeField(z.coerce.number().int().min(0).optional(), {
    label: "Cover frame (ms)",
    description: "Reels only: millisecond offset of the video frame used as cover. Ignored when a cover image is picked.",
    kind: "text",
    mediaType: "video",
    helper: "Only used when no cover image is picked.",
  }),
  altText: composeField(z.string().max(INSTAGRAM_ALT_TEXT_MAX).optional(), {
    label: "Alt text",
    description: "Image alt text (max 1,000 characters). Photos only; ignored for reels.",
    kind: "text",
    countMode: "chars",
    maxLength: INSTAGRAM_ALT_TEXT_MAX,
    mediaType: "photos",
  }),
  collaborators: composeField(z.array(InstagramUsernameSchema).max(INSTAGRAM_COLLABORATORS_MAX).optional(), {
    label: "Collaborators",
    description: "Reels only: up to 3 Instagram usernames to invite as collaborators (no @).",
    kind: "tags",
    mediaType: "video",
  }),
});
export type InstagramComposeInput = z.infer<typeof InstagramComposeInputSchema>;

export const INSTAGRAM_DELETE_EDIT_NOTE = "Delete or edit this post in the Instagram app";

export const INSTAGRAM_COMPOSE: ComposeCapabilities = {
  mentions: {
    supported: true,
    kind: "handle",
    note: "Type @username in the caption; Instagram tags the account when the post is published (plain text, no lookup).",
  },
  supportsVideo: true,
  supportsPhotos: true,
  maxPhotos: INSTAGRAM_CAROUSEL_MAX,
  minCarousel: 1,
  supportsThumbnail: true,
  mediaRules: {
    maxVideoBytes: INSTAGRAM_REEL.maxBytes,
    minVideoSeconds: INSTAGRAM_REEL.minSeconds,
    maxVideoSeconds: INSTAGRAM_REEL.maxSeconds,
    maxImageBytes: INSTAGRAM_IMAGE.maxBytes,
    videoMimeTypes: [...INSTAGRAM_REEL.mimeTypes],
    imageMimeTypes: [...INSTAGRAM_IMAGE.mimeTypes],
    requiresPublicUrl: true,
  },
  supportsDelete: false,
  deleteNote: INSTAGRAM_DELETE_EDIT_NOTE,
  supportsEdit: false,
  editableFields: [],
  editNote: INSTAGRAM_DELETE_EDIT_NOTE,
};

/** reel = video; image = one photo; carousel = 2+ photos. */
export function instagramPostType(mediaType: "video" | "photos", photoCount: number): InstagramPostType {
  if (mediaType === "video") return "reel";
  return photoCount > 1 ? "carousel" : "image";
}
