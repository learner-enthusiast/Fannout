import { z } from "zod";
import { PostAccountSchema } from "../publishing/model";

export const DeletedBySchema = z.enum(["app", "external"]);
export const ExternalStatusSchema = z.enum(["live", "hidden", "deleted_externally", "removed_by_platform", "unknown"]);
export const EditStatusSchema = z.enum(["editing", "failed"]);

export const RevisionSchema = z.object({
  at: z.string().describe("ISO-8601 time of the edit."),
  before: z.record(z.string(), z.unknown()).describe("Changed fields before the edit."),
  after: z.record(z.string(), z.unknown()).describe("Changed fields after the edit."),
  by: z.string().describe("Who made the edit (app or api)."),
});
export type Revision = z.infer<typeof RevisionSchema>;
export const MAX_REVISIONS = 10;

export const PostIdInputSchema = z.object({ postId: z.uuid().describe("Post ID.") });

export const DeleteResultSchema = z.object({
  postId: z.uuid().describe("Post ID."),
  /** queued = platform delete running; cancelled = never reached the platform; manual = do it in the app; noop = already done. */
  mode: z.enum(["queued", "cancelled", "manual", "noop"]).describe("queued = platform delete running; cancelled = never reached the platform; manual = the human must delete it in the platform's app; noop = already done."),
  status: z.string().describe("Post status after the request."),
  deleteNote: z.string().optional().describe("Platform note, set for manual deletes."),
  postUrl: z.string().nullable().optional().describe("Post URL, so a human can delete it manually."),
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

export const DeleteBatchInputSchema = z.object({
  batchId: z.uuid().describe("Batch ID."),
  socialConnectionIds: z.array(z.uuid()).min(1).max(50).optional().describe("Only delete posts for these accounts; default all."),
});
export const DeleteBatchResultSchema = z.object({
  results: z.array(
    z.union([
      DeleteResultSchema,
      z.object({
        postId: z.uuid().describe("Post ID."),
        mode: z.literal("error").describe("This post could not be deleted."),
        code: z.string().describe("Error code."),
        message: z.string().describe("Error message."),
      }),
    ]),
  ).describe("One result per post, in the same shape as DELETE /posts/{postId}, or an error."),
});

export const UpdatePostInputSchema = z.object({
  postId: z.uuid().describe("Post ID."),
  /** Compose field values to change ("thumbnail" = image media id for YouTube). */
  changes: z.record(z.string(), z.unknown()).describe("Compose fields to change; only the platform's editableFields are accepted (thumbnail = image media ID for YouTube)."),
});
export const UpdateResultSchema = z.object({
  postId: z.uuid().describe("Post ID."),
  mode: z.enum(["queued", "noop"]).describe("queued = edit job started; noop = nothing changed."),
  editStatus: z.string().nullable().describe("editing while the edit runs."),
});

export const RepostInputSchema = z.object({
  postId: z.uuid().describe("Post to publish again as a new post."),
  changes: z.record(z.string(), z.unknown()).optional().describe("Compose fields to change in the new post."),
  /** Delete the original once the new post is published (never automatic otherwise). */
  deleteOriginal: z.boolean().optional().describe("Delete the original once the new post is published (never automatic otherwise)."),
});

export type FieldIssue = { field: string; message: string };

export const PostDetailSchema = z.object({
  id: z.uuid().describe("Post ID."),
  name: z.string().describe("Post display name."),
  batchId: z.uuid().nullable().describe("Batch the post belongs to."),
  socialConnectionId: z.uuid().describe("Account the post goes to."),
  platform: z.string().describe("Platform of the post."),
  status: z.string().describe("Post state; published, failed, cancelled and deleted are terminal."),
  externalStatus: z.string().describe("State on the platform: live, hidden, deleted_externally, removed_by_platform or unknown."),
  editStatus: z.string().nullable().describe("editing while an edit is running, failed when the last edit failed, else null."),
  postUrl: z.string().nullable().describe("Public URL of the published post."),
  caption: z.string().nullable().describe("Caption/text of the post."),
  input: z.record(z.string(), z.unknown()).describe("The compose fields the post was published with."),
  errorMessage: z.string().nullable().describe("Why the publish failed."),
  deleteErrorCode: z.string().nullable().describe("Error code when the last delete failed."),
  deleteErrorMessage: z.string().nullable().describe("Why the last delete failed."),
  editErrorCode: z.string().nullable().describe("Error code when the last edit failed."),
  editErrorMessage: z.string().nullable().describe("Why the last edit failed."),
  publishedAt: z.date().nullable().describe("When the platform accepted the post."),
  lastEditedAt: z.date().nullable().describe("When the last edit succeeded."),
  deletedAt: z.date().nullable().describe("When the post was deleted."),
  revisions: z.array(RevisionSchema).describe("Last 10 edits, newest last."),
  account: PostAccountSchema,
  capabilities: z.object({
    supportsDelete: z.boolean().describe("Whether Fannout can delete this post on the platform."),
    deleteNote: z.string().describe("Platform note about deletes."),
    supportsEdit: z.boolean().describe("Whether this post can be edited after publishing."),
    editableFields: z.array(z.string()).describe("Compose fields PATCH /posts/{postId} accepts."),
    editNote: z.string().describe("Platform note about edits."),
  }).describe("What can be done to this post on its platform."),
});
