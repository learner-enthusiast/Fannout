import { z } from "zod";
import { FolderRoleSchema } from "../media-folders/roles";

export const MediaTypeSchema = z.enum(["video", "image", "subtitle", "json", "other"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const MediaStatusSchema = z.enum(["uploading", "uploaded", "processing", "ready", "failed"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const OrientationSchema = z.enum(["portrait", "landscape", "square"]);
export type Orientation = z.infer<typeof OrientationSchema>;

export const JsonSchemaKindSchema = z.enum(["social_package"]);

export const SubtitleSummarySchema = z.object({
  segments: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type SubtitleSummary = z.infer<typeof SubtitleSummarySchema>;

/** Folder proposed from a social-package JSON; only created when the user confirms. */
export const FolderSuggestionSchema = z.object({
  folderName: z.string().min(1).max(200),
  items: z.array(z.object({ mediaId: z.uuid(), role: FolderRoleSchema })),
});
export type FolderSuggestion = z.infer<typeof FolderSuggestionSchema>;

/** Shape of media.metadata (jsonb). Unknown keys are kept. */
export const MediaMetadataSchema = z.looseObject({
  multipart: z.object({ uploadId: z.string().min(1), partSize: z.number().int().positive() }).optional(),
  error: z.string().optional(),
  codec: z.object({ video: z.string().optional(), audio: z.string().optional() }).optional(),
  fps: z.number().positive().optional(),
  orientation: OrientationSchema.optional(),
  jsonSchema: JsonSchemaKindSchema.nullable().optional(),
  subtitle: SubtitleSummarySchema.nullable().optional(),
  folderSuggestion: FolderSuggestionSchema.optional(),
  /** social_package JSON: the parts needed to recompute the suggestion later. */
  socialPackage: z
    .object({ video: z.string(), files: z.record(z.string(), z.union([z.string(), z.array(z.string())])) })
    .optional(),
});
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;

export const MediaRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  type: MediaTypeSchema,
  status: MediaStatusSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  s3Bucket: z.string().min(1),
  s3Key: z.string().min(1),
  s3Region: z.string().min(1),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  metadata: MediaMetadataSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MediaRow = z.infer<typeof MediaRowSchema>;

export const MediaNameSchema = z.string().trim().min(1).max(200);

export const CreateMediaInputSchema = z.object({
  userId: z.uuid(),
  name: MediaNameSchema,
  type: MediaTypeSchema,
  status: MediaStatusSchema.optional(),
  originalFilename: z.string().nullable().optional(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  s3Bucket: z.string().min(1),
  s3Key: z.string().min(1),
  s3Region: z.string().min(1),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  metadata: MediaMetadataSchema.nullable().optional(),
});

export type CreateMediaInput = z.input<typeof CreateMediaInputSchema>;

export const UpdateMediaInputSchema = CreateMediaInputSchema.omit({
  userId: true,
  s3Bucket: true,
  s3Key: true,
  s3Region: true,
}).partial();

export type UpdateMediaInput = z.input<typeof UpdateMediaInputSchema>;

export const ListMediaInputSchema = z.object({
  type: MediaTypeSchema.optional(),
  status: MediaStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ListMediaInput = z.input<typeof ListMediaInputSchema>;

// ---------------------------------------------------------------------------
// Uploads (S3 multipart, browser → presigned part URLs)
// ---------------------------------------------------------------------------

export const MEDIA_PART_SIZE = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
/** Subtitles and JSON are parsed in memory, so they stay small. */
export const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024;

const extension = (filename: string) => filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

/**
 * Upload type from mime + filename: video/*, image/*, .srt/.vtt → subtitle,
 * application/json (or .json) → json. Anything else is rejected (null).
 * Returns the content type to store (browsers often send "" for .srt).
 */
export function mediaTypeFromFile(
  mimeType: string,
  filename: string,
): { type: MediaType; contentType: string } | null {
  const ext = extension(filename);
  if (ext === "srt") return { type: "subtitle", contentType: "application/x-subrip" };
  if (ext === "vtt") return { type: "subtitle", contentType: "text/vtt" };
  if (/^application\/json$/i.test(mimeType) || ext === "json") {
    return { type: "json", contentType: "application/json" };
  }
  if (/^image\/[\w.+-]+$/i.test(mimeType)) return { type: "image", contentType: mimeType };
  if (/^video\/[\w.+-]+$/i.test(mimeType)) return { type: "video", contentType: mimeType };
  return null;
}

export function maxBytesFor(type: MediaType): number {
  return type === "subtitle" || type === "json" ? MAX_TEXT_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}

/** "My Clip.final.mp4" → "My Clip.final". */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").trim();
  return (base || "Untitled").slice(0, 200);
}

export function orientationOf(width: number | null, height: number | null): Orientation | null {
  if (!width || !height) return null;
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

export const CreateUploadInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  /** Display name; defaults to the filename without its extension. */
  name: MediaNameSchema.optional(),
});
export type CreateUploadInput = z.infer<typeof CreateUploadInputSchema>;

export const CreateUploadResultSchema = z.object({
  mediaId: z.uuid(),
  partSize: z.number().int().positive(),
  parts: z.array(z.object({ partNumber: z.number().int().positive(), url: z.url() })),
});
export type CreateUploadResult = z.infer<typeof CreateUploadResultSchema>;

export const CompleteUploadInputSchema = z.object({
  mediaId: z.uuid(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(10_000),
});
export type CompleteUploadInput = z.infer<typeof CompleteUploadInputSchema>;

export const FailUploadInputSchema = z.object({
  mediaId: z.uuid(),
  error: z.string().trim().min(1).max(500),
});
export type FailUploadInput = z.infer<typeof FailUploadInputSchema>;

// ---------------------------------------------------------------------------
// Library API
// ---------------------------------------------------------------------------

export const SearchQuerySchema = z.string().trim().min(1).max(100);

export const MediaListInputSchema = z.object({
  q: SearchQuerySchema.optional(),
  type: MediaTypeSchema.optional(),
  orientation: OrientationSchema.optional(),
  cursor: z.string().min(1).max(200).nullish(),
  limit: z.number().int().min(1).max(50).default(24),
});
export type MediaListInput = z.input<typeof MediaListInputSchema>;

export const MediaViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: MediaTypeSchema,
  status: MediaStatusSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  orientation: OrientationSchema.nullable(),
  codec: z.object({ video: z.string().optional(), audio: z.string().optional() }).nullable(),
  fps: z.number().nullable(),
  jsonSchema: JsonSchemaKindSchema.nullable(),
  subtitle: SubtitleSummarySchema.nullable(),
  folderSuggestion: FolderSuggestionSchema.nullable(),
  error: z.string().nullable(),
  /** Presigned GET URL; null until the upload has finished. */
  url: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MediaView = z.infer<typeof MediaViewSchema>;

export const MediaPageSchema = z.object({
  items: z.array(MediaViewSchema),
  nextCursor: z.string().nullable(),
});
export type MediaPage = z.infer<typeof MediaPageSchema>;

export const MediaDetailSchema = MediaViewSchema.extend({
  folders: z.array(z.object({ folderId: z.uuid(), name: z.string(), role: FolderRoleSchema })),
});
export type MediaDetail = z.infer<typeof MediaDetailSchema>;

export const RenameMediaInputSchema = z.object({ mediaId: z.uuid(), name: MediaNameSchema });

export const DeleteMediaInputSchema = z.object({ mediaId: z.uuid(), force: z.boolean().optional() });
export const DeleteMediaResultSchema = z.object({
  deleted: z.boolean(),
  /** Folders that still use the media (only when not forced). */
  inUse: z.array(z.string()),
});
export type DeleteMediaResult = z.infer<typeof DeleteMediaResultSchema>;
