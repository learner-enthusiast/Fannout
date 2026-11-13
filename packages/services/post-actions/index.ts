import { and, asc, db, eq, inArray, postMedia, posts, socialConnections } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { cached, invalidate } from "../cache";
import { omit } from "../lib/omit";
import { publishBatch } from "../publishing";
import { PostConfigSchema } from "../publishing/model";
import { PLATFORMS, platformForProvider, type Platform } from "../publishing/platforms";
import { PostDetailSchema, RevisionSchema, type DeleteResult } from "./model";
import { planDelete, planEdit } from "./plan";

const UuidSchema = z.uuid();

/** Event the router must send after a request (services don't import Inngest). */
export type PostActionEvent =
  | { name: "post/publish.cancelled"; data: { postId: string } }
  | { name: "post/delete.requested"; data: { postId: string; userId: string; socialConnectionId: string } }
  | { name: "post/edit.requested"; data: { postId: string; userId: string; socialConnectionId: string } };

async function loadOwned(userId: string, postId: string) {
  const [row] = await db
    .select({ post: posts, connection: socialConnections })
    .from(posts)
    .innerJoin(socialConnections, eq(socialConnections.id, posts.socialConnectionId))
    .where(and(eq(posts.id, UuidSchema.parse(postId)), eq(posts.userId, UuidSchema.parse(userId))))
    .limit(1);
  if (!row) return errors.notFound("Post");
  const config = PostConfigSchema.safeParse(row.post.config);
  const platform: Platform | null = config.success ? config.data.platform : platformForProvider(row.connection.provider);
  if (!platform) return errors.badRequest("Unsupported platform");
  return { ...row, platform, config: config.success ? config.data : null };
}

/** Moves the post only if it's still in `from` (no lost races with Inngest). */
async function transition(postId: string, from: string[], set: Partial<typeof posts.$inferInsert>) {
  const [row] = await db
    .update(posts)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(posts.id, postId), inArray(posts.status, from)))
    .returning({ status: posts.status, userId: posts.userId });
  if (row) await invalidate(row.userId, "posts");
  return row ?? null;
}

/**
 * Delete state machine. Not published → cancelled (no platform call);
 * published → deleting + event (or manual for platforms that can't delete);
 * already deleting/deleted/cancelled → no-op.
 */
export async function requestDelete(userId: string, postId: string): Promise<{ result: DeleteResult; event?: PostActionEvent }> {
  const { post, connection, platform } = await loadOwned(userId, postId);
  const capabilities = PLATFORMS[platform].capabilities;
  const plan = planDelete({
    status: post.status,
    platform,
    capabilities,
    connectionScopes: (connection.scopes as string[] | null) ?? null,
  });

  switch (plan.kind) {
    case "noop":
      return { result: { postId, mode: "noop", status: post.status } };
    case "manual":
      return { result: { postId, mode: "manual", status: post.status, deleteNote: plan.deleteNote, postUrl: post.postUrl } };
    case "reconnect_for_delete":
      return errors.conflict("Reconnect Threads and approve deleting posts (threads_delete) first", { reason: "reconnect_for_delete" });
    case "cancel": {
      const moved = await transition(post.id, ["queued", "publishing", "scheduled", "draft", "failed"], { status: "cancelled" });
      if (!moved) return { result: { postId, mode: "noop", status: (await loadOwned(userId, postId)).post.status } };
      return {
        result: { postId, mode: "cancelled", status: "cancelled" },
        // Only in-flight publishes have a run to cancel.
        event: post.status === "failed" ? undefined : { name: "post/publish.cancelled", data: { postId } },
      };
    }
    case "queue": {
      const moved = await transition(post.id, ["published"], { status: "deleting", deleteErrorCode: null, deleteErrorMessage: null });
      if (!moved) return { result: { postId, mode: "noop", status: (await loadOwned(userId, postId)).post.status } };
      return {
        result: { postId, mode: "queued", status: "deleting", deleteNote: capabilities.deleteNote },
        event: { name: "post/delete.requested", data: { postId, userId: post.userId, socialConnectionId: post.socialConnectionId } },
      };
    }
  }
}

export async function requestDeleteBatch(userId: string, batchId: string, socialConnectionIds?: string[]) {
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.userId, UuidSchema.parse(userId)),
        eq(posts.batchId, UuidSchema.parse(batchId)),
        socialConnectionIds?.length ? inArray(posts.socialConnectionId, socialConnectionIds) : undefined,
      ),
    );
  if (rows.length === 0) return errors.notFound("Batch");
  const out: { results: unknown[]; events: PostActionEvent[] } = { results: [], events: [] };
  for (const row of rows) {
    try {
      const { result, event } = await requestDelete(userId, row.id);
      out.results.push(result);
      if (event) out.events.push(event);
    } catch (error) {
      out.results.push({ postId: row.id, mode: "error", code: (error as { code?: string }).code ?? "ERROR", message: (error as Error).message });
    }
  }
  return out as { results: (DeleteResult | { postId: string; mode: "error"; code: string; message: string })[]; events: PostActionEvent[] };
}

/** Validates the edit and queues it (pendingEdit + edit_status=editing). */
export async function requestEdit(userId: string, postId: string, changes: Record<string, unknown>) {
  const { post, platform, config } = await loadOwned(userId, postId);
  if (!config) return errors.badRequest("This post can't be edited");
  const definition = PLATFORMS[platform];
  const plan = planEdit({
    status: post.status,
    externalStatus: post.externalStatus,
    editStatus: post.editStatus,
    capabilities: definition.capabilities,
    schema: definition.schema,
    current: config.input,
    changes,
  });
  if (plan.kind === "noop") return { result: { postId, mode: "noop" as const, editStatus: post.editStatus } };

  const [row] = await db
    .update(posts)
    .set({
      editStatus: "editing",
      editErrorCode: null,
      editErrorMessage: null,
      config: { ...config, pendingEdit: { merged: plan.merged, changed: plan.changed, before: plan.before } },
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, post.id), eq(posts.status, "published")))
    .returning({ id: posts.id });
  if (!row) return errors.conflict("The post changed meanwhile; refresh and try again");
  await invalidate(post.userId, "posts");
  return {
    result: { postId, mode: "queued" as const, editStatus: "editing" },
    event: { name: "post/edit.requested", data: { postId, userId: post.userId, socialConnectionId: post.socialConnectionId } } satisfies PostActionEvent,
  };
}

/**
 * Repost = a new post through publishBatch (same batch). With deleteOriginal
 * the original is deleted only after the new one is published.
 */
export async function requestRepost(userId: string, input: { postId: string; changes?: Record<string, unknown>; deleteOriginal?: boolean }) {
  const { post, config } = await loadOwned(userId, input.postId);
  if (!config) return errors.badRequest("This post can't be reposted");
  const links = await db.select().from(postMedia).where(eq(postMedia.postId, post.id)).orderBy(asc(postMedia.position));
  const media = links.filter((l) => l.role !== "thumbnail").map((l) => l.mediaId);
  const thumbnail = links.find((l) => l.role === "thumbnail")?.mediaId;
  if (media.length === 0) return errors.badRequest("The original media is no longer available");

  const changes = omit(input.changes ?? {}, "thumbnail");
  return publishBatch(
    userId,
    {
      idempotencyKey: `repost-${post.id}-${Date.now()}`,
      mediaType: config.mediaType,
      mediaIds: media,
      ...(thumbnail ? { thumbnailByConnection: { [post.socialConnectionId]: thumbnail } } : {}),
      targets: [{ socialConnectionId: post.socialConnectionId, input: { ...config.input, ...changes } }],
    },
    { batchId: post.batchId ?? undefined, extraConfig: { repostOf: post.id, ...(input.deleteOriginal ? { deleteOriginalAfterPublish: post.id } : {}) } },
  );
}

/** Post detail incl. revisions (History tab). */
export async function getPostDetail(userId: string, postId: string) {
  return cached({
    userId,
    group: "posts",
    key: "getPostDetail",
    input: { postId },
    schema: PostDetailSchema,
    // Never stored mid-publish / mid-delete / mid-edit (the page polls those states).
    cacheable: (detail) => !["queued", "publishing", "deleting"].includes(detail.status) && detail.editStatus !== "editing",
    load: () => loadPostDetail(userId, postId),
  });
}

async function loadPostDetail(userId: string, postId: string) {
  const { post, connection, platform, config } = await loadOwned(userId, postId);
  const capabilities = PLATFORMS[platform].capabilities;
  return {
    id: post.id,
    name: post.name,
    batchId: post.batchId,
    socialConnectionId: post.socialConnectionId,
    platform,
    status: post.status,
    externalStatus: post.externalStatus,
    editStatus: post.editStatus,
    postUrl: post.postUrl,
    caption: post.caption,
    input: config?.input ?? {},
    errorMessage: post.errorMessage,
    deleteErrorCode: post.deleteErrorCode,
    deleteErrorMessage: post.deleteErrorMessage,
    editErrorCode: post.editErrorCode,
    editErrorMessage: post.editErrorMessage,
    publishedAt: post.publishedAt,
    lastEditedAt: post.lastEditedAt,
    deletedAt: post.deletedAt,
    revisions: z.array(RevisionSchema).catch([]).parse(post.revisions ?? []),
    account: { username: connection.username, displayName: connection.displayName, profilePictureUrl: connection.profilePictureUrl },
    capabilities: {
      supportsDelete: capabilities.supportsDelete,
      deleteNote: capabilities.deleteNote,
      supportsEdit: capabilities.supportsEdit,
      editableFields: capabilities.editableFields,
      editNote: capabilities.editNote,
    },
  };
}
