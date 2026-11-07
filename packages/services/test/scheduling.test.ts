import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db, eq, posts, scheduledPosts, socialConnections, users } from "@repo/database";
import { claimPost } from "../publishing/run";
import {
  effectiveSchedule,
  handoff,
  isScheduleCurrent,
  leadSeconds,
  reschedule,
  scheduleJobId,
  scheduleTimeIssue,
  sweep,
  type HandoffJob,
  type PublishRequest,
  type SchedulingEffects,
} from "../scheduling";

// ---------------------------------------------------------------- pure

const at = (iso: string) => ({ at: iso, timezone: "Asia/Kolkata" });

test("effective time: card wins, scheduleAll fills the rest, none = instant", () => {
  const all = at("2030-01-01T10:00:00Z");
  assert.equal(effectiveSchedule({ schedule: at("2030-01-02T10:00:00Z") }, all)!.at.toISOString(), "2030-01-02T10:00:00.000Z");
  assert.equal(effectiveSchedule({}, all)!.at.toISOString(), "2030-01-01T10:00:00.000Z");
  assert.equal(effectiveSchedule({}, undefined), null);
  assert.equal(effectiveSchedule({ schedule: null }, null), null);
});

test("schedule time must be ≥ now + 2 min and ≤ 180 days", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  assert.ok(scheduleTimeIssue(new Date(now.getTime() + 60_000), now));
  assert.equal(scheduleTimeIssue(new Date(now.getTime() + 2 * 60_000), now), null);
  assert.ok(scheduleTimeIssue(new Date(now.getTime() + 181 * 86_400_000), now));
});

test("lead time: photos 30 s, push/pull formulas, clamped to 30 s … 30 min", () => {
  const config = { uploadMbps: 20, minSeconds: 30, maxSeconds: 1800 };
  assert.equal(leadSeconds("x", 10_000_000, "photos", config), 30);
  // 100 MB push at 20 Mbit/s = 40 s × 1.5 = 60 + 60 = 120 s
  assert.equal(leadSeconds("youtube", 100_000_000, "video", config), 120);
  // pull: 120 + 100 MB / 5 MB = 140 s
  assert.equal(leadSeconds("threads", 100_000_000, "video", config), 140);
  assert.equal(leadSeconds("youtube", 50_000_000_000, "video", config), 1800);
  assert.equal(leadSeconds("facebook", 0, "video", { ...config, minSeconds: 200 }), 200);
});

// ---------------------------------------------------------------- DB

function fakeEffects() {
  const calls = {
    published: [] as PublishRequest[],
    enqueued: [] as HandoffJob[],
    recreated: [] as HandoffJob[],
    removed: [] as string[],
    changed: [] as string[],
    notified: [] as { type: string; postId: string }[],
  };
  const jobs = new Set<string>();
  const effects: SchedulingEffects = {
    async enqueueHandoff(job) {
      calls.enqueued.push(job);
      jobs.add(scheduleJobId(job.postId, job.scheduleVersion));
    },
    async ensureHandoffJob(job) {
      const id = scheduleJobId(job.postId, job.scheduleVersion);
      if (jobs.has(id)) return false;
      calls.recreated.push(job);
      jobs.add(id);
      return true;
    },
    async removeHandoffJob(jobId) {
      calls.removed.push(jobId);
      jobs.delete(jobId);
    },
    async requestPublish(request) {
      calls.published.push(request);
    },
    async scheduleChanged(postId) {
      calls.changed.push(postId);
    },
    async notify(n) {
      calls.notified.push({ type: n.type, postId: n.postId });
    },
  };
  return { effects, calls, jobs };
}

let userId = "";
let connectionId = "";
before(async () => {
  const [user] = await db.insert(users).values({ clerkId: `user_test_${randomUUID()}`, email: `sch-${randomUUID()}@example.com` }).returning({ id: users.id });
  userId = user!.id;
  const [conn] = await db
    .insert(socialConnections)
    .values({ userId, provider: "YOUTUBE", providerAccountId: `UC${randomUUID().slice(0, 6)}`, accessTokenEncrypted: "v1.x", refreshTokenEncrypted: "v1.y" })
    .returning({ id: socialConnections.id });
  connectionId = conn!.id;
});
after(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

async function scheduledPost(scheduledAt: Date, startAt: Date, version = 1, status = "scheduled") {
  const [post] = await db
    .insert(posts)
    .values({
      userId,
      socialConnectionId: connectionId,
      name: "Scheduled test",
      status: "scheduled",
      config: { platform: "youtube", mediaType: "video", input: { title: "T", privacyStatus: "public", madeForKids: false }, attempts: 0, progress: {} },
    })
    .returning({ id: posts.id });
  await db.insert(scheduledPosts).values({
    postId: post!.id,
    userId,
    scheduledAt,
    startAt,
    timezone: "UTC",
    status,
    scheduleVersion: version,
    queueJobId: scheduleJobId(post!.id, version),
  });
  return post!.id;
}

const minutes = (n: number) => new Date(Date.now() + n * 60_000);
const scheduleRow = async (postId: string) => (await db.select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId)))[0]!;

test("handoff: current version hands off once; stale version or cancelled does nothing", async () => {
  const { effects, calls } = fakeEffects();
  const postId = await scheduledPost(minutes(10), minutes(5), 2);

  assert.deepEqual(await handoff(postId, 1, effects), { handedOff: false, reason: "stale" });
  assert.equal(calls.published.length, 0);

  assert.equal((await handoff(postId, 2, effects)).handedOff, true);
  assert.equal(calls.published.length, 1);
  assert.equal(calls.published[0]!.scheduleVersion, 2);
  assert.equal((await scheduleRow(postId)).status, "handed_off");

  const cancelled = await scheduledPost(minutes(10), minutes(5), 1, "cancelled");
  assert.equal((await handoff(cancelled, 1, effects)).handedOff, false);
  assert.equal(calls.published.filter((p) => p.postId === cancelled).length, 0);
});

test("sweeper: missing job recreated; 30 min late → handoff; 3 h late → missed", async () => {
  const { effects, calls } = fakeEffects();
  const future = await scheduledPost(minutes(60), minutes(55));
  const late = await scheduledPost(minutes(-30), minutes(-32));
  const veryLate = await scheduledPost(minutes(-180), minutes(-182));

  await sweep(effects);

  assert.ok(calls.recreated.some((j) => j.postId === future));
  assert.ok(calls.published.some((p) => p.postId === late));
  assert.equal((await scheduleRow(late)).status, "handed_off");

  const missed = await scheduleRow(veryLate);
  assert.equal(missed.status, "missed");
  assert.ok(missed.missedAt);
  const [post] = await db.select().from(posts).where(eq(posts.id, veryLate));
  assert.equal(post!.status, "failed");
  assert.equal(post!.errorCode, "schedule_missed");
  assert.ok(calls.notified.some((n) => n.postId === veryLate && n.type === "schedule_missed"));
  assert.ok(!calls.published.some((p) => p.postId === veryLate));
});

test("publish-post guards: after a reschedule the old version can't claim and isn't current", async () => {
  const { effects } = fakeEffects();
  const postId = await scheduledPost(minutes(10), minutes(5));
  await handoff(postId, 1, effects);
  assert.equal(await isScheduleCurrent(postId, 1), true);

  // Rescheduled while the v1 run slept → v1 must exit without finalize.
  await reschedule(userId, { postId, at: minutes(30).toISOString(), timezone: "UTC" }, effects);
  assert.equal(await isScheduleCurrent(postId, 1), false);
  assert.equal(await claimPost(postId, 1), null);
  assert.equal((await scheduleRow(postId)).scheduleVersion, 2);
});
