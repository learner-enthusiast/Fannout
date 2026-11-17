import { and, asc, db, eq, inArray, isNull, media, postMedia, posts, socialConnections, sql } from "@repo/database";
import { AppError, errors } from "@repo/errors";
import {
  FacebookProvider,
  InstagramProvider,
  LinkedInProvider,
  ProviderError,
  ThreadsProvider,
  XProvider,
  YouTubeProvider,
} from "@repo/providers";
import { z, ZodError } from "zod";
import { MediaRowSchema, type MediaRow } from "../media/model";
import { cached, invalidate } from "../cache";
import { createProviderForConnection } from "../provider-factory";
import { SocialConnectionRowSchema } from "../social-connections/model";
import { updateSocialConnection } from "../social-connections";
import { PermanentPublishError } from "./errors";
import { youtubeStudioEditUrl, youtubeVideoIdFromUrl } from "@repo/providers/youtube";
import { joinComposeInput, PostConfigSchema, TERMINAL_STATUSES, YouTubeUploadSchema, YouTubeUploadsPageSchema } from "./model";
import { PLATFORMS } from "./platforms";
import { failSchedule, markScheduleMissed } from "../scheduling";
import { mediaIssues } from "./validate";
import { applyImageFormats } from "./formats";
import { recordInstagramContacts, recordMentionsUsed, saveTagContacts } from "../mentions";
import { FacebookPublishError, MISSING_VIDEO_PERMISSION_MESSAGE, facebookPublisher } from "./publishers/facebook";
import { LINKEDIN_MISSING_SHARE_MESSAGE, LinkedInPublishError, linkedinPublisher } from "./publishers/linkedin";
import { INSTAGRAM_NEW_CONTAINER_SUBCODES, INSTAGRAM_VALIDATION, instagramPublisher, instagramSubcode } from "./publishers/instagram";
import { threadsPublisher } from "./publishers/threads";
import type { PublishContext, PublishOutcome, Publisher } from "./publishers/types";
import type { PrepareStep } from "./upload/progress";
import { XWriteScopeError, xPublisher } from "./publishers/x";
import { youtubePublisher } from "./publishers/youtube";

export type ErrorKind = "auth" | "permanent" | "transient";

function providerBody(error: ProviderError): string {
  try {
    return `${error.providerCode ?? ""} ${error.message} ${JSON.stringify(error.details ?? {})}`;
  } catch {
    return `${error.providerCode ?? ""} ${error.message}`;
  }
}

function classifyXError(error: ProviderError): { kind: ErrorKind; code: string; message: string } | null {
  if (error.provider !== "X") return null;
  const body = providerBody(error);
  const detail = typeof (error.details as { detail?: unknown } | undefined)?.detail === "string"
    ? String((error.details as { detail: string }).detail)
    : error.message;
  if (error.status === 400 && /reply.?settings/i.test(body)) {
    return { kind: "permanent", code: "invalid_reply_settings", message: "X rejected the reply audience. Choose Everyone or another supported audience." };
  }
  if (error.status !== 403) return null;
  // Ordered from most specific to least: enrollment, duplicates, grants, then account restrictions.
  if (/client forbidden|required_enrollment|registration_url|project.*enroll|pay-per-use/i.test(body)) {
    return {
      kind: "permanent",
      code: "x_project_enrollment_required",
      message: "Your X app must be attached to a project enrolled in pay-per-use billing. Fix this in console.x.com, then retry.",
    };
  }
  if (/duplicate content|duplicate tweet|already.?live|already posted/i.test(body)) {
    return { kind: "permanent", code: "duplicate_content", message: "X says this content was already posted. Check the account before retrying; this post will not be sent again." };
  }
  if (/missing.*(scope|permission)|scope.*(missing|required)|not authorized.*(post|tweet|media|write)|permission.*(post|tweet|media|write)/i.test(body)) {
    return { kind: "auth", code: "missing_write_scope", message: "Reconnect X to allow posting" };
  }
  if (/restrict|suspend|reply.*not allowed|not allowed.*reply|account.*limit/i.test(body)) {
    return { kind: "permanent", code: "x_account_restricted", message: `X rejected this post: ${detail}` };
  }
  return { kind: "permanent", code: error.code, message: `X rejected this request: ${detail}` };
}

const INSTAGRAM_TRANSIENT = new Set(["2207001", "2207003", "2207027", "2207032", "2207053"]);

/** Instagram (Graph API) error codes and subcodes → existing classes. Anything else falls through to the generic rules. */
function classifyInstagramError(error: ProviderError): { kind: ErrorKind; code: string; message: string } | null {
  if (error.provider !== "INSTAGRAM") return null;
  const sub = instagramSubcode(error);
  if (sub) {
    if (INSTAGRAM_TRANSIENT.has(sub)) return { kind: "transient", code: `instagram_${sub}`, message: error.message };
    if (INSTAGRAM_NEW_CONTAINER_SUBCODES.has(sub)) {
      return { kind: "permanent", code: "instagram_new_container_needed", message: "Instagram needs a fresh media container. Retry the post." };
    }
    if (sub === "2207042") {
      return { kind: "transient", code: "RATE_LIMITED", message: "Instagram's 24-hour publishing limit is reached. Try again later." };
    }
    if (sub === "2207050" || sub === "2207051") {
      return {
        kind: "permanent",
        code: "instagram_account_restricted",
        message: "Instagram restricted this account from posting. Check the Instagram app, then try again later.",
      };
    }
    const validation = INSTAGRAM_VALIDATION[sub];
    if (validation) return { kind: "permanent", code: "VALIDATION", message: validation };
  }
  const body = providerBody(error);
  // Code 190 / OAuthException: the user removed the app or moved the account to another portfolio. Never retried.
  if (/^190\b/.test(error.providerCode ?? "") || /OAuthException|error validating access token/i.test(body)) {
    return { kind: "auth", code: "instagram_token_invalid", message: "Instagram access was removed. Reconnect Instagram and share the account again." };
  }
  // "(#10) … permission" or "account type is not business or creator".
  if (/\(#10\)|does not have permission|not.{0,20}(business|creator)/i.test(body)) {
    return { kind: "auth", code: "instagram_missing_permission", message: "Instagram needs more permissions or a Business/Creator account. Reconnect Instagram." };
  }
  return null;
}

/** Auth → reconnect + fail; permanent (validation, bad request…) → fail; else retry. */
export function classifyPublishError(error: unknown): { kind: ErrorKind; code: string; message: string } {
  const message = (error instanceof Error && error.message ? error.message : "Publishing failed").slice(0, 500);
  if (error instanceof XWriteScopeError) return { kind: "auth", code: error.code, message: error.message };
  if (error instanceof FacebookPublishError) return { kind: "permanent", code: error.code, message: error.message };
  if (error instanceof LinkedInPublishError) return { kind: "permanent", code: error.code, message: error.message };
  if (error instanceof ProviderError) {
    const x = classifyXError(error);
    if (x) return x;
    const instagram = classifyInstagramError(error);
    if (instagram) return instagram;
    // YouTube snippet.tags over its real budget (multi-word tags count +2 for quotes) or with < > ,.
    if (error.provider === "YOUTUBE" && /invalidTags|invalid video keywords/i.test(providerBody(error))) {
      return {
        kind: "permanent",
        code: "youtube_invalid_tags",
        message: "YouTube rejected the tags: at most 500 characters in total (a tag with spaces counts 2 more), no <, > or commas. Shorten the tags and retry.",
      };
    }
    // "(#100) No permission to publish the video" (also #200 publish_video): permission, not a glitch.
    if (error.provider === "FACEBOOK" && /permission to publish the video|publish_video/i.test(error.message)) {
      return { kind: "permanent", code: "missing_video_permission", message: MISSING_VIDEO_PERMISSION_MESSAGE };
    }
    // "Not enough permissions to access: assets.ACTION-registerUpload…" = token lacks w_member_social.
    if (error.provider === "LINKEDIN" && error.code === "FORBIDDEN" && /not enough permissions/i.test(error.message)) {
      return { kind: "permanent", code: "missing_post_permission", message: LINKEDIN_MISSING_SHARE_MESSAGE };
    }
    if (error.code === "UNAUTHORIZED") return { kind: "auth", code: error.code, message };
    if (error.retryable || ["RATE_LIMITED", "NETWORK", "TIMEOUT"].includes(error.code)) {
      return { kind: "transient", code: error.code, message };
    }
    if (error.code === "PROVIDER_ERROR" && (error.status ?? 500) >= 500) return { kind: "transient", code: error.code, message };
    return { kind: "permanent", code: error.code, message };
  }
  if (error instanceof AppError) {
    const details = error.details as { reason?: string } | undefined;
    if (details?.reason === "reconnect_required") return { kind: "auth", code: "RECONNECT_REQUIRED", message };
    return { kind: "permanent", code: error.code, message };
  }
  if (error instanceof ZodError) return { kind: "permanent", code: "VALIDATION", message };
  return { kind: "transient", code: "UNKNOWN", message };
}

export { PermanentPublishError };

async function loadPost(postId: string) {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  return row ?? null;
}

async function saveConfigProgress(postId: string, patch: Record<string, unknown>, step?: string) {
  const row = await loadPost(postId);
  if (!row) return;
  const config = PostConfigSchema.parse(row.config);
  await db
    .update(posts)
    .set({
      config: { ...config, progress: { ...config.progress, ...patch, ...(step ? { step } : {}) } },
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));
}

/**
 * queued/scheduled → publishing. Returns null when the post is already
 * finished or already has a platform id (event replay). A scheduled run only
 * claims when its scheduleVersion is the live, handed_off one — checked in
 * the same UPDATE, so a stale run can't touch a rescheduled post.
 */
export async function claimPost(postId: string, scheduleVersion?: number | null) {
  const [row] = await db
    .update(posts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        inArray(posts.status, scheduleVersion == null ? ["queued", "publishing"] : ["scheduled", "publishing"]),
        isNull(posts.externalPostId),
        scheduleVersion == null
          ? undefined
          : sql`exists (select 1 from scheduled_posts s where s.post_id = ${posts.id} and s.schedule_version = ${scheduleVersion} and s.status = 'handed_off')`,
      ),
    )
    .returning({ id: posts.id, batchId: posts.batchId, userId: posts.userId, socialConnectionId: posts.socialConnectionId });
  if (row) await invalidate(row.userId, "posts");
  return row ?? null;
}

export async function markPostFailed(postId: string, code: string, message: string) {
  const [failed] = await db
    .update(posts)
    .set({ status: "failed", errorCode: code, errorMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(posts.id, postId))
    .returning({ userId: posts.userId });
  if (failed) await invalidate(failed.userId, "posts");
  await saveConfigProgress(postId, {}, "Failed");
  await failSchedule(postId, message);
}

/** Status-page step only (e.g. while sleeping until the scheduled time). */
export async function setPostStep(postId: string, step: string) {
  await saveConfigProgress(postId, {}, step);
}

/** Mirrors toSocialConnectionView: no token → "reconnect required". */
export async function markNeedsReconnect(userId: string, connectionId: string, options: { deactivate?: boolean } = {}) {
  await updateSocialConnection(userId, connectionId, {
    ...(options.deactivate ? { isActive: false } : {}),
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessExpiry: null,
    refreshExpiry: null,
  });
}

async function loadMedia(postId: string): Promise<{ media: MediaRow[]; thumbnail: MediaRow | null }> {
  const rows = await db
    .select({ link: postMedia, row: media })
    .from(postMedia)
    .innerJoin(media, eq(media.id, postMedia.mediaId))
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position));
  // An optional thumbnail that isn't ready by now is skipped (await-media notifies the user).
  const thumb = rows.find((r) => r.link.role === "thumbnail" && r.row.status === "ready");
  return {
    media: rows.filter((r) => r.link.role !== "thumbnail").map((r) => MediaRowSchema.parse(r.row)),
    thumbnail: thumb ? MediaRowSchema.parse(thumb.row) : null,
  };
}

// ---------------------------------------------------------------------------
// await-media: posts can be created while their files still upload.
// ---------------------------------------------------------------------------

export type PostMediaState = {
  /** Every non-thumbnail file is ready. */
  ready: boolean;
  /** A required file failed (name), or null. */
  failed: string | null;
  /** Required files not ready yet. */
  pending: { id: string; name: string; status: string }[];
  /** The optional thumbnail, when the post has one and it isn't ready. */
  thumbnailMissing: { id: string; name: string; status: string } | null;
};

/** Read straight from Postgres (never the cache): the source of truth for await-media. */
export async function postMediaState(postId: string): Promise<PostMediaState> {
  const rows = await db
    .select({ role: postMedia.role, id: media.id, name: media.name, status: media.status })
    .from(postMedia)
    .innerJoin(media, eq(media.id, postMedia.mediaId))
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position));
  const required = rows.filter((r) => r.role !== "thumbnail");
  const thumb = rows.find((r) => r.role === "thumbnail");
  const failed = required.find((r) => r.status === "failed");
  const pending = required.filter((r) => r.status !== "ready" && r.status !== "failed").map(({ id, name, status }) => ({ id, name, status }));
  return {
    ready: !failed && pending.length === 0,
    failed: failed?.name ?? null,
    pending,
    thumbnailMissing: thumb && thumb.status !== "ready" ? { id: thumb.id, name: thumb.name, status: thumb.status } : null,
  };
}

/** Platform media rules again, now that processing knows durations and real types. */
export async function postMediaIssues(postId: string): Promise<string[]> {
  const post = await loadPost(postId);
  if (!post) return [];
  const config = PostConfigSchema.parse(post.config);
  const { media: items } = await loadMedia(post.id);
  return mediaIssues(config.platform, config.mediaType, items, null, false)
    .filter((issue) => issue.field === "media")
    .map((issue) => issue.message);
}

/** A scheduled post whose files weren't ready in the late window: missed (the user can "Publish now"). */
export async function markPostMediaMissed(postId: string, message: string) {
  await markScheduleMissed(postId, message);
  await markPostFailed(postId, "media_not_ready", message);
}

export type PublishPhase = "prepare" | "finalize";

function publisherFor(provider: unknown): { run: (phase: PublishPhase, ctx: PublishContext) => Promise<PublishOutcome | PrepareStep | void> } | null {
  const wrap = <P>(publisher: Publisher<P>, p: P) => ({
    run: (phase: PublishPhase, ctx: PublishContext) => (phase === "prepare" ? publisher.prepare(p, ctx) : publisher.finalize(p, ctx)),
  });
  if (provider instanceof YouTubeProvider) return wrap(youtubePublisher, provider);
  if (provider instanceof XProvider) return wrap(xPublisher, provider);
  if (provider instanceof LinkedInProvider) return wrap(linkedinPublisher, provider);
  if (provider instanceof ThreadsProvider) return wrap(threadsPublisher, provider);
  if (provider instanceof FacebookProvider) return wrap(facebookPublisher, provider);
  if (provider instanceof InstagramProvider) return wrap(instagramPublisher, provider);
  return null;
}

/**
 * Runs one publishing phase with the platform's existing provider.
 * prepare = uploads/processing (nothing public); finalize = make it live and
 * mark the post published. Permanent and auth errors mark the post failed
 * and throw PermanentPublishError (don't retry); anything else is rethrown
 * so Inngest retries — resume data in posts.config.progress keeps retries
 * from re-uploading.
 */
export async function runPublishPhase(postId: string, phase: "prepare", options?: { scheduled?: boolean }): Promise<PrepareStep>;
export async function runPublishPhase(postId: string, phase: "finalize", options?: { scheduled?: boolean }): Promise<PublishOutcome>;
export async function runPublishPhase(postId: string, phase: PublishPhase, options: { scheduled?: boolean } = {}): Promise<PublishOutcome | PrepareStep> {
  const post = await loadPost(postId);
  if (!post) throw new PermanentPublishError("NOT_FOUND", "Post not found");
  const config = PostConfigSchema.parse(post.config);
  const [connectionRow] = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.id, post.socialConnectionId), eq(socialConnections.userId, post.userId)))
    .limit(1);

  try {
    if (!connectionRow) throw new PermanentPublishError("NOT_FOUND", "The account was removed");
    const connection = SocialConnectionRowSchema.parse(connectionRow);
    // A manual post (posts.config.manual) is published by the user, never by this job.
    if (config.manual) throw new PermanentPublishError("MANUAL_POST", "This post is published by hand, not by Fannout");
    // Tags / related video live under config.<platform>; publishers get them back as compose input.
    const input = PLATFORMS[config.platform].schema.parse(joinComposeInput(config)) as Record<string, unknown>;
    const { media: items, thumbnail } = await loadMedia(post.id);
    const ctx: PublishContext = {
      postId: post.id,
      userId: post.userId,
      connection,
      input,
      mediaType: config.mediaType,
      media: items,
      thumbnail,
      progress: config.progress,
      save: async (patch, step) => {
        Object.assign(ctx.progress, patch);
        await saveConfigProgress(post.id, patch, step);
      },
      scheduled: Boolean(options.scheduled),
    };
    const provider = await createProviderForConnection({ userId: post.userId, connectionId: connection.id });
    const publisher = publisherFor(provider);
    if (!publisher) throw new PermanentPublishError("UNSUPPORTED", "This platform can't be published to yet");

    // Images in a format (or size) the platform doesn't take: one conversion per prepare step, before
    // the publisher creates anything; then the publisher gets rows pointing at the converted copies.
    const converting = await applyImageFormats(config.platform, ctx, phase);
    if (converting) return converting;

    if (phase === "prepare") {
      // One unit of work per call (a chunk group or a poll); void = nothing more to prepare.
      const step = (await publisher.run("prepare", ctx)) as PrepareStep | void;
      return step ?? { done: true };
    }
    const outcome = (await publisher.run("finalize", ctx)) as PublishOutcome;

    await db
      .update(posts)
      .set({
        status: "published",
        externalPostId: outcome.externalPostId,
        postUrl: outcome.postUrl,
        publishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    await invalidate(post.userId, "posts");
    await saveConfigProgress(post.id, {}, "Published");
    // Mention counters are ancillary; never turn an already-live post into a failure.
    if (config.platform === "instagram") {
      // Tags, collaborators and caption @mentions all become contacts (+1 use) for the suggestion popover.
      await recordInstagramContacts(post.userId, { tags: config.instagram?.tags ?? [], collaborators: input.collaborators ?? [], caption: input.caption ?? "" }).catch(
        () => undefined,
      );
    } else {
      await recordMentionsUsed(post.userId, config.platform, input).catch(() => undefined);
      // Same for the people tagged on the media: remember new usernames for the tag popover.
      const dropped = (ctx.progress.tagsDropped as string[] | undefined) ?? [];
      const tagged = (config.x?.taggedUsers ?? []).map((tag) => tag.username).filter((username) => !dropped.includes(username));
      await saveTagContacts(post.userId, config.platform, tagged).catch(() => undefined);
    }
    return outcome;
  } catch (error) {
    if (error instanceof PermanentPublishError) {
      await markPostFailed(post.id, error.code, error.message);
      throw error;
    }
    const { kind, code, message } = classifyPublishError(error);
    if (kind === "transient") {
      await saveConfigProgress(post.id, {}, `Retrying: ${message.slice(0, 120)}`);
      throw error;
    }
    // Instagram code 190: the grant is gone for good, so the connection is switched off too.
    if (kind === "auth") await markNeedsReconnect(post.userId, post.socialConnectionId, { deactivate: code === "instagram_token_invalid" });
    await markPostFailed(post.id, code, kind === "auth" ? `Reconnect this account: ${message}` : message);
    throw new PermanentPublishError(code, message);
  }
}

export async function postSummary(postId: string) {
  const row = await loadPost(postId);
  if (!row) return null;
  const config = PostConfigSchema.safeParse(row.config);
  return {
    id: row.id,
    userId: row.userId,
    batchId: row.batchId,
    status: row.status,
    postUrl: row.postUrl,
    errorMessage: row.errorMessage,
    platform: config.success ? config.data.platform : null,
    /** Follow-up task for a published YouTube video (the API can't set a related video). */
    relatedVideo:
      row.status === "published" && row.externalPostId && config.success && config.data.youtube?.relatedVideo?.status === "pending"
        ? {
            title: config.data.youtube.relatedVideo.title,
            studioUrl: youtubeStudioEditUrl(row.externalPostId),
            isShort: Boolean(config.data.progress.isShort),
          }
        : null,
    /** X tags that had to be dropped to get the post out. */
    tagsDropped: config.success ? z.array(z.string()).catch([]).parse(config.data.progress.tagsDropped ?? []) : [],
  };
}

/** Counts for a batch; `finished` once every post is published/failed/cancelled. */
export async function batchProgress(batchId: string) {
  // Manual posts (drafts the user publishes by hand) never hold a batch open.
  const all = await db.select({ status: posts.status, userId: posts.userId }).from(posts).where(eq(posts.batchId, batchId));
  const rows = all.filter((r) => r.status !== "draft");
  const published = rows.filter((r) => r.status === "published").length;
  return {
    userId: rows[0]?.userId ?? null,
    total: rows.length,
    published,
    finished: rows.length > 0 && rows.every((r) => (TERMINAL_STATUSES as readonly string[]).includes(r.status)),
  };
}

export async function queuedPostsInBatch(batchId: string) {
  return db
    .select({ id: posts.id, userId: posts.userId, socialConnectionId: posts.socialConnectionId })
    .from(posts)
    .where(and(eq(posts.batchId, batchId), eq(posts.status, "queued")));
}

// ---------------------------------------------------------------------------
// Read-only lookups for the composer (backend proxies the platform)
// ---------------------------------------------------------------------------

async function youtubeFor(userId: string, connectionId: string) {
  const provider = await createProviderForConnection({ userId, connectionId });
  if (!(provider instanceof YouTubeProvider)) throw new PermanentPublishError("BAD_REQUEST", "Not a YouTube account");
  return provider;
}

const TitledItemsSchema = z.array(z.object({ id: z.string(), title: z.string() }));

/** Group `platform:{connectionId}`: data that lives on YouTube; dropped when the connection changes. */
export async function listYouTubePlaylists(userId: string, connectionId: string) {
  return cached({
    userId,
    group: `platform:${connectionId}`,
    key: "listYouTubePlaylists",
    schema: TitledItemsSchema,
    load: async () => {
      const youtube = await youtubeFor(userId, connectionId);
      const result = await youtube.listPlaylist({ part: ["snippet"], mine: true, maxResults: 50 });
      return (result.items ?? [])
        .filter((item) => item.id)
        .map((item) => ({ id: item.id!, title: item.snippet?.title ?? "Untitled playlist" }));
    },
  });
}

export async function listYouTubeCategories(userId: string, connectionId: string, regionCode = "US") {
  return cached({
    userId,
    group: `platform:${connectionId}`,
    key: "listYouTubeCategories",
    input: { regionCode },
    schema: TitledItemsSchema,
    load: async () => {
      const youtube = await youtubeFor(userId, connectionId);
      const result = await youtube.listVideoCategories({ part: ["snippet"], regionCode });
      return (result.items ?? [])
        .filter((item) => item.id && item.snippet?.assignable)
        .map((item) => ({ id: item.id!, title: item.snippet?.title ?? item.id! }));
    },
  });
}

/** The channel's "uploads" playlist id (channels.list part=contentDetails, mine=true). It never changes, so it is cached. */
async function youtubeUploadsPlaylist(userId: string, connectionId: string) {
  return cached({
    userId,
    group: `platform:${connectionId}`,
    key: "youtubeUploadsPlaylist",
    schema: z.string().min(1),
    load: async () => {
      const youtube = await youtubeFor(userId, connectionId);
      const result = await youtube.listChannels({ part: ["contentDetails"], mine: true });
      const playlistId = result.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) throw new PermanentPublishError("NOT_FOUND", "This YouTube channel has no uploads yet");
      return playlistId;
    },
  });
}

type Thumbnails = { medium?: { url?: string | null } | null; default?: { url?: string | null } | null } | null | undefined;
const thumbnailOf = (thumbnails: Thumbnails) => thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null;

/** The channel's own videos, newest first (playlistItems.list on the uploads playlist); cursor = YouTube's pageToken. */
export async function listYouTubeUploads(userId: string, connectionId: string, input: { cursor?: string | null; limit: number }) {
  return cached({
    userId,
    group: `platform:${connectionId}`,
    key: "listYouTubeUploads",
    input: { cursor: input.cursor ?? null, limit: input.limit },
    schema: YouTubeUploadsPageSchema,
    load: async () => {
      const playlistId = await youtubeUploadsPlaylist(userId, connectionId);
      const youtube = await youtubeFor(userId, connectionId);
      const result = await youtube.listPlaylistItem({
        part: ["snippet", "contentDetails"],
        playlistId,
        maxResults: input.limit,
        ...(input.cursor ? { pageToken: input.cursor } : {}),
      });
      return {
        items: (result.items ?? []).flatMap((item) => {
          const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
          if (!videoId) return [];
          return [
            {
              videoId,
              title: item.snippet?.title ?? "Untitled video",
              thumbnailUrl: thumbnailOf(item.snippet?.thumbnails),
              publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
            },
          ];
        }),
        nextCursor: result.nextPageToken ?? null,
      };
    },
  });
}

/** "Paste a YouTube URL": validates it, extracts the video id and reads the title (videos.list). */
export async function getYouTubeVideoByUrl(userId: string, connectionId: string, url: string) {
  const videoId = youtubeVideoIdFromUrl(url);
  if (!videoId) return errors.badRequest("That isn't a YouTube video link");
  return cached({
    userId,
    group: `platform:${connectionId}`,
    key: "getYouTubeVideo",
    input: { videoId },
    schema: YouTubeUploadSchema,
    load: async () => {
      const youtube = await youtubeFor(userId, connectionId);
      const result = await youtube.listVideo({ part: ["snippet"], id: [videoId] });
      const video = result.items?.[0];
      if (!video) return errors.notFound("YouTube video");
      return {
        videoId,
        title: video.snippet?.title ?? "Untitled video",
        thumbnailUrl: thumbnailOf(video.snippet?.thumbnails),
        publishedAt: video.snippet?.publishedAt ?? null,
      };
    },
  });
}
