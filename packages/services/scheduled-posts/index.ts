import {
  and,
  asc,
  db,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  posts,
  scheduledPosts,
  sql,
} from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import {
  CreateScheduledPostInputSchema,
  ListDueScheduledPostsInputSchema,
  ListScheduledPostsInputSchema,
  RescheduleInputSchema,
  ScheduledPostRowSchema,
  type CreateScheduledPostInput,
  type ListDueScheduledPostsInput,
  type ListScheduledPostsInput,
  type RescheduleInput,
  type ScheduledPostRow,
} from "./model";

const UuidSchema = z.uuid();
/** A lock older than this is considered abandoned by a crashed worker. */
const STALE_LOCK_MS = 10 * 60 * 1000;
const OPEN_STATUSES = ["pending", "queued"] as const;

function ownedWhere(userId: string, id: string) {
  return and(
    eq(scheduledPosts.id, UuidSchema.parse(id)),
    eq(scheduledPosts.userId, UuidSchema.parse(userId)),
  );
}

// ---------- user-scoped ----------

export async function createScheduledPost(
  userId: string,
  input: CreateScheduledPostInput,
): Promise<ScheduledPostRow> {
  const parsedUserId = UuidSchema.parse(userId);
  const data = CreateScheduledPostInputSchema.parse(input);
  if (data.scheduledAt.getTime() <= Date.now()) {
    return errors.validation("scheduledAt must be in the future");
  }

  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, data.postId), eq(posts.userId, parsedUserId)))
    .limit(1);
  if (!post) return errors.notFound("Post");

  const [row] = await db
    .insert(scheduledPosts)
    .values({ ...data, userId: parsedUserId })
    .onConflictDoNothing({ target: scheduledPosts.postId })
    .returning();
  if (!row) return errors.conflict("Post is already scheduled");
  return ScheduledPostRowSchema.parse(row);
}

export async function getScheduledPostById(
  userId: string,
  id: string,
): Promise<ScheduledPostRow | null> {
  const [row] = await db.select().from(scheduledPosts).where(ownedWhere(userId, id)).limit(1);
  return row ? ScheduledPostRowSchema.parse(row) : null;
}

export async function getScheduledPostByPostId(
  userId: string,
  postId: string,
): Promise<ScheduledPostRow | null> {
  const [row] = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.postId, UuidSchema.parse(postId)),
        eq(scheduledPosts.userId, UuidSchema.parse(userId)),
      ),
    )
    .limit(1);
  return row ? ScheduledPostRowSchema.parse(row) : null;
}

/** Ordered by scheduledAt ascending; filter by status and/or a time window. */
export async function listScheduledPostsByUserId(
  userId: string,
  options: ListScheduledPostsInput = {},
): Promise<ScheduledPostRow[]> {
  const { status, from, to, limit, offset } = ListScheduledPostsInputSchema.parse(options);
  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, UuidSchema.parse(userId)),
        status ? eq(scheduledPosts.status, status) : undefined,
        from ? gte(scheduledPosts.scheduledAt, from) : undefined,
        to ? lte(scheduledPosts.scheduledAt, to) : undefined,
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit)
    .offset(offset);
  return z.array(ScheduledPostRowSchema).parse(rows);
}

/** Pending/queued posts scheduled from now onwards. */
export async function listUpcomingScheduledPostsByUserId(
  userId: string,
  limit = 20,
): Promise<ScheduledPostRow[]> {
  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, UuidSchema.parse(userId)),
        inArray(scheduledPosts.status, [...OPEN_STATUSES]),
        gte(scheduledPosts.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit);
  return z.array(ScheduledPostRowSchema).parse(rows);
}

/**
 * Move to a new time. Bumps scheduleVersion so any job queued for the old
 * time can detect it is stale, and resets the job id/status.
 */
export async function reschedulePost(
  userId: string,
  id: string,
  input: RescheduleInput,
): Promise<ScheduledPostRow> {
  const data = RescheduleInputSchema.parse(input);
  if (data.scheduledAt.getTime() <= Date.now()) {
    return errors.validation("scheduledAt must be in the future");
  }

  const [row] = await db
    .update(scheduledPosts)
    .set({
      scheduledAt: data.scheduledAt,
      ...(data.timezone ? { timezone: data.timezone } : {}),
      status: "pending",
      queueJobId: null,
      lockedAt: null,
      cancelledAt: null,
      scheduleVersion: sql`${scheduledPosts.scheduleVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        ownedWhere(userId, id),
        inArray(scheduledPosts.status, [...OPEN_STATUSES, "cancelled", "failed"]),
      ),
    )
    .returning();
  if (!row) return errors.notFound("Reschedulable scheduled post");
  return ScheduledPostRowSchema.parse(row);
}

export async function cancelScheduledPost(userId: string, id: string): Promise<ScheduledPostRow> {
  const [row] = await db
    .update(scheduledPosts)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      scheduleVersion: sql`${scheduledPosts.scheduleVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(ownedWhere(userId, id), inArray(scheduledPosts.status, [...OPEN_STATUSES])))
    .returning();
  if (!row) return errors.notFound("Cancellable scheduled post");
  return ScheduledPostRowSchema.parse(row);
}

export async function deleteScheduledPost(userId: string, id: string): Promise<void> {
  const [row] = await db
    .delete(scheduledPosts)
    .where(ownedWhere(userId, id))
    .returning({ id: scheduledPosts.id });
  if (!row) errors.notFound("Scheduled post");
}

// ---------- worker / queue (not user-scoped) ----------

/** Open scheduled posts whose time has come and that aren't held by a live lock. */
export async function listDueScheduledPosts(
  options: ListDueScheduledPostsInput = {},
): Promise<ScheduledPostRow[]> {
  const { now = new Date(), limit } = ListDueScheduledPostsInputSchema.parse(options);
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        inArray(scheduledPosts.status, [...OPEN_STATUSES]),
        lte(scheduledPosts.scheduledAt, now),
        or(isNull(scheduledPosts.lockedAt), lt(scheduledPosts.lockedAt, staleBefore)),
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit);
  return z.array(ScheduledPostRowSchema).parse(rows);
}

export async function setScheduledPostQueueJob(
  id: string,
  queueJobId: string,
  scheduleVersion: number,
): Promise<ScheduledPostRow | null> {
  const [row] = await db
    .update(scheduledPosts)
    .set({ queueJobId, status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(scheduledPosts.id, UuidSchema.parse(id)),
        eq(scheduledPosts.scheduleVersion, scheduleVersion),
        eq(scheduledPosts.status, "pending"),
      ),
    )
    .returning();
  return row ? ScheduledPostRowSchema.parse(row) : null;
}

/**
 * Atomically claim a scheduled post for publishing. Returns null if it was
 * rescheduled/cancelled (version mismatch) or another worker holds the lock.
 */
export async function lockScheduledPost(
  id: string,
  scheduleVersion: number,
): Promise<ScheduledPostRow | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const [row] = await db
    .update(scheduledPosts)
    .set({ lockedAt: now, status: "processing", updatedAt: now })
    .where(
      and(
        eq(scheduledPosts.id, UuidSchema.parse(id)),
        eq(scheduledPosts.scheduleVersion, scheduleVersion),
        or(
          inArray(scheduledPosts.status, [...OPEN_STATUSES]),
          and(eq(scheduledPosts.status, "processing"), lt(scheduledPosts.lockedAt, staleBefore)),
        ),
      ),
    )
    .returning();
  return row ? ScheduledPostRowSchema.parse(row) : null;
}

export async function markScheduledPostCompleted(id: string): Promise<ScheduledPostRow> {
  const now = new Date();
  const [row] = await db
    .update(scheduledPosts)
    .set({ status: "completed", completedAt: now, lockedAt: null, updatedAt: now })
    .where(
      and(eq(scheduledPosts.id, UuidSchema.parse(id)), eq(scheduledPosts.status, "processing")),
    )
    .returning();
  if (!row) return errors.notFound("Processing scheduled post");
  return ScheduledPostRowSchema.parse(row);
}

export async function markScheduledPostFailed(id: string): Promise<ScheduledPostRow> {
  const [row] = await db
    .update(scheduledPosts)
    .set({ status: "failed", lockedAt: null, updatedAt: new Date() })
    .where(
      and(eq(scheduledPosts.id, UuidSchema.parse(id)), eq(scheduledPosts.status, "processing")),
    )
    .returning();
  if (!row) return errors.notFound("Processing scheduled post");
  return ScheduledPostRowSchema.parse(row);
}
