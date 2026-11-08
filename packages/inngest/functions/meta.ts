import { runDataDeletion, type MetaEffects } from "@repo/services/meta";
import { inngest } from "../client";
import { metaDataDeletionRequested, notificationCreate, postPublishCancelled } from "../events";
import { schedulingEffects } from "../scheduling";

/** Side effects for @repo/services/meta (scheduling, publish cancel, notifications). */
export const metaEffects: MetaEffects = {
  scheduling: schedulingEffects,
  async publishCancelled(postId) {
    await inngest.send(postPublishCancelled.create({ postId }, { id: `post-publish-cancel:${postId}:meta` }));
  },
  async notify({ dedupeId, ...data }) {
    await inngest.send(notificationCreate.create(data, { id: dedupeId }));
  },
};

/**
 * meta/data-deletion.requested → delete the Meta-sourced data for the matched
 * connections (tokens, profile, analytics, platform ids/responses on posts) and mark
 * the request completed / no_data. Idempotent: a completed request is skipped.
 */
export const metaDataDeletion = inngest.createFunction(
  { id: "meta-data-deletion", triggers: [metaDataDeletionRequested], retries: 3, concurrency: { limit: 1, key: "event.data.requestId" } },
  async ({ event, step }) => step.run("delete-meta-data", () => runDataDeletion(event.data.requestId, metaEffects)),
);
