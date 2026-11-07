import { z } from "zod";
import { PaginationInputSchema, paginatedOutput } from "../common/pagination";
import { PostScheduleViewSchema, ScheduleInputSchema } from "../scheduling/model";
import { PlatformSchema } from "./platforms";

export const ComposeMediaTypeSchema = z.enum(["video", "photos"]);
export type ComposeMediaType = z.infer<typeof ComposeMediaTypeSchema>;

export const PublishTargetSchema = z.object({
  socialConnectionId: z.uuid().describe("Connected account to publish to (from GET /social-connections)."),
  /** The platform's compose input (validated with that platform's schema). */
  input: z.record(z.string(), z.unknown()).describe("The platform's compose fields — see the Platform reference for this account's platform."),
  /** Photos mode: this account's subset/order of the batch photos. */
  mediaIds: z.array(z.uuid()).min(1).max(20).optional().describe("Photos mode only: this account's subset/order of the batch photos."),
  schedule: ScheduleInputSchema.optional().describe(
    "Publish this account at this time. Wins over scheduleAll; omit both to publish immediately.",
  ),
});
export type PublishTarget = z.infer<typeof PublishTargetSchema>;

export const PublishBatchInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(100).describe("Unique key (use a UUID) per intended publish; resending the same key returns the original batch."),
  mediaType: ComposeMediaTypeSchema.describe("video = one video; photos = one or more images (carousel)."),
  /** Ordered: the video (one) or the carousel photos. */
  mediaIds: z.array(z.uuid()).min(1).max(20).describe("Ready media IDs in order: exactly one video, or the photos."),
  /** Video mode: thumbnail image per connection. */
  thumbnailByConnection: z.record(z.uuid(), z.uuid()).optional().describe("Video mode: socialConnectionId → image media ID used as that account's thumbnail."),
  /** Social JSON the composer used; AI names the batch from it. */
  jsonMediaId: z.uuid().optional().describe("Social-package JSON media the content came from; used to name the batch."),
  scheduleAll: ScheduleInputSchema.optional().describe(
    "Fallback time for targets without their own schedule. Mixed batches are fine: targets with neither publish now.",
  ),
  targets: z
    .array(PublishTargetSchema)
    .min(1)
    .max(20)
    .refine((targets) => new Set(targets.map((t) => t.socialConnectionId)).size === targets.length, {
      message: "Each account can only be selected once",
    })
    .describe("One entry per account (each account at most once)."),
});
export type PublishBatchInput = z.infer<typeof PublishBatchInputSchema>;

export const ValidationIssueSchema = z.object({
  /** Missing for batch-level issues. */
  socialConnectionId: z.uuid().optional().describe("Account the issue is about; missing for batch-level issues."),
  /** Compose field name, or "media" / "thumbnail" / "account". */
  field: z.string().describe("Compose field name, or media / thumbnail / account."),
  message: z.string().describe("Human-readable problem to fix."),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean().describe("True when the batch can be published as is."),
  issues: z.array(ValidationIssueSchema).describe("Every problem found; empty when valid."),
});

export const PublishBatchResultSchema = z.object({
  batchId: z.uuid().describe("Batch ID; poll GET /posts/batches/{batchId}."),
  posts: z.array(z.object({
    id: z.uuid().describe("Post ID."),
    platform: PlatformSchema.describe("Platform of the post."),
    socialConnectionId: z.uuid().describe("Account the post goes to."),
    scheduledAt: z.date().nullable().describe("UTC publish time for scheduled posts; null = publishing now."),
  })).describe("One post per target (queued now, or scheduled)."),
  /** True when the idempotency key matched an earlier submit. */
  replayed: z.boolean().describe("True when the idempotency key matched an earlier submit (nothing new was queued)."),
});
export type PublishBatchResult = z.infer<typeof PublishBatchResultSchema>;

/** What publish-post stores in posts.config. */
export const PostConfigSchema = z.looseObject({
  platform: PlatformSchema,
  mediaType: ComposeMediaTypeSchema,
  input: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative().default(0),
  /** Resume data written as each step finishes, so retries never re-upload. */
  progress: z.record(z.string(), z.unknown()).default({}),
});
export type PostConfig = z.infer<typeof PostConfigSchema>;

export const PostAccountSchema = z.object({
  username: z.string().nullable().describe("Account handle."),
  displayName: z.string().nullable().describe("Account display name."),
  profilePictureUrl: z.string().nullable().describe("Account avatar URL."),
}).describe("The connected account the post goes to.");

export const BatchPostViewSchema = z.object({
  id: z.uuid().describe("Post ID."),
  platform: PlatformSchema.describe("Platform of the post."),
  socialConnectionId: z.uuid().describe("Account the post goes to."),
  account: PostAccountSchema,
  status: z.enum(["draft", "scheduled", "queued", "publishing", "published", "failed", "cancelled", "deleting", "deleted"]).describe("Post state; published, failed, cancelled and deleted are terminal."),
  step: z.string().nullable().describe("Current publish step while publishing (e.g. uploading)."),
  postUrl: z.string().nullable().describe("Public URL of the published post."),
  errorCode: z.string().nullable().describe("Error code when the publish failed."),
  errorMessage: z.string().nullable().describe("Error message when the publish failed."),
  publishedAt: z.date().nullable().describe("When the platform accepted the post."),
  updatedAt: z.date().describe("When the post last changed."),
  externalStatus: z.string().describe("State on the platform: live, hidden, deleted_externally, removed_by_platform or unknown."),
  editStatus: z.string().nullable().describe("editing while an edit is running, failed when the last edit failed, else null."),
  editErrorMessage: z.string().nullable().describe("Why the last edit failed."),
  lastEditedAt: z.date().nullable().describe("When the last edit succeeded."),
  deleteErrorCode: z.string().nullable().describe("Error code when the last delete failed."),
  deleteErrorMessage: z.string().nullable().describe("Why the last delete failed."),
  deletedAt: z.date().nullable().describe("When the post was deleted."),
  schedule: PostScheduleViewSchema.nullable().describe("Schedule for scheduled posts; null when the post was published immediately."),
});

export const BatchViewSchema = z.object({
  batchId: z.uuid().describe("Batch ID."),
  name: z.string().describe("Batch display name."),
  mediaType: ComposeMediaTypeSchema.describe("video or photos."),
  createdAt: z.date().describe("When the batch was submitted."),
  finished: z.boolean().describe("True when every post has a terminal status."),
  counts: z.object({
    total: z.number().describe("Posts in the batch."),
    published: z.number().describe("Posts published."),
    failed: z.number().describe("Posts failed."),
    pending: z.number().describe("Posts not finished yet."),
  }).describe("Post counts by outcome."),
  caption: z.string().nullable().describe("Caption of the first post, for display."),
  posts: z.array(BatchPostViewSchema).describe("Every post in the batch."),
});
export type BatchView = z.infer<typeof BatchViewSchema>;

export const ListBatchesInputSchema = PaginationInputSchema.extend({
  filter: z
    .enum(["all", "scheduled"])
    .default("all")
    .describe("scheduled = only batches with a post still waiting for its scheduled time"),
});
export const BatchPageSchema = paginatedOutput(BatchViewSchema);

export const TERMINAL_STATUSES = ["published", "failed", "cancelled", "deleted"] as const;
