import { and, db, eq, media, posts } from "@repo/database";
import {
  FacebookProvider,
  LinkedInProvider,
  ProviderError,
  ThreadsProvider,
  XProvider,
  YouTubeProvider,
  type AnySocialProvider,
} from "@repo/providers";
import { invalidate } from "../cache";
import { env } from "../env";
import { omit } from "../lib/omit";
import { MediaRowSchema } from "../media/model";
import { createProviderForConnection } from "../provider-factory";
import { PostConfigSchema } from "../publishing/model";
import { PLATFORMS, type Platform } from "../publishing/platforms";
import { streamSource } from "../publishing/publishers/media-source";
import { classifyPublishError, markNeedsReconnect } from "../publishing/run";
import { MAX_REVISIONS, RevisionSchema } from "./model";
import { buildYouTubeUpdate } from "./plan";

/** Injectable for tests (defaults to the real provider factory). */
export type ActionDeps = { createProvider?: (input: { userId: string; connectionId: string }) => Promise<AnySocialProvider> };

/** Already recorded on the post; stop without retrying. */
export class PermanentActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The platform says the post doesn't exist (already deleted counts as success for deletes). */
export function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.code === "NOT_FOUND" || error.status === 404) return true;
  return /does not exist|videoNotFound|not found|Unsupported delete request|Object with ID .* does not exist/i.test(error.message);
}

const isPagePostId = (id: string) => /^\d+_\d+$/.test(id);

async function load(postId: string) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new PermanentActionError("not_found", "Post not found");
  const config = PostConfigSchema.parse(post.config);
  return { post, config, platform: config.platform as Platform };
}

async function deleteOnPlatform(provider: AnySocialProvider, externalId: string) {
  if (provider instanceof YouTubeProvider) return provider.deleteVideo({ id: externalId });
  if (provider instanceof XProvider) return provider.deletePost(externalId);
  if (provider instanceof ThreadsProvider) return provider.deletePost(externalId);
  if (provider instanceof FacebookProvider) return isPagePostId(externalId) ? provider.deletePost(externalId) : provider.deleteVideo(externalId);
  if (provider instanceof LinkedInProvider) {
    return env.LINKEDIN_USE_COMMUNITY_API ? provider.deletePost(externalId) : provider.deleteUgcPost(externalId);
  }
  throw new PermanentActionError("unsupported", "This platform can't delete posts");
}

export async function markDeleteFailed(postId: string, code: string, message: string) {
  // Back to published: the post is still live on the platform.
  const [row] = await db
    .update(posts)
    .set({ status: "published", deleteErrorCode: code, deleteErrorMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(posts.id, postId), eq(posts.status, "deleting")))
    .returning({ userId: posts.userId });
  if (row) await invalidate(row.userId, "posts");
}

/**
 * Deletes a published post on its platform. Idempotent: exits unless the
 * post is `deleting`; not-found counts as deleted. Library media is never touched.
 */
export async function runDeletePost(postId: string, deps: ActionDeps = {}): Promise<{ outcome: "deleted" | "skipped" }> {
  const { post } = await load(postId);
  if (post.status !== "deleting") return { outcome: "skipped" };

  if (post.externalPostId) {
    try {
      const provider = await (deps.createProvider ?? createProviderForConnection)({ userId: post.userId, connectionId: post.socialConnectionId });
      await deleteOnPlatform(provider, post.externalPostId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        if (error instanceof PermanentActionError) {
          await markDeleteFailed(post.id, error.code, error.message);
          throw error;
        }
        const { kind, code, message } = classifyPublishError(error);
        if (kind === "auth" || (error instanceof ProviderError && error.code === "FORBIDDEN")) {
          await markNeedsReconnect(post.userId, post.socialConnectionId);
          await markDeleteFailed(post.id, "reconnect_required", `Reconnect this account to delete: ${message}`);
          throw new PermanentActionError("reconnect_required", message);
        }
        if (kind === "permanent") {
          await markDeleteFailed(post.id, code, message);
          throw new PermanentActionError(code, message);
        }
        throw error; // transient → Inngest retries
      }
    }
  }

  await db
    .update(posts)
    .set({
      status: "deleted",
      deletedAt: new Date(),
      deletedBy: "app",
      externalStatus: "deleted_externally",
      deleteErrorCode: null,
      deleteErrorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, post.id), eq(posts.status, "deleting")));
  await invalidate(post.userId, "posts");
  return { outcome: "deleted" };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

type PendingEdit = { merged: Record<string, unknown>; changed: Record<string, unknown>; before: Record<string, unknown> };

export async function markEditFailed(postId: string, code: string, message: string, extra: Partial<typeof posts.$inferInsert> = {}) {
  // pendingEdit stays in config for Retry; the live values are untouched.
  const [row] = await db
    .update(posts)
    .set({ editStatus: "failed", editErrorCode: code, editErrorMessage: message.slice(0, 500), ...extra, updatedAt: new Date() })
    .where(eq(posts.id, postId))
    .returning({ userId: posts.userId });
  // Also covers "found externally deleted" (extra.externalStatus).
  if (row) await invalidate(row.userId, "posts");
}

async function editYouTube(provider: YouTubeProvider, videoId: string, edit: PendingEdit, userId: string) {
  const live = await provider.listVideo({ part: ["snippet", "status"], id: [videoId] });
  const item = live.items?.[0];
  if (!item) throw new ProviderError({ provider: "YOUTUBE", code: "NOT_FOUND", message: "Video not found", status: 404 });
  const m = edit.merged as { title: string; description?: string; tags?: string[]; categoryId?: string; privacyStatus: string; madeForKids: boolean; playlistId?: string };
  const touchesVideo = ["title", "description", "tags", "categoryId", "privacyStatus", "madeForKids"].some((f) => f in edit.changed);
  if (touchesVideo) {
    await provider.updateVideo({
      part: ["snippet", "status"],
      requestBody: buildYouTubeUpdate(videoId, { snippet: item.snippet as Record<string, unknown>, status: item.status as Record<string, unknown> }, m),
    });
  }
  if ("playlistId" in edit.changed) {
    const old = edit.before.playlistId as string | null | undefined;
    if (old) {
      const items = await provider.listPlaylistItem({ part: ["id"], playlistId: old, videoId, maxResults: 50 });
      for (const entry of items.items ?? []) if (entry.id) await provider.deletePlaylistItem({ id: entry.id });
    }
    if (m.playlistId) {
      await provider.insertPlaylistItem({
        part: ["snippet"],
        requestBody: { snippet: { playlistId: m.playlistId, resourceId: { kind: "youtube#video", videoId } } },
      });
    }
  }
  if (typeof edit.changed.thumbnail === "string") {
    const [row] = await db.select().from(media).where(and(eq(media.id, edit.changed.thumbnail), eq(media.userId, userId))).limit(1);
    const image = row ? MediaRowSchema.parse(row) : null;
    if (!image || image.type !== "image" || image.status !== "ready") throw new PermanentActionError("invalid_thumbnail", "The thumbnail must be one of your ready images");
    await provider.setThumbnail({ videoId, media: await streamSource(image) });
  }
}

async function editOnPlatform(provider: AnySocialProvider, externalId: string, edit: PendingEdit, userId: string) {
  if (provider instanceof YouTubeProvider) return editYouTube(provider, externalId, edit, userId);
  if (provider instanceof FacebookProvider) {
    const message = String(edit.merged.message ?? "");
    return isPagePostId(externalId) ? provider.updatePost({ postId: externalId, message }) : provider.updateVideoDescription(externalId, message);
  }
  if (provider instanceof LinkedInProvider && env.LINKEDIN_USE_COMMUNITY_API) {
    return provider.updatePost({ postUrn: externalId, commentary: String(edit.merged.commentary ?? "") });
  }
  throw new PermanentActionError("unsupported", "This platform can't edit published posts");
}

/**
 * Applies config.pendingEdit on the platform. Success → DB updated + revision;
 * any failure → DB keeps the live values (pendingEdit kept for Retry).
 */
export async function runEditPost(postId: string, deps: ActionDeps = {}): Promise<{ outcome: "edited" | "skipped" }> {
  const { post, config, platform } = await load(postId);
  const edit = (config as Record<string, unknown>).pendingEdit as PendingEdit | undefined;
  if (post.editStatus !== "editing" || !edit || !post.externalPostId) return { outcome: "skipped" };

  try {
    const provider = await (deps.createProvider ?? createProviderForConnection)({ userId: post.userId, connectionId: post.socialConnectionId });
    await editOnPlatform(provider, post.externalPostId, edit, post.userId);
  } catch (error) {
    if (error instanceof PermanentActionError) {
      await markEditFailed(post.id, error.code, error.message);
      throw error;
    }
    if (isNotFoundError(error)) {
      await markEditFailed(post.id, "not_found", "The post no longer exists on the platform", { externalStatus: "deleted_externally" });
      throw new PermanentActionError("not_found", "The post no longer exists on the platform");
    }
    const { kind, code, message } = classifyPublishError(error);
    if (kind === "auth" || (error instanceof ProviderError && error.code === "FORBIDDEN")) {
      await markNeedsReconnect(post.userId, post.socialConnectionId);
      await markEditFailed(post.id, "reconnect_required", `Reconnect this account to edit: ${message}`);
      throw new PermanentActionError("reconnect_required", message);
    }
    if (kind === "permanent") {
      await markEditFailed(post.id, code, message);
      throw new PermanentActionError(code, message);
    }
    throw error;
  }

  const input = omit(edit.merged, "thumbnail");
  const rest = omit(config as Record<string, unknown>, "pendingEdit");
  const captionField = PLATFORMS[platform].captionField;
  const revisions = [
    ...RevisionSchema.array().catch([]).parse(post.revisions ?? []),
    { at: new Date().toISOString(), before: edit.before, after: edit.changed, by: "user" },
  ].slice(-MAX_REVISIONS);
  await db
    .update(posts)
    .set({
      config: { ...rest, input },
      caption: typeof input[captionField] === "string" ? (input[captionField] as string) : post.caption,
      revisions,
      editStatus: null,
      editErrorCode: null,
      editErrorMessage: null,
      lastEditedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, post.id));
  await invalidate(post.userId, "posts");
  return { outcome: "edited" };
}

/** Basic facts for notifications. */
export async function postActionSummary(postId: string) {
  const { post, platform } = await load(postId);
  return {
    userId: post.userId,
    batchId: post.batchId,
    name: post.name,
    label: PLATFORMS[platform].label,
    status: post.status,
    editStatus: post.editStatus,
    deleteErrorMessage: post.deleteErrorMessage,
    editErrorMessage: post.editErrorMessage,
    deleteOriginalAfterPublish: ((post.config ?? {}) as { deleteOriginalAfterPublish?: string }).deleteOriginalAfterPublish ?? null,
  };
}
