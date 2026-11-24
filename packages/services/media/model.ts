import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";
import { FolderRoleSchema } from "../media-folders/roles";

export const MediaTypeSchema = z.enum(["video", "image", "subtitle", "json", "other"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const MediaStatusSchema = z.enum(["uploading", "uploaded", "processing", "ready", "failed"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const OrientationSchema = z.enum(["portrait", "landscape", "square"]);
export type Orientation = z.infer<typeof OrientationSchema>;

export const JsonSchemaKindSchema = z.enum(["social_package"]);

export const SubtitleSummarySchema = z.object({
  segments: z.number().int().nonnegative().describe("Number of subtitle cues."),
  durationMs: z.number().int().nonnegative().describe("End time of the last cue, in milliseconds."),
});
export type SubtitleSummary = z.infer<typeof SubtitleSummarySchema>;

/** Folder proposed from a social-package JSON; only created when the user confirms. */
export const FolderSuggestionSchema = z.object({
  folderName: z.string().min(1).max(200).describe("Suggested folder name."),
  items: z.array(z.object({
    mediaId: z.uuid().describe("Media ID that would be added to the folder."),
    role: FolderRoleSchema.describe("Role the media would take in the folder."),
  })).describe("Media the folder would contain, with their roles."),
});
export type FolderSuggestion = z.infer<typeof FolderSuggestionSchema>;

/** A format-converted copy of an original image (ensureFormat). The original is never changed. */
export const MediaDerivativeSchema = z.object({
  key: z.string().min(1).describe("Object key of the converted file (same bucket as the original)."),
  width: z.number().int().positive().describe("Pixel width; equals the original unless scaled."),
  height: z.number().int().positive().describe("Pixel height; equals the original unless scaled."),
  bytes: z.number().int().positive().describe("File size in bytes."),
  scaled: z.boolean().describe("True when it was scaled down proportionally to fit a byte limit."),
  sourceChecksum: z.string().min(1).describe("Checksum (ETag) of the original it was built from; a mismatch means rebuild."),
});
export type MediaDerivative = z.infer<typeof MediaDerivativeSchema>;

/** Shape of media.metadata (jsonb). Unknown keys are kept. */
export const MediaMetadataSchema = z.looseObject({
  /** Converted copies by target format (e.g. "jpeg"), built on demand for platforms that need them. */
  derivatives: z.record(z.string(), MediaDerivativeSchema).optional(),
  multipart: z.object({ uploadId: z.string().min(1), partSize: z.number().int().positive() }).optional(),
  error: z.string().optional(),
  codec: z.object({ video: z.string().optional(), audio: z.string().optional() }).optional(),
  fps: z.number().positive().optional(),
  orientation: OrientationSchema.optional(),
  jsonSchema: JsonSchemaKindSchema.nullable().optional(),
  subtitle: SubtitleSummarySchema.nullable().optional(),
  folderSuggestion: FolderSuggestionSchema.optional(),
  /** Quick upload fingerprint (size + lastModified + SHA-256 of the first 1 MB) used to reuse identical uploads. */
  fingerprint: z.string().optional(),
  /** Object key of the small JPEG thumbnail (images and videos). */
  thumbnailKey: z.string().optional(),
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
/** Hard storage cap: S3 allows 10,000 parts, so 10 MiB parts top out just under 100 GiB. The real per-upload limit is the largest platform limit (uploads.ts). */
export const MAX_UPLOAD_BYTES = MEDIA_PART_SIZE * 10_000;
/** Uploads a user may have in "uploading" at once (picked but not finished). */
export const MAX_CONCURRENT_UPLOADS = 30;
/** Part URLs returned by createUpload when presignLimit is omitted (the rest come from POST /media/{mediaId}/parts). */
export const MAX_PRESIGN_BATCH = 100;

/** Compose slot an upload is for; the server checks the file type against it. */
export const UploadSlotSchema = z.enum(["video", "photos", "thumbnail", "subtitles", "json"]);
export type UploadSlot = z.infer<typeof UploadSlotSchema>;
export const SLOT_TYPES: Record<UploadSlot, MediaType> = {
  video: "video",
  photos: "image",
  thumbnail: "image",
  subtitles: "subtitle",
  json: "json",
};

/** "<size>-<lastModified>-<sha256 hex of the first 1 MB>". */
export const FingerprintSchema = z.string().trim().regex(/^\d+-\d+-[0-9a-f]{64}$/, "Invalid fingerprint");
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
  filename: z.string().trim().min(1).max(255).describe("Original filename including extension (.mp4, .jpg, .srt, .vtt, .json …)."),
  mimeType: z.string().trim().max(255).describe("MIME type of the file (video/*, image/*, application/json); may be empty for .srt/.vtt."),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES).describe("Exact file size in bytes. Videos/images up to the largest platform video limit (see GET /platforms/capabilities, capped by storage); subtitles and JSON up to 1 MiB."),
  /** Display name; defaults to the filename without its extension. */
  name: MediaNameSchema.optional().describe("Display name (1–200 chars); defaults to the filename without its extension."),
  slot: UploadSlotSchema.optional().describe("Compose slot the file is for (video, photos, thumbnail, subtitles, json); the file type must match it."),
  fingerprint: FingerprintSchema.optional().describe("Quick fingerprint \"<size>-<lastModified ms>-<sha256 hex of the first 1 MB>\". When a ready media with the same fingerprint exists, it is returned with reused=true and nothing is uploaded."),
  presignLimit: z.number().int().min(0).max(MAX_PRESIGN_BATCH).optional().describe(`How many part URLs to presign now (default: all parts, at most ${MAX_PRESIGN_BATCH}). Get the rest with POST /media/{mediaId}/parts.`),
});
export type CreateUploadInput = z.infer<typeof CreateUploadInputSchema>;

export const CreateUploadResultSchema = z.object({
  mediaId: z.uuid().describe("ID of the new media item (status uploading), or of the existing ready media when reused."),
  reused: z.boolean().describe("True when an identical ready file (same fingerprint) was found: nothing to upload, parts is empty."),
  uploadId: z.string().nullable().describe("S3 multipart upload ID; null when reused."),
  partCount: z.number().int().nonnegative().describe("Total number of parts to upload (0 when reused)."),
  partSize: z.number().int().positive().describe("Bytes per part; part N covers bytes [(N-1)*partSize, N*partSize)."),
  parts: z.array(z.object({
    partNumber: z.number().int().positive().describe("1-based part number."),
    url: z.url().describe("Presigned URL; PUT this part's bytes here and keep the ETag response header."),
  })).describe("One presigned upload URL per part."),
});
export type CreateUploadResult = z.infer<typeof CreateUploadResultSchema>;

export const SignUploadPartsInputSchema = z.object({
  mediaId: z.uuid().describe("Media ID of an upload in progress."),
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(MAX_PRESIGN_BATCH).describe(`Parts to (re)sign, at most ${MAX_PRESIGN_BATCH} per call (expired URLs, the rest of a large file, or resuming after a reload).`),
});
export type SignUploadPartsInput = z.infer<typeof SignUploadPartsInputSchema>;

export const SignUploadPartsResultSchema = z.object({
  mediaId: z.uuid().describe("Media ID."),
  partSize: z.number().int().positive().describe("Bytes per part."),
  parts: z.array(z.object({
    partNumber: z.number().int().positive().describe("1-based part number."),
    url: z.url().describe("Presigned PUT URL for this part (valid 12 h)."),
  })).describe("Fresh presigned URLs for the requested parts."),
});
export type SignUploadPartsResult = z.infer<typeof SignUploadPartsResultSchema>;

export const CompleteUploadInputSchema = z.object({
  mediaId: z.uuid().describe("Media ID returned by POST /media/uploads."),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000).describe("1-based part number."),
        etag: z.string().trim().min(1).max(200).describe("ETag header returned by the part PUT."),
      }),
    )
    .min(1)
    .max(10_000)
    .describe("Every uploaded part with its ETag."),
});
export type CompleteUploadInput = z.infer<typeof CompleteUploadInputSchema>;

export const FailUploadInputSchema = z.object({
  mediaId: z.uuid().describe("Media ID of the upload that failed."),
  error: z.string().trim().min(1).max(500).describe("Short reason the upload failed."),
});
export type FailUploadInput = z.infer<typeof FailUploadInputSchema>;

// ---------------------------------------------------------------------------
// Library API
// ---------------------------------------------------------------------------

export const SearchQuerySchema = z.string().trim().min(1).max(100);

export const MediaListInputSchema = PaginationInputSchema.extend({
  q: SearchQuerySchema.optional().describe("Case-insensitive search on the media name."),
  type: MediaTypeSchema.optional().describe("Only media of this type."),
  orientation: OrientationSchema.optional().describe("Only media with this orientation (images and videos)."),
});
export type MediaListInput = z.input<typeof MediaListInputSchema>;

export const MediaViewSchema = z.object({
  id: z.uuid().describe("Media ID."),
  name: z.string().describe("Display name."),
  type: MediaTypeSchema.describe("Kind of media."),
  status: MediaStatusSchema.describe("Processing state; only ready media can be published."),
  originalFilename: z.string().nullable().describe("Filename at upload time."),
  mimeType: z.string().describe("Stored content type."),
  sizeBytes: z.number().nullable().describe("File size in bytes."),
  width: z.number().nullable().describe("Pixel width (images and videos)."),
  height: z.number().nullable().describe("Pixel height (images and videos)."),
  durationSeconds: z.number().nullable().describe("Duration in seconds (videos and subtitles)."),
  orientation: OrientationSchema.nullable().describe("Derived from width and height."),
  codec: z.object({
    video: z.string().optional().describe("Video codec name."),
    audio: z.string().optional().describe("Audio codec name."),
  }).nullable().describe("Detected codecs (videos)."),
  fps: z.number().nullable().describe("Frames per second (videos)."),
  jsonSchema: JsonSchemaKindSchema.nullable().describe("Recognised JSON format, for JSON media."),
  subtitle: SubtitleSummarySchema.nullable().describe("Cue summary, for subtitle media."),
  folderSuggestion: FolderSuggestionSchema.nullable().describe("Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion."),
  error: z.string().nullable().describe("Why processing failed, when status is failed."),
  /** Presigned GET URL; null until the upload has finished. */
  url: z.string().nullable().describe("Short-lived presigned download URL; null until the upload has finished."),
  thumbUrl: z.string().nullable().describe("Short-lived presigned URL of a small (≤ 320 px) JPEG thumbnail; null for non-visual media or when none was generated yet. Prefer it over url for lists and grids."),
  createdAt: z.date().describe("When the media was created."),
  updatedAt: z.date().describe("When the media last changed."),
});
export type MediaView = z.infer<typeof MediaViewSchema>;

export const MediaPageSchema = paginatedOutput(MediaViewSchema);
export type MediaPage = z.infer<typeof MediaPageSchema>;

export const MediaDetailSchema = MediaViewSchema.extend({
  folders: z.array(z.object({
    folderId: z.uuid().describe("Folder ID."),
    name: z.string().describe("Folder name."),
    role: FolderRoleSchema.describe("Role of this media in that folder."),
  })).describe("Folders that contain this media."),
  /** Posts that use this media (published ones are unaffected by a delete). */
  inUseByPosts: z.number().int().nonnegative().describe("Number of posts that use this media; published posts are unaffected by a delete."),
});
export type MediaDetail = z.infer<typeof MediaDetailSchema>;

export const RenameMediaInputSchema = z.object({
  mediaId: z.uuid().describe("Media ID."),
  name: MediaNameSchema.describe("New display name (1–200 chars)."),
});

export const DeleteMediaInputSchema = z.object({ mediaId: z.uuid().describe("Media ID.") });

export const BulkDeleteMediaInputSchema = z.object({
  mediaIds: z.array(z.uuid()).min(1).max(100).describe("Media IDs to delete in one background job."),
});

/** Delete is queued to Inngest; storage removal runs in the worker. */
export const DeleteMediaResultSchema = z.object({
  accepted: z.literal(true).describe("Delete job was accepted."),
  jobId: z.uuid().describe("Background job ID."),
  queued: z.number().int().nonnegative().describe("Items queued (0 when every ID was already gone)."),
});
export type DeleteMediaResult = z.infer<typeof DeleteMediaResultSchema>;
