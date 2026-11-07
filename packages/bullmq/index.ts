import { logger } from "@repo/logger";
import { createBullMQConnection, type Redis } from "@repo/redis";
import {
  Queue,
  Worker,
  type Job,
  type JobsOptions,
  type Processor,
  type RepeatOptions,
  type WorkerOptions,
} from "bullmq";
import type { QueueName, QueuePayloads } from "./queues";

export * from "./queues";
export type { Job, JobsOptions, Processor } from "bullmq";

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

let queueConnection: Redis | undefined;
const queues = new Map<QueueName, Queue>();
/** Workers and the connections we created for them (BullMQ doesn't close injected clients). */
const workers = new Map<Worker, Redis>();

/** One shared @repo/redis connection for all producers in this process. */
function getQueueConnection(): Redis {
  queueConnection ??= createBullMQConnection("bullmq-queues");
  return queueConnection;
}

function rawQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getQueueConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue;
}

export function getQueue<N extends QueueName>(name: N): Queue<QueuePayloads[N]> {
  return rawQueue(name) as Queue<QueuePayloads[N]>;
}

/**
 * Start a worker for `name`. Each worker gets its own connection (workers
 * issue blocking commands). Failures are logged with ids only, never payloads.
 */
export function createWorker<N extends QueueName>(
  name: N,
  processor: Processor<QueuePayloads[N]>,
  options: Omit<WorkerOptions, "connection"> = {},
): Worker<QueuePayloads[N]> {
  const connection = createBullMQConnection(`bullmq-worker-${name}`);
  const worker = new Worker<QueuePayloads[N]>(name, processor, {
    concurrency: 5,
    ...options,
    connection,
  });
  worker.on("failed", (job, error) => {
    logger.error("Job failed", {
      queue: name,
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      message: error.message,
    });
  });
  worker.on("error", (error) =>
    logger.error("Worker error", { queue: name, message: error.message }),
  );
  workers.set(worker as Worker, connection);
  return worker;
}

function assertJobId(jobId: string) {
  // BullMQ reserves ":" in custom ids, except ids of exactly three parts ("sched:{postId}:v1").
  if (!jobId || (jobId.includes(":") && jobId.split(":").length !== 3)) throw new Error(`Invalid job id "${jobId}"`);
}

export type ScheduleJobInput<N extends QueueName> = {
  /** Stable id: scheduling the same id twice is a no-op while the job exists. */
  jobId: string;
  runAt: Date;
  data: QueuePayloads[N];
  jobName?: string;
  options?: Omit<JobsOptions, "jobId" | "delay">;
};

/** Run a job once at `runAt` (immediately if it's in the past). */
export async function scheduleJob<N extends QueueName>(
  name: N,
  input: ScheduleJobInput<N>,
): Promise<Job<QueuePayloads[N]>> {
  assertJobId(input.jobId);
  const delay = Math.max(0, input.runAt.getTime() - Date.now());
  const job = await rawQueue(name).add(input.jobName ?? name, input.data, {
    ...input.options,
    jobId: input.jobId,
    delay,
  });
  return job as Job<QueuePayloads[N]>;
}

/**
 * Cancel a job that hasn't started. Returns false if it doesn't exist or is
 * already running/finished.
 */
export async function cancelScheduledJob(name: QueueName, jobId: string): Promise<boolean> {
  const job = await getQueue(name).getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state !== "delayed" && state !== "waiting" && state !== "prioritized") return false;
  await job.remove();
  return true;
}

/** Move a delayed job to a new time. Returns false if it's not delayed any more. */
export async function rescheduleJob(name: QueueName, jobId: string, runAt: Date): Promise<boolean> {
  const job = await getQueue(name).getJob(jobId);
  if (!job || (await job.getState()) !== "delayed") return false;
  await job.changeDelay(Math.max(0, runAt.getTime() - Date.now()));
  return true;
}

export type RecurringSchedule =
  | { pattern: string; tz?: string; startDate?: Date; endDate?: Date }
  | { every: number; startDate?: Date; endDate?: Date };

/** Create or update a recurring job (cron `pattern` or `every` ms). Idempotent per id. */
export async function upsertRecurringJob<N extends QueueName>(
  name: N,
  schedulerId: string,
  schedule: RecurringSchedule,
  template: { jobName?: string; data: QueuePayloads[N]; options?: JobsOptions },
): Promise<void> {
  assertJobId(schedulerId);
  await rawQueue(name).upsertJobScheduler(schedulerId, schedule as Omit<RepeatOptions, "key">, {
    name: template.jobName ?? name,
    data: template.data,
    opts: template.options,
  });
}

export async function removeRecurringJob(name: QueueName, schedulerId: string): Promise<boolean> {
  return getQueue(name).removeJobScheduler(schedulerId);
}

/** Graceful shutdown: let workers finish current jobs, then close queues and connections. */
export async function closeBullMQ(): Promise<void> {
  await Promise.all(
    [...workers].map(async ([worker, connection]) => {
      await worker.close();
      await connection.quit();
    }),
  );
  workers.clear();
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  if (queueConnection) {
    const connection = queueConnection;
    queueConnection = undefined;
    await connection.quit();
  }
}
