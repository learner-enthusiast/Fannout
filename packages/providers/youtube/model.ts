import { z } from "zod";
import { composeField, utf8Length, type ComposeCapabilities } from "../common/compose";

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

export const YOUTUBE_COMPOSE: ComposeCapabilities = {
  mentions: { supported: false, kind: "text_only", note: "YouTube titles and descriptions do not support mention tagging in this publishing flow." },
  supportsVideo: true,
  supportsPhotos: false,
  maxPhotos: 0,
  minCarousel: 0,
  supportsThumbnail: true,
  mediaRules: { maxVideoBytes: 256 * GB, maxVideoSeconds: 12 * 60 * 60, shortMaxSeconds: 180 },
  // videos.delete / videos.update — https://developers.google.com/youtube/v3/docs/videos/update
  supportsDelete: true,
  deleteNote: "Deletes the video from YouTube. Uses 50 of your 10,000 daily YouTube API quota units.",
  supportsEdit: true,
  editableFields: ["title", "description", "tags", "categoryId", "privacyStatus", "madeForKids", "playlistId", "thumbnail"],
  editNote: "Edits use 50 quota units; the video file can't be replaced.",
};

export const YouTubePrivacyStatusSchema = z.enum(["public", "unlisted", "private"]);

export const YouTubeComposeInputSchema = z.object({
  title: composeField(
    z.string().trim().min(1, "Add a title").max(100, "Titles can be at most 100 characters").refine((v) => !/[<>]/.test(v), "Titles can't contain < or >"),
    { label: "Title", description: "Video title shown on YouTube (1–100 characters, no < or >).", kind: "text", countMode: "chars", maxLength: 100, ai: true },
  ),
  description: composeField(
    z.string().refine((v) => utf8Length(v) <= 5000, "Descriptions can be at most 5,000 bytes").refine((v) => !/[<>]/.test(v), "Descriptions can't contain < or >").optional(),
    { label: "Description", description: "Video description (max 5,000 UTF-8 bytes, no < or >).", kind: "textarea", countMode: "bytes", maxLength: 5000, ai: true },
  ),
  privacyStatus: composeField(YouTubePrivacyStatusSchema, {
    label: "Privacy", description: "Who can watch: public, unlisted or private.",
    kind: "select",
    defaultValue: "public",
    options: [
      { value: "public", label: "Public" },
      { value: "unlisted", label: "Unlisted" },
      { value: "private", label: "Private" },
    ],
  }),
  madeForKids: composeField(z.boolean({ error: "Say whether the video is made for kids" }), {
    label: "Audience", description: "Required: whether the video is made for kids (COPPA). There is no default.",
    kind: "radio",
    helper: "Required by YouTube (COPPA). There is no default.",
    options: [
      { value: true, label: "Yes, it's made for kids" },
      { value: false, label: "No, it's not made for kids" },
    ],
  }),
  categoryId: composeField(z.string().regex(/^\d+$/, "Pick a category").optional(), {
    label: "Category", description: "YouTube category ID, from GET /platforms/youtube/{socialConnectionId}/categories.",
    kind: "select",
    optionsSource: "youtube.categories",
  }),
  tags: composeField(
    z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .refine((tags) => tags.join(",").length <= 500, "Tags can total at most 500 characters")
      .optional(),
    { label: "Tags", description: "Keywords (each 1–100 chars, at most 50 tags, 500 characters in total).", kind: "tags", maxLength: 500, ai: true },
  ),
  playlistId: composeField(z.string().min(1).optional(), { label: "Playlist", description: "Playlist ID to add the video to, from GET /platforms/youtube/{socialConnectionId}/playlists.", kind: "playlist" }),
  notifySubscribers: composeField(z.boolean().optional(), {
    label: "Notify subscribers", description: "Notify channel subscribers about the upload (default true).",
    kind: "toggle",
    defaultValue: true,
  }),
});
export type YouTubeComposeInput = z.infer<typeof YouTubeComposeInputSchema>;
