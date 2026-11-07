import { closeBullMQ, createWorker, scheduleJob, upsertRecurringJob, type Job, type QueuePayloads } from "@repo/bullmq";
import { schedulingEffects } from "@repo/inngest";
import { logger } from "@repo/logger";
import { closeRedis } from "@repo/redis";
import { handoff, sweep } from "@repo/services/scheduling";

/**
 * Scheduled posts worker. BullMQ only decides *when*: a `handoff` job fires
 * at start_at (scheduled_at − lead time) and, after an atomic re-check of the
 * DB row, hands the post to Inngest publish-post. The repeatable `sweep` job
 * recovers lost jobs and missed/stuck schedules.
 */
const QUEUE = "scheduled-posts" as const;
const SWEEP_EVERY_MS = 60_000;

async function processJob(job: Job<QueuePayloads[typeof QUEUE]>) {
  const data = job.data;
  if (data.kind === "sweep") {
    const result = await sweep(schedulingEffects);
    if (result.recreated || result.handedOff || result.missed || result.stuck) logger.info("Schedule sweep", result);
    return result;
  }
  // Never trust the payload alone: handoff() re-validates version + status in one UPDATE.
  const result = await handoff(data.postId, data.scheduleVersion, schedulingEffects);
  logger.info(result.handedOff ? "Scheduled post handed off" : "Stale scheduled-post job", {
    postId: data.postId,
    scheduleVersion: data.scheduleVersion,
  });
  return result;
}

async function main() {
  const worker = createWorker(QUEUE, processJob, { concurrency: 10 });
  await worker.waitUntilReady();

  await upsertRecurringJob(QUEUE, "sweeper", { every: SWEEP_EVERY_MS }, {
    jobName: "sweep",
    data: { kind: "sweep" },
    options: { attempts: 1, removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
  });
  // Once on start (catches up after downtime).
  await scheduleJob(QUEUE, {
    jobId: `sweep-start-${Date.now()}`,
    jobName: "sweep",
    runAt: new Date(),
    data: { kind: "sweep" },
    options: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } },
  });
  logger.info("Scheduled-posts worker started", { concurrency: 10 });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("Worker shutting down", { signal });
    try {
      await closeBullMQ();
      await closeRedis();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("Worker failed to start", { message: (error as Error).message });
  process.exit(1);
});
