import { nameBatchWithAi } from "@repo/services/ai-content/post-name";
import { requestDelete } from "@repo/services/post-actions";
import { postActionSummary } from "@repo/services/post-actions/run";
import { PLATFORMS } from "@repo/services/publishing/platforms";
import {
  batchProgress,
  claimPost,
  classifyPublishError,
  markPostFailed,
  PermanentPublishError,
  postSummary,
  queuedPostsInBatch,
  runPublishPhase,
  setPostStep,
} from "@repo/services/publishing/run";
import { completeSchedule, isScheduleCurrent } from "@repo/services/scheduling";
import { UPLOAD_CONFIG } from "@repo/services/publishing/upload/config";
import type { PrepareStep } from "@repo/services/publishing/upload/progress";
import type { GetStepTools } from "inngest";
import { z } from "zod";
import { inngest } from "../client";
import { notificationCreate, postDeleteRequested, postPublishRequested, postsBatchNameRequested, postsBatchRequested } from "../events";

type Step = GetStepTools<typeof inngest>;

const batchLink = (batchId: string | null) => (batchId ? `/posts/batch/${batchId}` : "/posts");

/** posts/batch.requested → one post/publish.requested per queued post. */
export const publishBatch = inngest.createFunction(
  { id: "publish-batch", triggers: [postsBatchRequested], retries: 3 },
  async ({ event, step }) => {
    const queued = await step.run("load-posts", () => queuedPostsInBatch(event.data.batchId));
    // Naming runs separately so it never delays publishing.
    await step.sendEvent(
      "request-name",
      postsBatchNameRequested.create({ batchId: event.data.batchId, userId: event.data.userId }, { id: `posts-batch-name:${event.data.batchId}` }),
    );
    if (queued.length === 0) return { sent: 0 };
    await step.sendEvent(
      "fan-out",
      queued.map((post) =>
        postPublishRequested.create(
          {
            postId: post.id,
            userId: post.userId,
            socialConnectionId: post.socialConnectionId,
            batchId: event.data.batchId,
            attempt: 0,
          },
          { id: `post-publish:${post.id}:0` },
        ),
      ),
    );
    return { sent: queued.length };
  },
);

/** Per-post notification, then — if that was the batch's last post — one summary. */
async function afterFinish(step: Step, postId: string, attempt: number) {
  const summary = await step.run("load-result", () => postSummary(postId));
  if (!summary) return;
  const platform = summary.platform as keyof typeof PLATFORMS | null;
  const label = platform ? PLATFORMS[platform].label : "Your account";
  const ok = summary.status === "published";
  await step.sendEvent(
    "notify-post",
    notificationCreate.create(
      {
        userId: summary.userId,
        type: ok ? "post_published" : "post_failed",
        title: ok ? `Posted to ${label}` : `Couldn't post to ${label}`,
        body: ok ? "Your post is live." : (summary.errorMessage ?? "Publishing failed."),
        link: batchLink(summary.batchId),
        postId,
      },
      { id: `post-result:${postId}:${attempt}` },
    ),
  );

  if (!summary.batchId) return;
  const batch = await step.run("batch-progress", () => batchProgress(summary.batchId!));
  if (!batch.finished || !batch.userId) return;
  // Same counts → same id, so concurrent finishers send one summary.
  await step.sendEvent(
    "notify-batch",
    notificationCreate.create(
      {
        userId: batch.userId,
        type: batch.published === batch.total ? "post_published" : "post_failed",
        title: `Posted to ${batch.published} of ${batch.total} account${batch.total === 1 ? "" : "s"}`,
        body:
          batch.published === batch.total
            ? "Every post is live."
            : `${batch.total - batch.published} post${batch.total - batch.published === 1 ? "" : "s"} failed. Open the batch to retry.`,
        link: batchLink(summary.batchId),
        data: { batchId: summary.batchId, published: batch.published, total: batch.total },
      },
      { id: `batch-summary:${summary.batchId}:${batch.published}:${batch.total}:${attempt}` },
    ),
  );
}

/**
 * post/publish.requested → publish with the platform's existing provider.
 * One at a time per account; transient errors retry (resuming from
 * posts.config.progress), validation/auth errors fail at once.
 *
 * Steps: claim → prepare (uploads) → [scheduled: sleepUntil(publishAt) →
 * re-check the schedule in the DB] → finalize (make it live) → notify.
 * Instant posts run prepare + finalize back to back.
 */
export const publishPost = inngest.createFunction(
  {
    id: "publish-post",
    triggers: [postPublishRequested],
    // One run per account at a time, and never two runs uploading the same post.
    concurrency: [
      { limit: 1, key: "event.data.socialConnectionId" },
      { limit: 1, key: "event.data.postId" },
    ],
    retries: 3,
    // posts.delete on a queued/publishing post, or a reschedule / cancel / publish-now, stops this run.
    cancelOn: [
      { event: "post/publish.cancelled", match: "data.postId" },
      { event: "post/schedule.changed", match: "data.postId" },
    ],
    onFailure: async ({ event, error, step }) => {
      const original = z
        .object({ postId: z.uuid(), attempt: z.number().int() })
        .safeParse(event.data.event.data);
      if (!original.success) return;
      const { code, message } = classifyPublishError(error);
      await step.run("mark-failed", () => markPostFailed(original.data.postId, code, message));
      await afterFinish(step, original.data.postId, original.data.attempt);
    },
  },
  async ({ event, step }) => {
    const { postId, attempt, scheduleVersion, publishAt } = event.data;
    const scheduled = scheduleVersion != null;
    // Also the idempotency guard: a post that already has external_post_id is never claimed.
    const claimed = await step.run("claim", () => claimPost(postId, scheduleVersion ?? null));
    if (!claimed) return { skipped: true };

    const run = <T>(id: string, fn: () => Promise<T>) =>
      step.run(id, async () => {
        try {
          return { ok: true as const, value: await fn() };
        } catch (error) {
          // Already marked failed (validation/auth): stop without retrying.
          if (error instanceof PermanentPublishError) return { ok: false as const, code: error.code, message: error.message };
          throw error;
        }
      });

    /**
     * prepare as a chain of steps: each call does one unit (a group of chunks
     * for ≤ ~60 s, or one processing poll), saves progress, and names the next
     * step (e.g. "youtube-chunk-12"). Completed steps are memoized, so a retry
     * re-runs only the unit that failed — never the whole upload. Waits are
     * step.sleep between steps, never inside one.
     */
    const prepareAll = async (prefix: string) => {
      let id = prefix;
      for (let i = 0; i < UPLOAD_CONFIG.MAX_PREPARE_STEPS; i++) {
        const result = await run(id, () => runPublishPhase(postId, "prepare", { scheduled }));
        if (!result.ok) return result;
        // `null` = memoized result of a run that started before chunked prepare existed.
        const next = result.value as PrepareStep | null;
        if (!next || next.done) return result;
        if (next.waitSeconds) await step.sleep(`${prefix}:${next.next}:wait`, `${Math.ceil(next.waitSeconds)}s`);
        id = `${prefix}:${next.next}`;
      }
      throw new Error("Upload needed too many steps");
    };

    const prepared = await prepareAll("prepare");
    if (!prepared.ok) {
      await afterFinish(step, postId, attempt);
      return { status: "failed" as const, code: prepared.code, message: prepared.message };
    }

    if (scheduled) {
      if (publishAt && new Date(publishAt).getTime() > Date.now()) {
        await step.run("waiting", () => setPostStep(postId, "Ready — publishes at the scheduled time"));
        await step.sleepUntil("wait-until-scheduled", publishAt);
      }
      // Rescheduled / cancelled while we slept → a newer version owns the post.
      const current = await step.run("recheck-schedule", () => isScheduleCurrent(postId, scheduleVersion));
      if (!current) return { skipped: true, reason: "schedule_changed" };
      // After a long wait some uploads must be refreshed (X media ids expire ~24 h); a no-op otherwise.
      const refreshed = await prepareAll("reprepare");
      if (!refreshed.ok) {
        await afterFinish(step, postId, attempt);
        return { status: "failed" as const, code: refreshed.code, message: refreshed.message };
      }
    }

    const result = await run("finalize", () => runPublishPhase(postId, "finalize", { scheduled }));
    if (result.ok && scheduled) await step.run("complete-schedule", () => completeSchedule(postId, scheduleVersion));

    // A permanent failure was recorded (no retry); onFailure only handles exhausted retries.
    await afterFinish(step, postId, attempt);

    // Repost with "delete original after reposting": only once the new post is live.
    if (result.ok) {
      const original = await step.run("delete-original", async () => {
        const summary = await postActionSummary(postId);
        if (!summary.deleteOriginalAfterPublish) return null;
        const { event: next } = await requestDelete(summary.userId, summary.deleteOriginalAfterPublish);
        return next ?? null;
      });
      if (original?.name === "post/delete.requested") {
        await step.sendEvent("request-delete-original", postDeleteRequested.create(original.data, { id: `post-delete:${original.data.postId}:repost` }));
      }
      return { status: "published" as const, ...result.value };
    }
    return { status: "failed" as const, code: result.code, message: result.message };
  },
);

/**
 * posts/batch.name.requested → AI names the batch (≤100 chars) from the
 * social JSON or the post titles, and saves it on every post. If AI is
 * unavailable the instant fallback name stays (never fails publishing).
 */
export const namePostBatch = inngest.createFunction(
  {
    id: "name-post-batch",
    triggers: [postsBatchNameRequested],
    throttle: { limit: 10, period: "1m", key: "event.data.userId" },
    retries: 2,
  },
  async ({ event, step }) => step.run("name", () => nameBatchWithAi(event.data.batchId)),
);
