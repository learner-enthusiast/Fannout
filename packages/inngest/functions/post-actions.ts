import {
  markDeleteFailed,
  markEditFailed,
  PermanentActionError,
  postActionSummary,
  runDeletePost,
  runEditPost,
} from "@repo/services/post-actions/run";
import { classifyPublishError } from "@repo/services/publishing/run";
import { z } from "zod";
import { inngest } from "../client";
import { notificationCreate, postDeleteRequested, postEditRequested } from "../events";

const link = (batchId: string | null) => (batchId ? `/posts/batch/${batchId}` : "/posts");
const Original = z.object({ postId: z.uuid() });

/**
 * post/delete.requested → delete on the platform (one at a time per account).
 * 404 = deleted; auth/permission → restored + reconnect, no retry; transient → retry.
 */
export const deletePost = inngest.createFunction(
  {
    id: "delete-post",
    triggers: [postDeleteRequested],
    concurrency: { limit: 1, key: "event.data.socialConnectionId" },
    retries: 4,
    onFailure: async ({ event, error, step }) => {
      const parsed = Original.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { code, message } = classifyPublishError(error);
      await step.run("mark-failed", () => markDeleteFailed(parsed.data.postId, code, message));
      const s = await step.run("summary", () => postActionSummary(parsed.data.postId));
      await step.sendEvent(
        "notify-failed",
        notificationCreate.create(
          { userId: s.userId, type: "post_delete_failed", title: `Couldn't delete from ${s.label}`, body: s.deleteErrorMessage ?? message, link: link(s.batchId), postId: parsed.data.postId },
          { id: `post-delete-failed:${parsed.data.postId}:${event.data.run_id ?? "final"}` },
        ),
      );
    },
  },
  async ({ event, step }) => {
    const { postId } = event.data;
    const result = await step.run("delete", async () => {
      try {
        return await runDeletePost(postId);
      } catch (error) {
        if (error instanceof PermanentActionError) return { outcome: "failed" as const, code: error.code, message: error.message };
        throw error;
      }
    });
    if (result.outcome === "skipped") return result;
    const s = await step.run("summary", () => postActionSummary(postId));
    await step.sendEvent(
      "notify",
      notificationCreate.create(
        result.outcome === "deleted"
          ? { userId: s.userId, type: "post_deleted", title: `Deleted from ${s.label}`, body: s.name, link: link(s.batchId), postId }
          : { userId: s.userId, type: "post_delete_failed", title: `Couldn't delete from ${s.label}`, body: s.deleteErrorMessage ?? "Delete failed", link: link(s.batchId), postId },
        { id: `post-delete-result:${postId}:${event.id ?? "x"}` },
      ),
    );
    return result;
  },
);

/** post/edit.requested → update on the platform; on any failure the DB keeps the live values. */
export const editPost = inngest.createFunction(
  {
    id: "edit-post",
    triggers: [postEditRequested],
    concurrency: { limit: 1, key: "event.data.socialConnectionId" },
    retries: 3,
    onFailure: async ({ event, error, step }) => {
      const parsed = Original.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { code, message } = classifyPublishError(error);
      await step.run("mark-failed", () => markEditFailed(parsed.data.postId, code, message));
      const s = await step.run("summary", () => postActionSummary(parsed.data.postId));
      await step.sendEvent(
        "notify-failed",
        notificationCreate.create(
          { userId: s.userId, type: "post_edit_failed", title: `Couldn't edit on ${s.label}`, body: message, link: link(s.batchId), postId: parsed.data.postId },
          { id: `post-edit-failed:${parsed.data.postId}:${event.data.run_id ?? "final"}` },
        ),
      );
    },
  },
  async ({ event, step }) => {
    const { postId } = event.data;
    const result = await step.run("edit", async () => {
      try {
        return await runEditPost(postId);
      } catch (error) {
        if (error instanceof PermanentActionError) return { outcome: "failed" as const, code: error.code, message: error.message };
        throw error;
      }
    });
    if (result.outcome === "skipped") return result;
    const s = await step.run("summary", () => postActionSummary(postId));
    await step.sendEvent(
      "notify",
      notificationCreate.create(
        result.outcome === "edited"
          ? { userId: s.userId, type: "post_edited", title: `Edited on ${s.label}`, body: s.name, link: link(s.batchId), postId }
          : { userId: s.userId, type: "post_edit_failed", title: `Couldn't edit on ${s.label}`, body: s.editErrorMessage ?? "Edit failed", link: link(s.batchId), postId },
        { id: `post-edit-result:${postId}:${event.id ?? "x"}` },
      ),
    );
    return result;
  },
);
