import { z } from "zod";
import { composeField, NO_TAGGING, utf8Length, type ComposeCapabilities } from "../common/compose";
import { YOUTUBE_COMMUNITY_POST_MAX, YOUTUBE_COMMUNITY_POST_MAX_IMAGES, YOUTUBE_VIDEO_ID_PATTERN } from "./constants";

/*
 * YouTube Data API v3 schemas. Resource and method-parameter schemas are
 * generated from the official @googleapis/youtube SDK (see
 * model.generated.ts / scripts/generate-google.mjs); hand-written schemas for
 * provider-specific helpers are below.
 */
export * from "./model.generated";

export const YouTubeDownloadCaptionInputSchema = z.object({
  /** Caption track id (captions.list). */
  id: z.string().min(1),
  /** sbv | scc | srt | ttml | vtt */
  tfmt: z.enum(["sbv", "scc", "srt", "ttml", "vtt"]).optional(),
  /** ISO 639-1 language to translate into. */
  tlang: z.string().optional(),
  onBehalfOf: z.string().optional(),
  onBehalfOfContentOwner: z.string().optional(),
});
export type YouTubeDownloadCaptionInput = z.input<typeof YouTubeDownloadCaptionInputSchema>;

// ---------------------------------------------------------------------------
// Compose (Fannout composer → publish one video). Single source for the UI
// fields and the server validation.
// ---------------------------------------------------------------------------


const GB = 1024 * 1024 * 1024;

/** snippet.tags budget (YouTube error "invalidTags": "The request metadata specifies invalid video keywords"). */
export const YOUTUBE_TAGS_MAX = 500;

/**
 * Tag length the way YouTube counts it: comma-separated, and a tag containing a space is wrapped in
 * quotes (+2). `tags.join(",").length` undercounts multi-word tags, which YouTube then rejects.
 */
export function youtubeTagsLength(tags: readonly string[]): number {
  return tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export const YOUTUBE_COMPOSE: ComposeCapabilities = {
  mentions: { supported: false, kind: "text_only", note: "YouTube titles and descriptions do not support mention tagging in this publishing flow." },
  supportsVideo: true,
  supportsPhotos: false,
  maxPhotos: 0,
  minCarousel: 0,
  // The YouTube app has image posts (up to 10 images) but the Data API v3 has no endpoint to
  // create them. Switch to "api" (and supportsPhotos) if that ever changes; nothing else needs to.
  carouselMode: "manual",
  carouselMax: YOUTUBE_COMMUNITY_POST_MAX_IMAGES,
  tagging: NO_TAGGING,
  collaborators: null,
  supportsThumbnail: true,
  // thumbnails.set — https://developers.google.com/youtube/v3/docs/thumbnails/set
  thumbnailRules: {
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png"],
    aspect: "landscape",
    recommended: "1280×720 (16:9)",
    note: "Custom thumbnails need a verified YouTube channel.",
  },
  // Same values as thumbnailRules (thumbnails.set): JPEG or PNG, ≤ 2 MB.
  imageFormats: { cover: { acceptedImageFormats: ["jpeg", "png"], maxImageBytes: 2 * 1024 * 1024 } },
  mediaRules: { maxVideoBytes: 256 * GB, maxVideoSeconds: 12 * 60 * 60, shortMaxSeconds: 180 },
  // videos.delete / videos.update — https://developers.google.com/youtube/v3/docs/videos/update
  supportsDelete: true,
  deleteNote: "Deletes the video from YouTube. Uses 50 of your 10,000 daily YouTube API quota units.",
  supportsEdit: true,
  editableFields: ["title", "description", "tags", "categoryId", "privacyStatus", "madeForKids", "playlistId", "thumbnail"],
  editNote: "Edits use 50 quota units; the video file can't be replaced.",
};

export const YouTubeRelatedVideoSchema = z.object({
  videoId: z.string().regex(YOUTUBE_VIDEO_ID_PATTERN, "Not a YouTube video ID").describe("ID of a video on the same channel (from GET /platforms/youtube/{socialConnectionId}/uploads)."),
  title: z.string().trim().min(1).max(200).describe("That video's title, shown in the task and the Watch next line."),
  watchNext: z.boolean().optional().describe("Long-form only: add \"Watch next: <title> https://youtu.be/<videoId>\" above the hashtags (default true)."),
});
export type YouTubeRelatedVideo = z.infer<typeof YouTubeRelatedVideoSchema>;

export const YouTubePrivacyStatusSchema = z.enum(["public", "unlisted", "private"]);

export const YouTubeComposeInputSchema = z.object({
  title: composeField(
    z.string().trim().min(1, "Add a title").max(100, "Titles can be at most 100 characters").refine((v) => !/[<>]/.test(v), "Titles can't contain < or >"),
    { mediaType: "video", label: "Title", description: "Video title shown on YouTube (1–100 characters, no < or >).", kind: "text", countMode: "chars", maxLength: 100, ai: true },
  ),
  description: composeField(
    z.string().refine((v) => utf8Length(v) <= 5000, "Descriptions can be at most 5,000 bytes").refine((v) => !/[<>]/.test(v), "Descriptions can't contain < or >").optional(),
    { mediaType: "video", label: "Description", description: "Video description (max 5,000 UTF-8 bytes, no < or >).", kind: "textarea", countMode: "bytes", maxLength: 5000, ai: true },
  ),
  privacyStatus: composeField(YouTubePrivacyStatusSchema, {
    mediaType: "video", label: "Privacy", description: "Who can watch: public, unlisted or private.",
    kind: "select",
    defaultValue: "public",
    options: [
      { value: "public", label: "Public" },
      { value: "unlisted", label: "Unlisted" },
      { value: "private", label: "Private" },
    ],
  }),
  madeForKids: composeField(z.boolean({ error: "Say whether the video is made for kids" }), {
    mediaType: "video", label: "Audience", description: "Required: whether the video is made for kids (COPPA). There is no default.",
    kind: "radio",
    helper: "Required by YouTube (COPPA). There is no default.",
    options: [
      { value: true, label: "Yes, it's made for kids" },
      { value: false, label: "No, it's not made for kids" },
    ],
  }),
  categoryId: composeField(z.string().regex(/^\d+$/, "Pick a category").optional(), {
    mediaType: "video", label: "Category", description: "YouTube category ID, from GET /platforms/youtube/{socialConnectionId}/categories.",
    kind: "select",
    optionsSource: "youtube.categories",
  }),
  tags: composeField(
    z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((tag) => !/[<>,]/.test(tag), "Tags can't contain <, > or commas"),
      )
      .max(50)
      .refine((tags) => youtubeTagsLength(tags) <= YOUTUBE_TAGS_MAX, "Tags can total at most 500 characters (a tag with spaces counts 2 more for its quotes)")
      .optional(),
    {
      mediaType: "video",
      label: "Tags",
      description: "Keywords (each 1–100 chars, no <, > or commas, at most 50 tags). Total at most 500 characters as YouTube counts it: tags joined by commas, and a tag containing a space counts 2 more (YouTube wraps it in quotes).",
      kind: "tags",
      maxLength: YOUTUBE_TAGS_MAX,
      ai: true,
    },
  ),
  playlistId: composeField(z.string().min(1).optional(), { mediaType: "video", label: "Playlist", description: "Playlist ID to add the video to, from GET /platforms/youtube/{socialConnectionId}/playlists.", kind: "playlist" }),
  notifySubscribers: composeField(z.boolean().optional(), {
    mediaType: "video", label: "Notify subscribers", description: "Notify channel subscribers about the upload (default true).",
    kind: "toggle",
    defaultValue: true,
  }),
  relatedVideo: composeField(YouTubeRelatedVideoSchema.optional(), {
    mediaType: "video",
    label: "Related video",
    description:
      "A video from the same channel to point viewers to: { videoId, title, watchNext? }. The Data API can't set a Short's related video or end screens, so Fannout creates a follow-up task with a YouTube Studio link after publishing. watchNext (default true) also adds a \"Watch next\" link to the description of long-form videos (never Shorts).",
    kind: "relatedVideo",
    helper: "YouTube's API can't set this. After publishing you get a task with a link to YouTube Studio.",
  }),
  communityText: composeField(z.string().max(YOUTUBE_COMMUNITY_POST_MAX, `Posts can be at most ${YOUTUBE_COMMUNITY_POST_MAX} characters`).optional(), {
    mediaType: "photos",
    label: "Post text",
    description: "Text of a YouTube image post (2–10 photos). YouTube has no API for image posts: Fannout stores it as a manual post for you to publish in the YouTube app.",
    kind: "textarea",
    countMode: "chars",
    maxLength: YOUTUBE_COMMUNITY_POST_MAX,
    ai: true,
  }),
});
export type YouTubeComposeInput = z.infer<typeof YouTubeComposeInputSchema>;

/** Compose fields that make up a manual post (photos) — the only ones validated for it. */
export const YOUTUBE_MANUAL_FIELDS = ["communityText"] as const;

const WATCH_URL = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([A-Za-z0-9_-]{11})/;

/** A pasted YouTube URL (watch, youtu.be, shorts, live, embed) or a bare id → video id, else null. */
export function youtubeVideoIdFromUrl(value: string): string | null {
  const text = value.trim();
  if (YOUTUBE_VIDEO_ID_PATTERN.test(text)) return text;
  return WATCH_URL.exec(text)?.[1] ?? null;
}
