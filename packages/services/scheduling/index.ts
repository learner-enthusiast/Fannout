import { and, asc, db, eq, inArray, isNull, media, postMedia, posts, scheduledPosts, sql } from "@repo/database";
import { errors } from "@repo/errors";
import { logger } from "@repo/logger";
import { z } from "zod";
import { invalidate } from "../cache";
import type { NotificationType } from "../notifications/model";
import { PostConfigSchema } from "../publishing/model";
import { scheduleTimeIssue } from "./effective";
import { leadSeconds } from "./lead-time";
import {
  MISSED_GRACE_MS,
  STUCK_AFTER_MS,
  SWEEP_LATE_MS,
  type CancelScheduleResult,
  type RescheduleInput,
  type ScheduleResult,
  type ScheduleStatus,
} from "./model";

export * from "./effective";
export * from "./lead-time";

const UuidSchema = z.uuid();

/** For writers that only know the post id (workers, sweeper): find the owner, then bump their posts group. */
async function invalidatePostOwner(postId: string) {
  const [row] = await db.select({ userId: posts.userId }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (row) await invalidate(row.userId, "posts");
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Deterministic BullMQ job id for one schedule version (BullMQ allows exactly 2 colons). */
export const scheduleJobId = (postId: string, version: number) => `sched:${postId}:v${version}`;

export type HandoffJob = { postId: string; scheduleVersion: number; startAt: Date };
export type PublishRequest = {
  postId: string;
  userId: string;
  socialConnectionId: string;
  batchId: string | null;
  scheduleVersion: number;
  /** ISO: the final publish call waits until this time. */
  publishAt: string;
  attempt: number;
};
export type ScheduleNotification = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  postId: string;
  data?: Record<string, unknown>;
};

/**
 * Side effects (BullMQ + Inngest) are injected so services never import them
 * (implementation: @repo/inngest `schedulingEffects`; tests pass fakes).
 */
export type SchedulingEffects = {
  /** Idempotent (deterministic job id). */
  enqueueHandoff(job: HandoffJob): Promise<void>;
  /** Re-add when missing (Redis loss). True when it had to be created. */
  ensureHandoffJob(job: HandoffJob): Promise<boolean>;
  /** Best effort: a stale job is harmless (the worker re-validates). */
  removeHandoffJob(jobId: string): Promise<void>;
  /** post/publish.requested (event id per version). */
  requestPublish(request: PublishRequest): Promise<void>;
  /** post/schedule.changed — cancels a sleeping/preparing publish-post run. */
  scheduleChanged(postId: string): Promise<void>;
  notify(notification: ScheduleNotification): Promise<void>;
};

const batchLink = (batchId: string | null) => (batchId ? `/posts/batch/${batchId}` : "/posts");
const OPEN: ScheduleStatus[] = ["scheduled", "handed_off"];
const FINISHED_POST = ["published", "deleting", "deleted"];

/** Lead time from the post's own platform + media (used on reschedule). */
async function leadForPost(postId: string, platform: string, mediaType: "video" | "photos", client: Tx | typeof db = db) {
  const [row] = await client
    .select({ bytes: sql<string>`coalesce(sum(${media.sizeBytes}), 0)` })
    .from(postMedia)
    .innerJoin(media, eq(media.id, postMedia.mediaId))
    .where(and(eq(postMedia.postId, postId), sql`${postMedia.role} <> 'thumbnail'`));
  return leadSeconds(platform as never, Number(row?.bytes ?? 0), mediaType);
}

async function loadOwnedSchedule(tx: Tx, userId: string, postId: string) {
  const [row] = await tx
    .select({ schedule: scheduledPosts, post: posts })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .where(and(eq(scheduledPosts.postId, UuidSchema.parse(postId)), eq(scheduledPosts.userId, UuidSchema.parse(userId))))
    .for("update")
    .limit(1);
  return row ?? null;
}

const toResult = (row: typeof scheduledPosts.$inferSelect): ScheduleResult => ({
  postId: row.postId,
  scheduledAt: row.scheduledAt,
  timezone: row.timezone,
  status: row.status as ScheduleStatus,
  scheduleVersion: row.scheduleVersion,
});

// ---------------------------------------------------------------------------
// Batch create (called by publishBatch after its transaction)
// ---------------------------------------------------------------------------

/** Enqueue the hand-off job for freshly created schedules. Failures are recovered by the sweeper. */
export async function enqueueSchedules(effects: SchedulingEffects, jobs: HandoffJob[]): Promise<void> {
  for (const job of jobs) {
    try {
      await effects.enqueueHandoff(job);
    } catch (error) {
      logger.error("Failed to enqueue scheduled post (sweeper will retry)", { postId: job.postId, message: (error as Error).message });
    }
  }
}

// ---------------------------------------------------------------------------
// Worker hand-off
// ---------------------------------------------------------------------------

export type HandoffResult = { handedOff: true; postId: string } | { handedOff: false; reason: "stale" };

/**
 * Atomic hand-off. Only a `scheduled` row at exactly this version (whose post
 * is still scheduled) moves to `handed_off`; anything else is a stale,
 * cancelled or rescheduled job and does nothing. A retry of the same job
 * (row already handed_off at this version) re-sends the event — the event id
 * is per version, so Inngest dedupes it.
 */
export async function handoff(postId: string, scheduleVersion: number, effects: SchedulingEffects, now = new Date()): Promise<HandoffResult> {
  const id = UuidSchema.parse(postId);
  const [claimed] = await db
    .update(scheduledPosts)
    .set({ status: "handed_off", lockedAt: now, updatedAt: now })
    .where(
      and(
        eq(scheduledPosts.postId, id),
        eq(scheduledPosts.scheduleVersion, scheduleVersion),
        eq(scheduledPosts.status, "scheduled"),
        sql`exists (select 1 from ${posts} where ${posts.id} = ${scheduledPosts.postId} and ${posts.status} = 'scheduled' and ${posts.externalPostId} is null)`,
      ),
    )
    .returning();

  if (claimed) await invalidatePostOwner(id);
  let row = claimed;
  if (!row) {
    const [current] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.postId, id)).limit(1);
    if (!current || current.scheduleVersion !== scheduleVersion || current.status !== "handed_off") {
      logger.info("Stale scheduled-post job skipped", { postId: id, scheduleVersion, current: current?.status, currentVersion: current?.scheduleVersion });
      return { handedOff: false, reason: "stale" };
    }
    row = current;
  }

  const [post] = await db
    .select({ userId: posts.userId, socialConnectionId: posts.socialConnectionId, batchId: posts.batchId, config: posts.config })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!post) return { handedOff: false, reason: "stale" };
  const config = PostConfigSchema.safeParse(post.config);
  await effects.requestPublish({
    postId: id,
    userId: post.userId,
    socialConnectionId: post.socialConnectionId,
    batchId: post.batchId,
    scheduleVersion,
    publishAt: row.scheduledAt.toISOString(),
    attempt: config.success ? config.data.attempts : 0,
  });
  return { handedOff: true, postId: id };
}

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

/**
 * New time for a scheduled / handed_off post that isn't published. Bumps the
 * version (old jobs and sleeping runs become stale), re-enqueues, and cancels
 * an in-flight run. Upload progress in posts.config is kept and reused.
 */
export async function reschedule(userId: string, input: RescheduleInput, effects: SchedulingEffects, now = new Date()): Promise<ScheduleResult> {
  const at = new Date(input.at);
  const issue = scheduleTimeIssue(at, now);
  if (issue) return errors.validation(issue, { field: "at" });

  const { row, previous } = await db.transaction(async (tx) => {
    const found = await loadOwnedSchedule(tx, userId, input.postId);
    if (!found) return errors.notFound("Scheduled post");
    const { schedule, post } = found;
    if (!OPEN.includes(schedule.status as ScheduleStatus) || FINISHED_POST.includes(post.status) || post.externalPostId) {
      return errors.conflict("Only scheduled posts that aren't published yet can be rescheduled", { status: schedule.status });
    }
    const config = PostConfigSchema.parse(post.config);
    const lead = await leadForPost(post.id, config.platform, config.mediaType, tx);
    const version = schedule.scheduleVersion + 1;
    const [updated] = await tx
      .update(scheduledPosts)
      .set({
        scheduleVersion: version,
        scheduledAt: at,
        startAt: new Date(at.getTime() - lead * 1000),
        timezone: input.timezone,
        status: "scheduled",
        lockedAt: null,
        lastError: null,
        queueJobId: scheduleJobId(post.id, version),
        updatedAt: now,
      })
      .where(eq(scheduledPosts.id, schedule.id))
      .returning();
    await tx
      .update(posts)
      .set({
        status: "scheduled",
        config: { ...config, progress: { ...config.progress, step: "Scheduled" } },
        updatedAt: now,
      })
      .where(eq(posts.id, post.id));
    return { row: updated!, previous: schedule };
  });

  await invalidate(userId, "posts");
  if (previous.queueJobId) await effects.removeHandoffJob(previous.queueJobId).catch(() => undefined);
  await enqueueSchedules(effects, [{ postId: row.postId, scheduleVersion: row.scheduleVersion, startAt: row.startAt }]);
  if (previous.status === "handed_off") await effects.scheduleChanged(row.postId);
  return toResult(row);
}

/** Idempotent. Someone else's / unknown post behaves like "already cancelled". */
export async function cancelSchedule(userId: string, postId: string, effects: SchedulingEffects, now = new Date()): Promise<CancelScheduleResult> {
  const out = await db.transaction(async (tx) => {
    const found = await loadOwnedSchedule(tx, userId, postId);
    if (!found) return null;
    const { schedule, post } = found;
    if (schedule.status === "completed" || FINISHED_POST.includes(post.status)) {
      return errors.conflict("This post is already published; delete it instead", { status: post.status });
    }
    if (!["scheduled", "handed_off", "missed"].includes(schedule.status)) return null;
    await tx
      .update(scheduledPosts)
      .set({ status: "cancelled", cancelledAt: now, lockedAt: null, scheduleVersion: schedule.scheduleVersion + 1, updatedAt: now })
      .where(eq(scheduledPosts.id, schedule.id));
    await tx
      .update(posts)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(posts.id, post.id), inArray(posts.status, ["scheduled", "queued", "publishing", "failed"])));
    return schedule;
  });
  if (!out) return { postId, cancelled: true, alreadyCancelled: true };
  await invalidate(userId, "posts");
  if (out.queueJobId) await effects.removeHandoffJob(out.queueJobId).catch(() => undefined);
  await effects.scheduleChanged(postId);
  return { postId, cancelled: true, alreadyCancelled: false };
}

/**
 * After posts.delete cancelled a post: close its schedule too (no-op when the
 * post wasn't scheduled).
 */
export async function closeScheduleAfterCancel(postId: string, effects: SchedulingEffects, now = new Date()): Promise<void> {
  const [row] = await db
    .update(scheduledPosts)
    .set({ status: "cancelled", cancelledAt: now, lockedAt: null, scheduleVersion: sql`${scheduledPosts.scheduleVersion} + 1`, updatedAt: now })
    .where(and(eq(scheduledPosts.postId, UuidSchema.parse(postId)), inArray(scheduledPosts.status, ["scheduled", "handed_off", "missed"])))
    .returning({ queueJobId: scheduledPosts.queueJobId });
  if (!row) return;
  await invalidatePostOwner(UuidSchema.parse(postId));
  if (row.queueJobId) await effects.removeHandoffJob(row.queueJobId).catch(() => undefined);
  await effects.scheduleChanged(postId);
}

/** Scheduled, handed_off or missed → publish right away (prepared uploads are reused). */
export async function publishNow(userId: string, postId: string, effects: SchedulingEffects, now = new Date()): Promise<ScheduleResult> {
  const { previous, version } = await db.transaction(async (tx) => {
    const found = await loadOwnedSchedule(tx, userId, postId);
    if (!found) return errors.notFound("Scheduled post");
    const { schedule, post } = found;
    if (!["scheduled", "handed_off", "missed"].includes(schedule.status) || FINISHED_POST.includes(post.status) || post.externalPostId) {
      return errors.conflict("Only scheduled or missed posts can be published now", { status: schedule.status });
    }
    const next = schedule.scheduleVersion + 1;
    await tx
      .update(scheduledPosts)
      .set({
        scheduleVersion: next,
        scheduledAt: now,
        startAt: now,
        status: "scheduled",
        lockedAt: null,
        missedAt: null,
        lastError: null,
        queueJobId: null,
        updatedAt: now,
      })
      .where(eq(scheduledPosts.id, schedule.id));
    const config = PostConfigSchema.parse(post.config);
    await tx
      .update(posts)
      .set({
        status: "scheduled",
        errorCode: null,
        errorMessage: null,
        config: { ...config, progress: { ...config.progress, step: "Publishing now" } },
        updatedAt: now,
      })
      .where(eq(posts.id, post.id));
    return { previous: schedule, version: next };
  });

  await invalidate(userId, "posts");
  if (previous.queueJobId) await effects.removeHandoffJob(previous.queueJobId).catch(() => undefined);
  if (previous.status === "handed_off") await effects.scheduleChanged(postId);
  const result = await handoff(postId, version, effects, now);
  if (!result.handedOff) return errors.conflict("The post changed meanwhile; refresh and try again");
  const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.postId, postId)).limit(1);
  return toResult(row!);
}

// ---------------------------------------------------------------------------
// publish-post (Inngest) helpers
// ---------------------------------------------------------------------------

/** The run's version is still the live one and the row is handed_off. */
export async function isScheduleCurrent(postId: string, scheduleVersion: number): Promise<boolean> {
  const [row] = await db
    .select({ status: scheduledPosts.status, version: scheduledPosts.scheduleVersion, postStatus: posts.status })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .where(eq(scheduledPosts.postId, UuidSchema.parse(postId)))
    .limit(1);
  return Boolean(row && row.version === scheduleVersion && row.status === "handed_off" && row.postStatus !== "cancelled");
}

export async function completeSchedule(postId: string, scheduleVersion: number, now = new Date()): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({ status: "completed", completedAt: now, lockedAt: null, updatedAt: now })
    .where(and(eq(scheduledPosts.postId, UuidSchema.parse(postId)), eq(scheduledPosts.scheduleVersion, scheduleVersion)));
  await invalidatePostOwner(UuidSchema.parse(postId));
}

/** Publishing failed for good: record it on the schedule too (no-op for unscheduled posts). */
export async function failSchedule(postId: string, message: string, now = new Date()): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({ status: "failed", lastError: message.slice(0, 500), lockedAt: null, updatedAt: now })
    .where(and(eq(scheduledPosts.postId, UuidSchema.parse(postId)), inArray(scheduledPosts.status, OPEN)));
  await invalidatePostOwner(UuidSchema.parse(postId));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function schedulesForPosts(postIds: string[]) {
  if (postIds.length === 0) return new Map<string, typeof scheduledPosts.$inferSelect>();
  const rows = await db.select().from(scheduledPosts).where(inArray(scheduledPosts.postId, postIds));
  return new Map(rows.map((row) => [row.postId, row]));
}

// ---------------------------------------------------------------------------
// Sweeper (worker, every 60 s + once on start)
// ---------------------------------------------------------------------------

export type SweepResult = { recreated: number; handedOff: number; missed: number; stuck: number };
const SWEEP_PAGE = 200;

/**
 * a) future scheduled rows without a BullMQ job → re-add (Redis loss)
 * b) scheduled rows whose start_at passed > 60 s ago (job never fired):
 *    ≤ 2 h past scheduled_at → hand off now; else missed + notification
 * c) handed_off rows > 30 min past scheduled_at (and past the hand-off), post not published → failed
 */
export async function sweep(effects: SchedulingEffects, now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { recreated: 0, handedOff: 0, missed: 0, stuck: 0 };

  // a) keyset pages over (start_at, id)
  let after: { startAt: Date; id: string } | null = null;
  for (let page = 0; page < 50; page++) {
    const rows: { id: string; postId: string; version: number; startAt: Date; queueJobId: string | null }[] = await db
      .select({
        id: scheduledPosts.id,
        postId: scheduledPosts.postId,
        version: scheduledPosts.scheduleVersion,
        startAt: scheduledPosts.startAt,
        queueJobId: scheduledPosts.queueJobId,
      })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.status, "scheduled"),
          sql`${scheduledPosts.startAt} > ${now}`,
          after ? sql`(${scheduledPosts.startAt}, ${scheduledPosts.id}) > (${after.startAt}, ${after.id}::uuid)` : undefined,
        ),
      )
      .orderBy(asc(scheduledPosts.startAt), asc(scheduledPosts.id))
      .limit(SWEEP_PAGE);
    for (const row of rows) {
      const jobId = scheduleJobId(row.postId, row.version);
      if (await effects.ensureHandoffJob({ postId: row.postId, scheduleVersion: row.version, startAt: row.startAt })) {
        result.recreated++;
        logger.warn("Re-created missing scheduled-post job", { postId: row.postId, scheduleVersion: row.version });
      }
      if (row.queueJobId !== jobId) {
        await db.update(scheduledPosts).set({ queueJobId: jobId }).where(and(eq(scheduledPosts.id, row.id), eq(scheduledPosts.scheduleVersion, row.version)));
      }
    }
    if (rows.length < SWEEP_PAGE) break;
    const last = rows.at(-1)!;
    after = { startAt: last.startAt, id: last.id };
  }

  // b) late
  const late = await db
    .select({ schedule: scheduledPosts, batchId: posts.batchId })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .where(and(eq(scheduledPosts.status, "scheduled"), sql`${scheduledPosts.startAt} <= ${new Date(now.getTime() - SWEEP_LATE_MS)}`))
    .orderBy(asc(scheduledPosts.startAt))
    .limit(SWEEP_PAGE);
  for (const { schedule, batchId } of late) {
    if (schedule.scheduledAt.getTime() >= now.getTime() - MISSED_GRACE_MS) {
      const handed = await handoff(schedule.postId, schedule.scheduleVersion, effects, now);
      if (handed.handedOff) result.handedOff++;
      continue;
    }
    const reason = "Fannout was offline at the scheduled time (more than 2 hours ago), so this post wasn't published.";
    const [missed] = await db
      .update(scheduledPosts)
      .set({ status: "missed", missedAt: now, lastError: reason, updatedAt: now })
      .where(and(eq(scheduledPosts.id, schedule.id), eq(scheduledPosts.scheduleVersion, schedule.scheduleVersion), eq(scheduledPosts.status, "scheduled")))
      .returning({ id: scheduledPosts.id });
    if (!missed) continue;
    await db
      .update(posts)
      .set({ status: "failed", errorCode: "schedule_missed", errorMessage: reason, updatedAt: now })
      .where(and(eq(posts.id, schedule.postId), eq(posts.status, "scheduled")));
    result.missed++;
    await invalidate(schedule.userId, "posts");
    await effects.notify({
      userId: schedule.userId,
      type: "schedule_missed",
      title: "A scheduled post was missed",
      body: `${reason} Open the batch and choose “Publish now”.`,
      link: batchLink(batchId),
      postId: schedule.postId,
      data: { action: "publish_now", scheduledAt: schedule.scheduledAt.toISOString() },
    });
  }

  // c) stuck after hand-off
  const stuck = await db
    .select({ schedule: scheduledPosts, batchId: posts.batchId })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .where(
      and(
        eq(scheduledPosts.status, "handed_off"),
        // 30 min after both the scheduled time and the hand-off (a late hand-off gets its own 30 min).
        sql`greatest(${scheduledPosts.scheduledAt}, coalesce(${scheduledPosts.lockedAt}, ${scheduledPosts.scheduledAt})) < ${new Date(now.getTime() - STUCK_AFTER_MS)}`,
        sql`${posts.status} not in ('published', 'deleting', 'deleted')`,
        isNull(posts.externalPostId),
      ),
    )
    .limit(SWEEP_PAGE);
  for (const { schedule, batchId } of stuck) {
    const reason = "Publishing didn't finish within 30 minutes of the scheduled time.";
    const [failed] = await db
      .update(scheduledPosts)
      .set({ status: "failed", lastError: reason, lockedAt: null, updatedAt: now })
      .where(and(eq(scheduledPosts.id, schedule.id), eq(scheduledPosts.scheduleVersion, schedule.scheduleVersion), eq(scheduledPosts.status, "handed_off")))
      .returning({ id: scheduledPosts.id });
    if (!failed) continue;
    await db
      .update(posts)
      .set({ status: "failed", errorCode: "schedule_stuck", errorMessage: reason, updatedAt: now })
      .where(and(eq(posts.id, schedule.postId), inArray(posts.status, ["scheduled", "queued", "publishing"])));
    await invalidate(schedule.userId, "posts");
    await effects.scheduleChanged(schedule.postId);
    result.stuck++;
    await effects.notify({
      userId: schedule.userId,
      type: "schedule_failed",
      title: "A scheduled post failed",
      body: `${reason} Open the batch to retry.`,
      link: batchLink(batchId),
      postId: schedule.postId,
    });
  }
  return result;
}
