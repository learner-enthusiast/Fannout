import { cancelScheduledJob, getQueue, scheduleJob } from "@repo/bullmq";
import { scheduleJobId, type SchedulingEffects } from "@repo/services/scheduling";
import { inngest } from "./client";
import { notificationCreate, postPublishRequested, postScheduleChanged } from "./events";

const QUEUE = "scheduled-posts" as const;
/** Retries are for the cheap hand-off only (publishing retries live in Inngest). */
const HANDOFF_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 3 * 24 * 60 * 60, count: 1_000 },
};

/**
 * BullMQ + Inngest side effects for @repo/services/scheduling. Used by the
 * tRPC router (publishBatch, reschedule, …) and apps/worker (hand-off, sweeper).
 */
export const schedulingEffects: SchedulingEffects = {
  async enqueueHandoff({ postId, scheduleVersion, startAt }) {
    await scheduleJob(QUEUE, {
      jobId: scheduleJobId(postId, scheduleVersion),
      jobName: "handoff",
      runAt: startAt,
      data: { kind: "handoff", postId, scheduleVersion },
      options: HANDOFF_JOB_OPTIONS,
    });
  },
  async ensureHandoffJob(job) {
    if (await getQueue(QUEUE).getJob(scheduleJobId(job.postId, job.scheduleVersion))) return false;
    await schedulingEffects.enqueueHandoff(job);
    return true;
  },
  async removeHandoffJob(jobId) {
    await cancelScheduledJob(QUEUE, jobId);
  },
  async requestPublish({ scheduleVersion, ...data }) {
    await inngest.send(
      postPublishRequested.create({ ...data, scheduleVersion }, { id: `post-publish:${data.postId}:sched-v${scheduleVersion}` }),
    );
  },
  async scheduleChanged(postId) {
    await inngest.send(postScheduleChanged.create({ postId }, { id: `post-schedule-changed:${postId}:${Date.now()}` }));
  },
  async notify({ postId, data, ...notification }) {
    await inngest.send(
      notificationCreate.create(
        { ...notification, postId, ...(data ? { data } : {}) },
        { id: `schedule-notify:${notification.type}:${postId}:${Date.now()}` },
      ),
    );
  },
};
