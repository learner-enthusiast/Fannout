import { readComposeMeta, utf8Length, xWeightedLength, type ComposeFieldMeta } from "@repo/providers";
import { z } from "zod";
import { PLATFORMS, type Platform } from "../publishing/platforms";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";

/**
 * AI output fields are the compose fields marked `ai: true` in each
 * platform's model.ts; their validators ARE those field schemas, so limits
 * live in one place (e.g. the Instagram caption schema caps hashtags and mentions).
 */

export type AiField = {
  name: string;
  label: string;
  kind: ComposeFieldMeta["kind"];
  maxLength?: number;
  countMode: "chars" | "bytes" | "weighted";
  mediaType?: "video" | "photos";
  /** The platform's own field schema (required for output). */
  validator: z.ZodType;
};

function unwrapOptional(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema;
}

export function aiFieldsFor(platform: Platform, mediaType: "video" | "photos"): AiField[] {
  const shape = PLATFORMS[platform].schema.shape as Record<string, z.ZodType>;
  return Object.entries(shape).flatMap(([name, schema]) => {
    const meta = readComposeMeta(schema);
    if (!meta?.ai || (meta.mediaType && meta.mediaType !== mediaType)) return [];
    return [
      {
        name,
        label: meta.label,
        kind: meta.kind,
        maxLength: meta.maxLength,
        countMode: meta.countMode ?? "chars",
        mediaType: meta.mediaType,
        validator: unwrapOptional(schema),
      },
    ];
  });
}

/** Length the platform counts (code points, UTF-8 bytes, or X-weighted). */
export function measure(value: string, mode: AiField["countMode"]): number {
  if (mode === "bytes") return utf8Length(value);
  if (mode === "weighted") return xWeightedLength(value);
  return [...value].length;
}

export function limitText(field: AiField): string {
  if (!field.maxLength) return "";
  const unit = field.countMode === "bytes" ? "UTF-8 bytes" : field.countMode === "weighted" ? "X-weighted characters (URLs count 23)" : "characters";
  return field.kind === "tags" ? `at most ${field.maxLength} characters in total` : `at most ${field.maxLength} ${unit}`;
}

/**
 * Shortens to the last word boundary within the limit (falls back to a hard
 * cut for one very long word). Trailing punctuation/space is trimmed.
 */
export function shortenToLimit(value: string, limit: number, mode: AiField["countMode"]): string {
  if (measure(value, mode) <= limit) return value;
  const chars = [...value];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join(""), mode) <= limit) lo = mid;
    else hi = mid - 1;
  }
  const hard = chars.slice(0, lo).join("");
  const boundary = hard.search(/\s\S*$/);
  const cut = boundary > hard.length * 0.5 ? hard.slice(0, boundary) : hard;
  return cut.replace(/[\s,;:–—-]+$/u, "");
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const AiTargetSchema = z.object({
  socialConnectionId: z.uuid().describe("Account to write content for."),
  /** Omit for every AI field of the platform. */
  fields: z.array(z.string().min(1)).min(1).max(10).optional().describe("Compose fields to fill (see each platform's ai fields); omit for all of them."),
  instruction: z.string().trim().max(500).optional().describe("Instructions for this account only; combined with globalInstruction and wins on conflicts."),
  photoMediaIds: z.array(z.uuid()).min(1).max(20).optional().describe("Photo posts: this account's subset/order of photoMediaIds (same as targets[].mediaIds when publishing)."),
  context: z.object({
    taggedUsernames: z.array(z.string().trim().min(1).max(60)).max(40).optional().describe("People already tagged on this account's media (usernames without @)."),
    collaborators: z.array(z.string().trim().min(1).max(60)).max(10).optional().describe("Collaborators invited on this post."),
    watchNext: z.object({
      videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).describe("YouTube video ID."),
      title: z.string().trim().min(1).max(200).describe("Its title."),
    }).optional().describe("YouTube long-form only: the related video; a \"Watch next\" line is added above the hashtags and counted in the description band."),
  }).optional().describe("Context only. AI may mention a tagged person naturally once, but never invents tags or adds people you didn't choose."),
  hookOnly: z.boolean().optional().describe("Rewrite only the title (YouTube) or the first line of the main text; needs `current`."),
  current: z.record(z.string(), z.string().max(70_000)).optional().describe("hookOnly: the account's current compose text by field name, so the rest of the text is kept."),
});

/** Route input (no refinements: the OpenAPI generator can't omit fields from refined objects). */
export const GenerateInputBaseSchema = z.object({
  jsonMediaId: z.uuid().optional().describe("Social-package JSON media to write from (first priority: the author's draft). One of jsonMediaId, subtitleMediaId or photoMediaIds is required."),
  subtitleMediaId: z.uuid().optional().describe("Subtitle media (.srt/.vtt) to write from (second priority; the only source of chapter timestamps)."),
  photoMediaIds: z.array(z.uuid()).min(1).max(20).optional().describe("Photo posts: the photos in slide order. AI looks at the first 10 (downscaled) and writes image/carousel copy and alt texts."),
  videoMediaId: z.uuid().optional().describe("Video the content is for (adds its duration/orientation as context). May still be uploading or processing; then send videoMeta."),
  videoMeta: z.object({
    durationSeconds: z.number().nonnegative().nullable().describe("Video length in seconds as read locally."),
    width: z.number().int().positive().nullable().describe("Pixel width as read locally."),
    height: z.number().int().positive().nullable().describe("Pixel height as read locally."),
  }).optional().describe("Duration and size of a video that hasn't finished processing (read by the client); ignored once the video is ready."),
  targets: z.array(AiTargetSchema).min(1).max(20).describe("Accounts (and fields) to generate for."),
  globalInstruction: z.string().trim().max(500).optional().describe("Instructions applied to every target, e.g. a required title prefix; cannot override facts or platform limits."),
});

export const NO_SOURCE_MESSAGE = "Pick a social JSON, subtitles or photos to generate from";

export const GenerateInputSchema = GenerateInputBaseSchema.refine((v) => v.jsonMediaId || v.subtitleMediaId || v.photoMediaIds?.length, {
  message: NO_SOURCE_MESSAGE,
  path: ["jsonMediaId"],
});
export type GenerateInput = z.infer<typeof GenerateInputSchema>;

export const GenerationIssueSchema = z.object({
  socialConnectionId: z.uuid().describe("Account the issue is about."),
  field: z.string().describe("Compose field name."),
  message: z.string().describe("What went wrong for that field."),
});
export type GenerationIssue = z.infer<typeof GenerationIssueSchema>;

export const GenerationStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const GenerationViewSchema = z.object({
  id: z.uuid().describe("Generation ID."),
  status: GenerationStatusSchema.describe("Poll until succeeded or failed."),
  /** { [connectionId]: { [field]: value } } */
  output: z.record(z.string(), z.record(z.string(), z.unknown())).nullable().describe("socialConnectionId → field → generated value; review before publishing."),
  issues: z.array(GenerationIssueSchema).describe("Notes per field: shortened to fit, shorter than the target band, or could not be generated."),
  targets: z.record(z.string(), z.object({
    platform: z.string().describe("Platform key."),
    postType: z.enum(["video", "short", "image", "carousel"]).describe("Playbook used: video, short (Shorts/Reels), image or carousel."),
    source: z.enum(["json", "srt", "photos"]).describe("Main source the copy was written from."),
    promptVersion: z.string().describe("Version of the playbook prompt."),
  })).describe("socialConnectionId → how that account's copy was written."),
  error: z.object({
    code: z.string().describe("Error code."),
    message: z.string().describe("Error message."),
  }).nullable().describe("Set when status is failed."),
});

export const InstructionPresetViewSchema = z.object({
  id: z.uuid().describe("Preset ID."),
  name: z.string().describe("Preset name."),
  text: z.string().describe("Instruction text."),
  createdAt: z.date().describe("When the preset was created."),
});
export const InstructionPresetPageSchema = paginatedOutput(InstructionPresetViewSchema);
export const ListInstructionPresetsInputSchema = PaginationInputSchema;
export const CreateInstructionPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(100).describe("Short preset name."),
  text: z.string().trim().min(1).max(500).describe("Instruction text to reuse."),
});

export type GenerationView = z.infer<typeof GenerationViewSchema>;
