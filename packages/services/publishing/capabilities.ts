import { POST_TYPES, type PostType } from "@repo/ai/prompts/length-targets-api";
import { IMAGE_FORMATS, readComposeMeta, type ComposeFieldMeta } from "@repo/providers";
import { z } from "zod";
import { ANALYTICS_CAPABILITIES } from "../analytics/capabilities";
import { AnalyticsCapabilitySchema } from "../analytics/model";
import { aiBandFor } from "../ai-content/targets";
import { PLATFORMS, type Platform } from "./platforms";

const AiBandSchema = z.object({
  min: z.number().int().describe("Lower end of the length AI aims for."),
  max: z.number().int().describe("Upper end of the length AI aims for."),
});

const ImageSlotRuleSchema = z.object({
  acceptedImageFormats: z.array(z.enum(IMAGE_FORMATS)).describe("Image formats the platform API takes for this slot. Other formats are converted by Fannout (to JPEG) before publishing, keeping the exact width, height and aspect ratio."),
  maxImageBytes: z.number().int().describe("Largest image in bytes for this slot. Larger images are re-encoded (and, as a last resort, scaled down proportionally) to fit; never cropped or padded."),
  aspectRatio: z.object({
    min: z.number().describe("Smallest width / height allowed (e.g. 0.8 = 4:5)."),
    max: z.number().describe("Largest width / height allowed (e.g. 1.91 = 1.91:1)."),
  }).optional().describe("Shapes the platform accepts. Fannout never reshapes images: one outside this range is a validation error."),
});

export const ComposeFieldSchema = z.object({
  name: z.string().describe("Key to use in targets[].input."),
  label: z.string().describe("Human-readable field name."),
  description: z.string().describe("What the field does and its limits."),
  kind: z.enum(["text", "textarea", "select", "toggle", "tags", "playlist", "radio", "relatedVideo"]).describe("Input kind: text/textarea = string, toggle/radio = boolean or option value, select = option value, tags = string[], playlist = playlist ID, relatedVideo = { videoId, title, watchNext? } from the channel's uploads."),
  required: z.boolean().describe("Whether the field must be sent."),
  maxLength: z.number().int().optional().describe("Length limit, counted per countMode."),
  countMode: z.enum(["chars", "bytes", "weighted"]).optional().describe("How maxLength is counted: chars, UTF-8 bytes, or X-weighted (URLs count 23)."),
  options: z.array(z.object({
    value: z.union([z.string(), z.boolean()]).describe("Value to send."),
    label: z.string().describe("Human-readable option."),
    description: z.string().optional().describe("Help text for this option."),
  })).optional().describe("Allowed values for select/radio fields."),
  optionsSource: z.literal("youtube.categories").optional().describe("Options come from GET /platforms/youtube/{socialConnectionId}/categories."),
  defaultValue: z.union([z.string(), z.boolean()]).optional().describe("Value the web composer pre-fills (still send it when required)."),
  mediaType: z.enum(["video", "photos"]).optional().describe("Field only applies to this media type."),
  helper: z.string().optional().describe("Extra hint shown in the web composer."),
  /** AI can write this field. */
  ai: z.boolean().optional().describe("POST /ai/generations can write this field."),
  aiBands: z.object({
    video: AiBandSchema.optional().describe("Band for a regular video post."),
    short: AiBandSchema.optional().describe("Band for a vertical short (Shorts/Reels)."),
    image: AiBandSchema.optional().describe("Band for a single-photo post."),
    carousel: AiBandSchema.optional().describe("Band for a multi-photo post."),
  }).optional().describe("Length band AI aims for per post type, in the field's countMode units (always within maxLength). Shorter text is still valid."),
});
export type ComposeField = z.infer<typeof ComposeFieldSchema>;

export const PlatformCapabilitiesSchema = z.object({
  platform: z.enum(["youtube", "x", "linkedin", "threads", "facebook", "instagram"]).describe("Platform key."),
  mentions: z.object({
    supported: z.boolean().describe("Whether the composer can insert mention contacts."),
    kind: z.enum(["handle", "urn", "page", "text_only"]).describe("How the platform represents mentions."),
    note: z.string().describe("Syntax and platform limitations."),
  }).describe("Mention support for the main text field."),
  label: z.string().describe("Platform name."),
  supportsVideo: z.boolean().describe("Can publish a video."),
  supportsPhotos: z.boolean().describe("Can publish photos."),
  maxPhotos: z.number().int().describe("Most photos per post."),
  minCarousel: z.number().int().describe("Fewest photos for a multi-photo post."),
  carouselMode: z.enum(["api", "manual", "none"]).describe("Multi-photo posts: api = Fannout publishes them; manual = the platform has no API for them, so the post is stored as a manual post (status draft) for the user to publish by hand; none = unsupported."),
  carouselMax: z.number().int().describe("Most photos in a multi-photo post."),
  tagging: z.object({
    image: z.enum(["positioned", "list", "none"]).describe("Tags on photos: positioned = username + x/y (0–1), list = usernames only."),
    video: z.enum(["list", "none"]).describe("Tags on videos: list = usernames only."),
    max: z.number().int().describe("Most tags per media item (Instagram) or per post (X)."),
    needsUserId: z.boolean().describe("Tags are sent as user IDs: resolve usernames first (POST /mentions/x/resolve)."),
  }).describe("People tagged on media, separate from @mentions in the text."),
  collaborators: z.object({ max: z.number().int().describe("Most collaborators per post.") }).nullable().describe("Collaborator invites; null when the platform has none."),
  supportsThumbnail: z.boolean().describe("Accepts a custom video thumbnail (thumbnailByConnection)."),
  thumbnailRules: z.object({
    maxBytes: z.number().describe("Largest thumbnail in bytes."),
    mimeTypes: z.array(z.string()).describe("Accepted thumbnail MIME types."),
    aspect: z.enum(["landscape", "portrait"]).describe("Shape the platform shows; the web composer assigns picked images by it."),
    recommended: z.string().describe("Recommended size, e.g. 1280×720 (16:9)."),
    note: z.string().optional().describe("Platform caveat (e.g. YouTube needs a verified channel)."),
  }).optional().describe("Custom thumbnail constraints checked by POST /posts/validate; absent when no thumbnail is supported or the platform documents none."),
  imageFormats: z.object({
    image: ImageSlotRuleSchema.optional().describe("A single-photo post."),
    carouselImage: ImageSlotRuleSchema.optional().describe("Each photo of a multi-photo post."),
    cover: ImageSlotRuleSchema.optional().describe("The custom video thumbnail / Reels cover (thumbnailByConnection)."),
  }).optional().describe("Image format needs per slot; absent slot = sent as uploaded. Images are converted automatically, keeping their original form factor."),
  perImageAltTextMax: z.number().int().optional().describe("Photo posts accept input.altTexts (media ID → alt text) up to this many characters each; absent = no per-image alt text."),
  supportsDelete: z.boolean().describe("Fannout can delete published posts here."),
  deleteNote: z.string().describe("Platform note about deletes."),
  supportsEdit: z.boolean().describe("Published posts can be edited."),
  editableFields: z.array(z.string()).describe("Compose fields PATCH /posts/{postId} accepts."),
  editNote: z.string().describe("Platform note about edits."),
  fields: z.array(ComposeFieldSchema).describe("Compose fields for targets[].input."),
  mediaRules: z.object({
    maxVideoBytes: z.number().optional().describe("Largest video in bytes."),
    minVideoSeconds: z.number().optional().describe("Shortest video in seconds."),
    maxVideoSeconds: z.number().optional().describe("Longest video in seconds."),
    maxImageBytes: z.number().optional().describe("Largest image in bytes."),
    shortMaxSeconds: z.number().optional().describe("Vertical videos up to this length publish as Shorts."),
    videoMimeTypes: z.array(z.string()).optional().describe("Accepted video MIME types (e.g. Instagram: video/mp4, video/quicktime)."),
    imageMimeTypes: z.array(z.string()).optional().describe("Image MIME types the platform API takes for photos and cover images. Fannout converts other images automatically (see imageFormats), so any image can be uploaded."),
    requiresPublicUrl: z.boolean().optional().describe("The platform fetches media from a public URL."),
    billed: z.boolean().optional().describe("The platform bills API usage for posting."),
  }).describe("Media limits checked by POST /posts/validate."),
  analytics: AnalyticsCapabilitySchema.describe("Analytics Fannout syncs for this platform (dashboard)."),
});
export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

/** Field descriptors read from the platform's compose schema (`.meta()` + optionality). */
export function describeFields(schema: z.ZodObject, platform?: Platform): ComposeField[] {
  return Object.entries(schema.shape).flatMap(([name, field]) => {
    const meta: ComposeFieldMeta | undefined = readComposeMeta(field as z.ZodType);
    if (!meta) return [];
    const required = !(field as z.ZodType).safeParse(undefined).success;
    const bands: Partial<Record<PostType, { min: number; max: number }>> = {};
    if (platform && meta.ai) {
      for (const postType of POST_TYPES) {
        const band = aiBandFor(platform, postType, name);
        if (band && band.min > 0) bands[postType] = { min: band.min, max: band.max };
      }
    }
    return [ComposeFieldSchema.parse({ name, required, ...meta, ...(Object.keys(bands).length ? { aiBands: bands } : {}) })];
  });
}

export function platformCapabilities(platform: Platform): PlatformCapabilities {
  const definition = PLATFORMS[platform];
  return {
    platform,
    label: definition.label,
    ...definition.capabilities,
    fields: describeFields(definition.schema, platform),
    analytics: ANALYTICS_CAPABILITIES[platform],
  };
}

export function allCapabilities(): PlatformCapabilities[] {
  return (Object.keys(PLATFORMS) as Platform[]).map(platformCapabilities);
}
