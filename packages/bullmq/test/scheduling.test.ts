import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  cancelScheduledJob,
  closeBullMQ,
  createWorker,
  getQueue,
  removeRecurringJob,
  rescheduleJob,
  scheduleJob,
  upsertRecurringJob,
} from "..";

const jobId = (postId: string, version: number) => `sched:${postId}:v${version}`;

// Needs Redis at REDIS_URL. Uses the real "scheduled-posts" queue with unique ids.
const QUEUE = "scheduled-posts" as const;
after(async () => {
  await closeBullMQ();
});

test("scheduleJob delays until runAt and dedupes by job id", async () => {
  const id = jobId(randomUUID(), 1);
  const runAt = new Date(Date.now() + 60_000);
  const data = { kind: "handoff" as const, postId: randomUUID(), scheduleVersion: 1 };
  const job = await scheduleJob(QUEUE, { jobId: id, runAt, data });
  assert.equal(await job.getState(), "delayed");
  assert.ok(Math.abs((job.opts.delay ?? 0) - 60_000) < 1_000);

  const again = await scheduleJob(QUEUE, { jobId: id, runAt, data });
  assert.equal(again.id, job.id);

  assert.equal(await rescheduleJob(QUEUE, id, new Date(Date.now() + 120_000)), true);
  assert.equal(await cancelScheduledJob(QUEUE, id), true);
  assert.equal(await getQueue(QUEUE).getJob(id), undefined);
  assert.equal(await cancelScheduledJob(QUEUE, id), false);
});

test("rejects job ids with ':' unless they have exactly three parts", async () => {
  await assert.rejects(
    scheduleJob(QUEUE, {
      jobId: "bad:id",
      runAt: new Date(),
      data: { kind: "handoff", postId: "x", scheduleVersion: 1 },
    }),
  );
});

test("a worker processes a due job", async () => {
  const postId = randomUUID();
  const done = new Promise<{ postId: string }>((resolve) => {
    const worker = createWorker(QUEUE, async (job) => {
      if (job.data.kind === "handoff" && job.data.postId === postId) resolve(job.data);
    });
    void worker.waitUntilReady();
  });
  await scheduleJob(QUEUE, {
    jobId: jobId(postId, 1),
    runAt: new Date(Date.now() - 1_000),
    data: { kind: "handoff", postId, scheduleVersion: 1 },
  });
  const processed = await done;
  assert.equal(processed.postId, postId);
});

test("recurring jobs can be upserted and removed", async () => {
  const schedulerId = `test-${randomUUID()}`;
  await upsertRecurringJob(
    QUEUE,
    schedulerId,
    { pattern: "0 3 * * *", tz: "UTC" },
    {
      data: { kind: "sweep" },
    },
  );
  const schedulers = await getQueue(QUEUE).getJobSchedulers();
  assert.ok(schedulers.some((s) => s.key === schedulerId));
  assert.equal(await removeRecurringJob(QUEUE, schedulerId), true);
});
