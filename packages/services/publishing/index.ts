import { and, asc, db, desc, eq, inArray, media, postMedia, posts, scheduledPosts, socialConnections, sql } from "@repo/database";
import { errors } from "@repo/errors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { isUniqueViolation } from "../lib/pg-errors";
import { MediaRowSchema } from "../media/model";
import { SocialConnectionRowSchema } from "../social-connections/model";
import { toSocialConnectionView } from "../social-connections";
import {
  BatchPageSchema,
  BatchViewSchema,
  ListBatchesInputSchema,
  PostConfigSchema,
  PublishBatchInputSchema,
  TERMINAL_STATUSES,
  type BatchView,
  type PublishBatchInput,
  type PublishBatchResult,
  type ValidationIssue,
} from "./model";
import { fallbackPostName } from "../ai-content/post-name";
import { enqueueSchedules, leadSeconds, scheduleJobId, schedulesForPosts, type HandoffJob, type SchedulingEffects } from "../scheduling";
import type { ScheduleStatus } from "../scheduling/model";
import { PLATFORMS, platformForProvider, type Platform } from "./platforms";
import { validateBatch, type ValidatedTarget } from "./validate";

const UuidSchema = z.uuid();
const targetKey = (idempotencyKey: string, connectionId: string) => `${idempotencyKey}:${connectionId}`;

async function loadForValidation(userId: string, input: PublishBatchInput) {
  const connectionIds = input.targets.map((t) => t.socialConnectionId);
  const mediaIds = [
    ...new Set([
      ...input.mediaIds,
      ...input.targets.flatMap((t) => t.mediaIds ?? []),
      ...Object.values(input.thumbnailByConnection ?? {}),
    ]),
  ];
  const [connectionRows, mediaRows] = await Promise.all([
    db
      .select()
      .from(socialConnections)
      .where(and(eq(socialConnections.userId, userId), inArray(socialConnections.id, connectionIds))),
    mediaIds.length
      ? db.select().from(media).where(and(eq(media.userId, userId), inArray(media.id, mediaIds)))
      : Promise.resolve([]),
  ]);
  return {
    connections: connectionRows.map((row) => {
      const parsed = SocialConnectionRowSchema.parse(row);
      return { ...parsed, status: toSocialConnectionView(parsed).status };
    }),
    media: mediaRows.map((row) => MediaRowSchema.parse(row)),
  };
}

/** Dry run for the composer: same checks as publishBatch, nothing written. */
export async function validatePublishBatch(
  userId: string,
  input: z.input<typeof PublishBatchInputSchema>,
): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
  const data = PublishBatchInputSchema.parse(input);
  const loaded = await loadForValidation(UuidSchema.parse(userId), data);
  const { issues } = validateBatch({ userId, input: data, ...loaded });
  return { valid: issues.length === 0, issues };
}

async function existingBatch(userId: string, idempotencyKey: string, connectionIds: string[]) {
  const rows = await db
    .select({ id: posts.id, batchId: posts.batchId, socialConnectionId: posts.socialConnectionId, config: posts.config })
    .from(posts)
    .where(
      and(
        eq(posts.userId, userId),
        inArray(
          posts.idempotencyKey,
          connectionIds.map((id) => targetKey(idempotencyKey, id)),
        ),
      ),
    );
  if (rows.length === 0) return null;
  const schedules = await schedulesForPosts(rows.map((row) => row.id));
  return {
    batchId: rows[0]!.batchId!,
    posts: rows.map((row) => ({
      id: row.id,
      socialConnectionId: row.socialConnectionId,
      platform: PostConfigSchema.parse(row.config).platform,
      scheduledAt: schedules.get(row.id)?.scheduledAt ?? null,
    })),
  };
}

function captionOf(target: ValidatedTarget): string | null {
  const value = target.input[PLATFORMS[target.platform].captionField];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Creates one post per target (same batch_id) with its post_media in a
 * single transaction: instant targets are `queued` (Inngest fan-out),
 * scheduled ones are `scheduled` + a scheduled_posts row whose hand-off job
 * is enqueued (via `options.scheduling`) after commit. The same
 * idempotencyKey returns the existing batch. Validation failures throw
 * VALIDATION with `details.issues`.
 */
export async function publishBatch(
  userId: string,
  input: z.input<typeof PublishBatchInputSchema>,
  /** Internal (repost): join an existing batch and tag the new posts' config. */
  options: { batchId?: string; extraConfig?: Record<string, unknown>; scheduling?: SchedulingEffects } = {},
): Promise<PublishBatchResult> {
  const data = PublishBatchInputSchema.parse(input);
  const owner = UuidSchema.parse(userId);
  const connectionIds = data.targets.map((t) => t.socialConnectionId);

  const previous = await existingBatch(owner, data.idempotencyKey, connectionIds);
  if (previous) return { ...previous, replayed: true };

  const loaded = await loadForValidation(owner, data);
  const { issues, targets } = validateBatch({ userId: owner, input: data, ...loaded });
  if (issues.length) return errors.validation("Some posts aren't ready to publish", { issues });

  // Valid name right away (required column); AI rewrites it in the background.
  const name = fallbackPostName(
    targets.flatMap((t) => [t.input.title, t.input.videoTitle, captionOf(t)].filter((v): v is string => typeof v === "string")),
  );
  const ownedJson = data.jsonMediaId && loaded.media.some((m) => m.id === data.jsonMediaId && m.type === "json") ? data.jsonMediaId : undefined;
  if (data.jsonMediaId && !ownedJson) {
    const [row] = await db.select({ id: media.id, type: media.type }).from(media).where(and(eq(media.id, data.jsonMediaId), eq(media.userId, owner))).limit(1);
    if (!row || row.type !== "json") return errors.validation("The social JSON wasn't found in your library");
  }

  if (targets.some((t) => t.schedule) && !options.scheduling) {
    return errors.badRequest("Scheduling isn't available here");
  }
  const mediaById = new Map(loaded.media.map((m) => [m.id, m]));
  const batchId = options.batchId ?? randomUUID();
  const jobs: HandoffJob[] = [];
  try {
    const created = await db.transaction(async (tx) => {
      const out: PublishBatchResult["posts"] = [];
      for (const target of targets) {
        const schedule = target.schedule;
        const [post] = await tx
          .insert(posts)
          .values({
            userId: owner,
            socialConnectionId: target.socialConnectionId,
            name,
            caption: captionOf(target),
            config: {
              platform: target.platform,
              mediaType: data.mediaType,
              input: target.input,
              attempts: 0,
              progress: schedule ? { step: "Scheduled" } : {},
              ...(data.jsonMediaId ? { sourceJsonId: data.jsonMediaId } : {}),
              ...options.extraConfig,
            },
            status: schedule ? "scheduled" : "queued",
            batchId,
            idempotencyKey: targetKey(data.idempotencyKey, target.socialConnectionId),
          })
          .returning({ id: posts.id });
        const rows = [
          ...target.mediaIds.map((mediaId, position) => ({
            postId: post!.id,
            mediaId,
            role: data.mediaType === "video" ? "video" : "image",
            position,
          })),
          ...(target.thumbnailId ? [{ postId: post!.id, mediaId: target.thumbnailId, role: "thumbnail", position: 0 }] : []),
        ];
        if (rows.length) await tx.insert(postMedia).values(rows);
        if (schedule) {
          const bytes = target.mediaIds.reduce((sum, id) => sum + (mediaById.get(id)?.sizeBytes ?? 0), 0);
          const startAt = new Date(schedule.at.getTime() - leadSeconds(target.platform, bytes, data.mediaType) * 1000);
          await tx.insert(scheduledPosts).values({
            postId: post!.id,
            userId: owner,
            scheduledAt: schedule.at,
            startAt,
            timezone: schedule.timezone,
            status: "scheduled",
            scheduleVersion: 1,
            queueJobId: scheduleJobId(post!.id, 1),
          });
          jobs.push({ postId: post!.id, scheduleVersion: 1, startAt });
        }
        out.push({ id: post!.id, platform: target.platform, socialConnectionId: target.socialConnectionId, scheduledAt: schedule?.at ?? null });
      }
      return out;
    });
    // Committed: new posts (and their schedules) exist.
    await invalidate(owner, "posts");
    if (jobs.length && options.scheduling) await enqueueSchedules(options.scheduling, jobs);
    return { batchId, posts: created, replayed: false };
  } catch (error) {
    // A concurrent submit with the same key won the race: return its batch.
    if (isUniqueViolation(error)) {
      const raced = await existingBatch(owner, data.idempotencyKey, connectionIds);
      if (raced) return { ...raced, replayed: true };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Batch views
// ---------------------------------------------------------------------------

async function batchViews(userId: string, batchIds: string[]): Promise<BatchView[]> {
  if (batchIds.length === 0) return [];
  const rows = await db
    .select({ post: posts, connection: socialConnections })
    .from(posts)
    .innerJoin(socialConnections, eq(socialConnections.id, posts.socialConnectionId))
    .where(and(eq(posts.userId, userId), inArray(posts.batchId, batchIds)))
    .orderBy(asc(posts.createdAt), asc(posts.id));
  const schedules = await schedulesForPosts(rows.map((row) => row.post.id));

  return batchIds.map((batchId) => {
    const items = rows.filter((row) => row.post.batchId === batchId);
    const views = items.map(({ post, connection }) => {
      const config = PostConfigSchema.safeParse(post.config);
      const platform: Platform = config.success ? config.data.platform : (platformForProvider(connection.provider) ?? "x");
      const step = config.success ? (config.data.progress.step as string | undefined) : undefined;
      return {
        id: post.id,
        platform,
        socialConnectionId: post.socialConnectionId,
        account: {
          username: connection.username,
          displayName: connection.displayName,
          profilePictureUrl: connection.profilePictureUrl,
        },
        status: post.status as BatchView["posts"][number]["status"],
        step: step ?? null,
        postUrl: post.postUrl,
        errorCode: post.errorCode,
        errorMessage: post.errorMessage,
        publishedAt: post.publishedAt,
        updatedAt: post.updatedAt,
        externalStatus: post.externalStatus,
        editStatus: post.editStatus,
        editErrorMessage: post.editErrorMessage,
        lastEditedAt: post.lastEditedAt,
        deleteErrorCode: post.deleteErrorCode,
        deleteErrorMessage: post.deleteErrorMessage,
        deletedAt: post.deletedAt,
        schedule: (() => {
          const row = schedules.get(post.id);
          return row
            ? {
                scheduledAt: row.scheduledAt,
                timezone: row.timezone,
                status: row.status as ScheduleStatus,
                scheduleVersion: row.scheduleVersion,
                lastError: row.lastError,
              }
            : null;
        })(),
      };
    });
    const first = items[0]?.post;
    const firstConfig = first ? PostConfigSchema.safeParse(first.config) : null;
    const count = (statuses: readonly string[]) => views.filter((v) => statuses.includes(v.status)).length;
    const published = count(["published"]);
    const failed = count(["failed", "cancelled"]);
    return {
      batchId,
      name: first?.name ?? "Untitled post",
      mediaType: firstConfig?.success ? firstConfig.data.mediaType : "video",
      createdAt: first?.createdAt ?? new Date(0),
      caption: items.find((row) => row.post.caption)?.post.caption ?? null,
      finished: views.length > 0 && views.every((v) => (TERMINAL_STATUSES as readonly string[]).includes(v.status)),
      counts: { total: views.length, published, failed, pending: views.length - published - failed },
      posts: views,
    };
  });
}

/**
 * Group "posts" (600 s). Never stored while any post is mid-publish/delete/edit, and `step` (derived from
 * posts.config.progress) is dropped from what is stored. A scheduled post whose time has passed is a miss.
 */
const IN_FLIGHT_STATUSES = ["queued", "publishing", "deleting"];
const batchCacheable = (batch: BatchView) => batch.posts.every((post) => !IN_FLIGHT_STATUSES.includes(post.status) && post.editStatus !== "editing");
const batchForCache = (batch: BatchView): BatchView => ({ ...batch, posts: batch.posts.map((post) => ({ ...post, step: null })) });
const batchStale = (batch: BatchView) => batch.posts.some((post) => post.schedule?.status === "scheduled" && post.schedule.scheduledAt.getTime() <= Date.now());

export async function getBatch(userId: string, batchId: string): Promise<BatchView> {
  const owner = UuidSchema.parse(userId);
  const id = UuidSchema.parse(batchId);
  return cached({
    userId: owner,
    group: "posts",
    key: "getBatch",
    input: { batchId: id },
    schema: BatchViewSchema,
    isStale: batchStale,
    cacheable: batchCacheable,
    forCache: batchForCache,
    load: async () => {
      const [view] = await batchViews(owner, [id]);
      if (!view || view.posts.length === 0) return errors.notFound("Batch");
      return view;
    },
  });
}

/** Batches newest first; cursor = (first post created_at, batch_id). */
export async function listBatches(userId: string, input: z.input<typeof ListBatchesInputSchema> = {}) {
  const parsed = ListBatchesInputSchema.parse(input);
  const owner = UuidSchema.parse(userId);
  return cached({
    userId: owner,
    group: "posts",
    key: "listBatches",
    input: { cursor: parsed.cursor ?? null, limit: parsed.limit, filter: parsed.filter ?? null },
    schema: BatchPageSchema,
    isStale: (page) => page.items.some(batchStale),
    cacheable: (page) => page.items.every(batchCacheable),
    forCache: (page) => ({ ...page, items: page.items.map(batchForCache) }),
    load: () => loadBatches(owner, parsed),
  });
}

async function loadBatches(owner: string, { cursor, limit, filter }: z.output<typeof ListBatchesInputSchema>) {
  const started = sql<Date>`min(${posts.createdAt})`;
  const startedText = sql<string>`to_char(min(${posts.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const after = cursor ? decodeCursor(cursor) : null;

  const rows = await db
    .select({ batchId: posts.batchId, started, startedText })
    .from(posts)
    .where(
      and(
        eq(posts.userId, owner),
        sql`${posts.batchId} IS NOT NULL`,
        filter === "scheduled"
          ? sql`${posts.batchId} IN (SELECT p2.batch_id FROM ${posts} p2 JOIN ${scheduledPosts} s ON s.post_id = p2.id WHERE p2.user_id = ${owner} AND s.status IN ('scheduled', 'handed_off', 'missed'))`
          : undefined,
      ),
    )
    .groupBy(posts.batchId)
    .having(after ? sql`(min(${posts.createdAt}), ${posts.batchId}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : undefined)
    .orderBy(desc(started), desc(posts.batchId))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: await batchViews(owner, page.map((row) => row.batchId!)),
    nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.startedText, id: last.batchId! }) : null,
  };
}

/** Failed posts only: back to queued; returns what the caller needs to re-send the event. */
export async function retryPost(userId: string, postId: string) {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, UuidSchema.parse(postId)), eq(posts.userId, UuidSchema.parse(userId))))
    .limit(1);
  if (!row) return errors.notFound("Post");
  if (row.status !== "failed") return errors.conflict("Only failed posts can be retried");
  const config = PostConfigSchema.parse(row.config);
  const attempts = config.attempts + 1;
  await db
    .update(posts)
    .set({
      status: "queued",
      errorCode: null,
      errorMessage: null,
      config: { ...config, attempts, progress: { ...config.progress, step: "Queued for retry" } },
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, row.id), eq(posts.status, "failed")));
  await invalidate(row.userId, "posts");
  return { postId: row.id, batchId: row.batchId, socialConnectionId: row.socialConnectionId, attempt: attempts };
}
