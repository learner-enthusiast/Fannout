/**
 * Queue registry: queue name → job payload. Add a queue here and every helper
 * in this package becomes typed for it.
 */
export type QueuePayloads = {
  /**
   * Scheduled posts (apps/worker). `handoff` jobs (id `sched:{postId}:v{version}`)
   * fire at start_at and hand the post to Inngest after re-validating the DB
   * row; `sweep` is the repeatable recovery job.
   */
  "scheduled-posts": { kind: "handoff"; postId: string; scheduleVersion: number } | { kind: "sweep" };
};

export type QueueName = keyof QueuePayloads;

export const QUEUE_NAMES = {
  scheduledPosts: "scheduled-posts",
} as const satisfies Record<string, QueueName>;
