/**
 * Queue registry: queue name → job payload. Add a queue here and every helper
 * in this package becomes typed for it.
 */
export type QueuePayloads = {
  /** Publishes a scheduled post at its time (see scheduled_posts.schedule_version). */
  "scheduled-posts": { scheduledPostId: string; scheduleVersion: number };
};

export type QueueName = keyof QueuePayloads;

export const QUEUE_NAMES = {
  scheduledPosts: "scheduled-posts",
} as const satisfies Record<string, QueueName>;

/**
 * Deterministic job id for a scheduled post version. Rescheduling bumps the
 * version, so a stale job can't collide with (or be mistaken for) the new one.
 */
export function scheduledPostJobId(scheduledPostId: string, scheduleVersion: number): string {
  return `scheduled-post-${scheduledPostId}-v${scheduleVersion}`;
}
