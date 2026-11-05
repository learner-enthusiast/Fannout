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
  scheduledPostJobId,
  upsertRecurringJob,
} from "..";

// Needs Redis at REDIS_URL. Uses the real "scheduled-posts" queue with unique ids.
const QUEUE = "scheduled-posts" as const;
after(async () => {
  await closeBullMQ();
});

test("scheduleJob delays until runAt and dedupes by job id", async () => {
  const id = scheduledPostJobId(randomUUID(), 1);
  const runAt = new Date(Date.now() + 60_000);
  const data = { scheduledPostId: randomUUID(), scheduleVersion: 1 };
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

test("rejects job ids containing ':'", async () => {
  await assert.rejects(
    scheduleJob(QUEUE, {
      jobId: "bad:id",
      runAt: new Date(),
      data: { scheduledPostId: "x", scheduleVersion: 1 },
    }),
  );
});

test("a worker processes a due job", async () => {
  const scheduledPostId = randomUUID();
  const done = new Promise<{ scheduledPostId: string }>((resolve) => {
    const worker = createWorker(QUEUE, async (job) => {
      if (job.data.scheduledPostId === scheduledPostId) resolve(job.data);
    });
    void worker.waitUntilReady();
  });
  await scheduleJob(QUEUE, {
    jobId: scheduledPostJobId(scheduledPostId, 1),
    runAt: new Date(Date.now() - 1_000),
    data: { scheduledPostId, scheduleVersion: 1 },
  });
  const processed = await done;
  assert.equal(processed.scheduledPostId, scheduledPostId);
});

test("recurring jobs can be upserted and removed", async () => {
  const schedulerId = `test-${randomUUID()}`;
  await upsertRecurringJob(
    QUEUE,
    schedulerId,
    { pattern: "0 3 * * *", tz: "UTC" },
    {
      data: { scheduledPostId: "noop", scheduleVersion: 0 },
    },
  );
  const schedulers = await getQueue(QUEUE).getJobSchedulers();
  assert.ok(schedulers.some((s) => s.key === schedulerId));
  assert.equal(await removeRecurringJob(QUEUE, schedulerId), true);
});
