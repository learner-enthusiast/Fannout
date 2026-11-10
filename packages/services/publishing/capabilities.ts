import { readComposeMeta, type ComposeFieldMeta } from "@repo/providers";
import { z } from "zod";
import { ANALYTICS_CAPABILITIES } from "../analytics/capabilities";
import { AnalyticsCapabilitySchema } from "../analytics/model";
import { PLATFORMS, type Platform } from "./platforms";

export const ComposeFieldSchema = z.object({
  name: z.string().describe("Key to use in targets[].input."),
  label: z.string().describe("Human-readable field name."),
  description: z.string().describe("What the field does and its limits."),
  kind: z.enum(["text", "textarea", "select", "toggle", "tags", "playlist", "radio"]).describe("Input kind: text/textarea = string, toggle/radio = boolean or option value, select = option value, tags = string[], playlist = playlist ID."),
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
});
export type ComposeField = z.infer<typeof ComposeFieldSchema>;

export const PlatformCapabilitiesSchema = z.object({
  platform: z.enum(["youtube", "x", "linkedin", "threads", "facebook"]).describe("Platform key."),
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
  supportsThumbnail: z.boolean().describe("Accepts a custom video thumbnail (thumbnailByConnection)."),
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
    requiresPublicUrl: z.boolean().optional().describe("The platform fetches media from a public URL."),
    billed: z.boolean().optional().describe("The platform bills API usage for posting."),
  }).describe("Media limits checked by POST /posts/validate."),
  analytics: AnalyticsCapabilitySchema.describe("Analytics Fannout syncs for this platform (dashboard)."),
});
export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

/** Field descriptors read from the platform's compose schema (`.meta()` + optionality). */
export function describeFields(schema: z.ZodObject): ComposeField[] {
  return Object.entries(schema.shape).flatMap(([name, field]) => {
    const meta: ComposeFieldMeta | undefined = readComposeMeta(field as z.ZodType);
    if (!meta) return [];
    const required = !(field as z.ZodType).safeParse(undefined).success;
    return [ComposeFieldSchema.parse({ name, required, ...meta })];
  });
}

export function platformCapabilities(platform: Platform): PlatformCapabilities {
  const definition = PLATFORMS[platform];
  return {
    platform,
    label: definition.label,
    ...definition.capabilities,
    fields: describeFields(definition.schema),
    analytics: ANALYTICS_CAPABILITIES[platform],
  };
}

export function allCapabilities(): PlatformCapabilities[] {
  return (Object.keys(PLATFORMS) as Platform[]).map(platformCapabilities);
}
