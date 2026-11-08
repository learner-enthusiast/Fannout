import type { LinkedInProvider } from "@repo/providers";
import type { LinkedInComposeInput } from "@repo/providers/linkedin";
import { ProviderError } from "@repo/providers";
import { logger } from "@repo/logger";
import { LINKEDIN_SINGLE_UPLOAD_MAX_BYTES } from "@repo/providers/linkedin";
import { env } from "../../env";
import { PermanentPublishError } from "../errors";
import { readRange } from "../upload/chunk-reader";
import { UPLOAD_CONFIG, pollDelaySeconds } from "../upload/config";
import {
  elapsedSince,
  ensureUploadProgress,
  failUpload,
  logUploadEvent,
  readUploadProgress,
  restartUploadSession,
  saveUploadProgress,
  type PrepareStep,
  type UploadProgress,
} from "../upload/progress";
import { streamSource } from "./media-source";
import type { PublishContext, Publisher } from "./types";

const postUrl = (urn: string) => `https://www.linkedin.com/feed/update/${urn}`;

/**
 * Member post. Default: Share on LinkedIn (UGC, w_member_social) —
 * registerUpload → upload → wait AVAILABLE → /v2/ugcPosts. Asset URNs are
 * saved as they finish so retries never re-upload.
 * LINKEDIN_USE_COMMUNITY_API=true keeps the Community Management (/rest) flow.
 */
export const LINKEDIN_MISSING_SHARE_MESSAGE =
  "LinkedIn didn't grant posting. Reconnect LinkedIn and approve sharing on your behalf.";

/** Raised before calling LinkedIn when the connection can't post. Not retried. */
export class LinkedInPublishError extends Error {
  readonly code = "missing_post_permission";
  constructor() {
    super(LINKEDIN_MISSING_SHARE_MESSAGE);
  }
}

function assertCanPost(ctx: PublishContext) {
  // Connections made before w_member_social was requested can't post: fail before uploading.
  if (!env.LINKEDIN_USE_COMMUNITY_API && ctx.connection.scopes && !ctx.connection.scopes.includes("w_member_social")) {
    throw new LinkedInPublishError();
  }
}

/**
 * prepare: register + upload every asset and wait until AVAILABLE (UGC), or
 * upload video/images (Community API). finalize: create the post.
 */
export const linkedinPublisher: Publisher<LinkedInProvider> = {
  async prepare(provider, ctx): Promise<PrepareStep | void> {
    if (ctx.progress.externalPostId) return;
    assertCanPost(ctx);
    if (env.LINKEDIN_USE_COMMUNITY_API) await uploadCommunity(provider, ctx);
    else if (ctx.mediaType === "video" && !ctx.progress.assetsReady) return videoStep(provider, ctx);
    else await uploadUgc(provider, ctx);
  },
  async finalize(provider, ctx) {
    const existing = ctx.progress.externalPostId as string | undefined;
    if (existing) return { externalPostId: existing, postUrl: postUrl(existing) };
    assertCanPost(ctx);
    const created = await createOnce(ctx, () => (env.LINKEDIN_USE_COMMUNITY_API ? postCommunity(provider, ctx) : postUgc(provider, ctx)));
    await ctx.save({ externalPostId: created.id }, "Posted");
    if (readUploadProgress(ctx, "linkedin")) await saveUploadProgress(ctx, "linkedin", { phase: "posted" });
    return { externalPostId: created.id, postUrl: postUrl(created.id) };
  },
};

async function uploadUgc(provider: LinkedInProvider, ctx: PublishContext) {
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const kind = ctx.mediaType === "video" ? "video" : "image";
  const assets = [...((ctx.progress.assetUrns as string[] | undefined) ?? [])];

  for (const [index, item] of ctx.media.entries()) {
    if (assets[index]) continue;
    await ctx.save({}, `Uploading ${kind} ${ctx.media.length > 1 ? `${index + 1} of ${ctx.media.length} ` : ""}to LinkedIn`);
    assets[index] = (await provider.uploadUgcAsset({ owner: author, kind, source: await streamSource(item) })).asset;
    await ctx.save({ assetUrns: assets });
  }

  if (!ctx.progress.assetsReady) {
    await ctx.save({}, "Waiting for LinkedIn to process the media");
    for (const asset of assets) await provider.waitForAsset(asset);
    await ctx.save({ assetsReady: true });
  }
  return assets;
}

async function postUgc(provider: LinkedInProvider, ctx: PublishContext) {
  const input = ctx.input as LinkedInComposeInput;
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const kind = ctx.mediaType === "video" ? "video" : "image";
  const assets = kind === "video" ? readyVideoAsset(ctx) : await uploadUgc(provider, ctx);
  await ctx.save({}, "Creating post");
  return provider.createUgcPost({
    author,
    commentary: input.commentary ?? "",
    visibility: input.visibility,
    mediaCategory: kind === "video" ? "VIDEO" : "IMAGE",
    media: assets.map((asset) => ({ asset, ...(kind === "video" && input.videoTitle ? { title: input.videoTitle } : {}) })),
  });
}

/** Community Management API (/rest/videos, /rest/images, /rest/posts). Behind LINKEDIN_USE_COMMUNITY_API. */
async function uploadCommunity(provider: LinkedInProvider, ctx: PublishContext): Promise<{ video?: string; images: string[] }> {
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  if (ctx.mediaType === "video") {
    let video = ctx.progress.videoUrn as string | undefined;
    if (!video) {
      await ctx.save({}, "Uploading video to LinkedIn");
      const uploaded = await provider.uploadVideo({
        owner: author,
        source: await streamSource(ctx.media[0]!),
        ...(ctx.thumbnail ? { thumbnail: await streamSource(ctx.thumbnail) } : {}),
      });
      video = uploaded.video;
      await ctx.save({ videoUrn: video }, "Video uploaded");
    }
    return { video, images: [] };
  }

  const images = [...((ctx.progress.imageUrns as string[] | undefined) ?? [])];
  for (const [index, item] of ctx.media.entries()) {
    if (images[index]) continue;
    await ctx.save({}, `Uploading image ${index + 1} of ${ctx.media.length} to LinkedIn`);
    images[index] = (await provider.uploadImage({ owner: author, source: await streamSource(item) })).image;
    await ctx.save({ imageUrns: images });
  }
  return { images };
}

async function postCommunity(provider: LinkedInProvider, ctx: PublishContext) {
  const input = ctx.input as LinkedInComposeInput;
  const author = `urn:li:person:${ctx.connection.providerAccountId}`;
  const common = {
    author,
    commentary: input.commentary ?? "",
    visibility: input.visibility,
    distribution: { feedDistribution: "MAIN_FEED" as const },
    ...(input.isReshareDisabledByAuthor ? { isReshareDisabledByAuthor: true } : {}),
  };
  const { video, images } = await uploadCommunity(provider, ctx);
  await ctx.save({}, "Creating post");
  if (video) {
    return provider.createVideoPost({ ...common, video: { id: video, ...(input.videoTitle ? { title: input.videoTitle } : {}) } });
  }
  return images.length === 1
    ? provider.createImagePost({ ...common, image: { id: images[0]! } })
    : provider.createMultiImagePost({ ...common, multiImage: { images: images.map((id) => ({ id })) } });
}

// ---------------------------------------------------------------------------
// Large video (v2 assets, multipart): one Inngest step per call
// ---------------------------------------------------------------------------

/** Asset URN of a video that prepare finished (legacy progress: assetUrns + assetsReady). */
function readyVideoAsset(ctx: PublishContext): string[] {
  const progress = readUploadProgress(ctx, "linkedin");
  if (progress?.phase === "ready" || progress?.phase === "posted") return [progress.sessionRef!];
  const legacy = ctx.progress.assetUrns as string[] | undefined;
  if (legacy?.length && ctx.progress.assetsReady) return legacy;
  throw new Error("LinkedIn video upload hasn't finished yet");
}

async function videoStep(provider: LinkedInProvider, ctx: PublishContext): Promise<PrepareStep> {
  let progress = await ensureUploadProgress(ctx, "linkedin", ctx.media[0]!);
  if (progress.phase === "init") progress = await register(provider, ctx, progress);
  if (progress.phase === "uploading") return uploadParts(provider, ctx, progress);
  if (progress.phase === "processing") return pollAsset(provider, ctx, progress);
  return { done: true };
}

async function register(provider: LinkedInProvider, ctx: PublishContext, progress: UploadProgress): Promise<UploadProgress> {
  await ctx.save({}, "Uploading video to LinkedIn");
  // < 190 MB → SINGLE_REQUEST_UPLOAD (one PUT); ≥ 190 MB → MULTIPART_UPLOAD + fileSize (LinkedIn's single limit is 200 MB).
  const registered = await provider.registerVideoUpload({
    owner: `urn:li:person:${ctx.connection.providerAccountId}`,
    fileSize: progress.totalBytes,
    mechanism: progress.totalBytes < LINKEDIN_SINGLE_UPLOAD_MAX_BYTES ? "SINGLE_REQUEST_UPLOAD" : "MULTIPART_UPLOAD",
  });
  // Whichever shape LinkedIn returns is what we follow.
  const uploadUrls =
    registered.upload.kind === "multipart"
      ? registered.upload.parts
      : [{ partNumber: 1, url: registered.upload.url, start: 0, end: progress.totalBytes - 1, headers: registered.upload.headers, urlExpiresAt: null }];
  if (registered.upload.kind === "multipart" && !registered.mediaArtifact) {
    return failUpload(ctx, "linkedin", "INVALID_RESPONSE", "LinkedIn didn't return the data needed to finish the upload.");
  }
  // Saved immediately: retries reuse this asset and its part URLs.
  const saved = await saveUploadProgress(ctx, "linkedin", {
    sessionRef: registered.asset,
    sessionCreatedAt: new Date().toISOString(),
    uploadKind: registered.upload.kind,
    uploadUrls,
    mediaArtifact: registered.mediaArtifact,
    uploadMetadata: registered.upload.kind === "multipart" ? registered.upload.metadata : null,
    partEtags: [],
    phase: "uploading",
  });
  // Keep the legacy key in sync so finalize/older readers find the asset.
  await ctx.save({ assetUrns: [registered.asset] });
  logUploadEvent(ctx, "linkedin", "asset_registered", { kind: registered.upload.kind, parts: uploadUrls.length });
  return saved;
}

/** Expired part URL / unknown upload: LinkedIn answers 403/404/410 → one re-registration. */
const isLostUpload = (error: unknown) => error instanceof ProviderError && [403, 404, 410].includes(error.status ?? 0);

/** Part URLs carry urlExpiresAt; don't PUT to one that is (nearly) expired. */
const URL_EXPIRY_MARGIN_MS = 5 * 60_000;
/**
 * One part per step up to this many parts (~3.3 GB at LinkedIn's 4 MiB parts).
 * Beyond it, a fixed number of consecutive parts share a step so a 5 GB video
 * (~1 250 parts) stays under Inngest's 1 000-steps-per-run limit.
 */
const MAX_PART_STEPS = 800;

/**
 * One part per call (= one Inngest step "linkedin-part-N"): ranged S3 read of
 * LinkedIn's byteRange → PUT without Authorization → save the ETag. Parts that
 * already have an ETag are skipped, so a retry resumes at the failed part.
 */
async function uploadParts(provider: LinkedInProvider, ctx: PublishContext, start: UploadProgress): Promise<PrepareStep> {
  let progress = start;
  const parts = progress.uploadUrls ?? [];
  const partsPerStep = Math.max(1, Math.ceil(parts.length / MAX_PART_STEPS));
  const pending = () => parts.filter((p) => !progress.partEtags.some((done) => done.partNumber === p.partNumber));
  const batch = pending().slice(0, partsPerStep);
  for (const part of batch) {
    if (part.urlExpiresAt && part.urlExpiresAt - URL_EXPIRY_MARGIN_MS < Date.now()) {
      progress = await restartUploadSession(ctx, progress, "linkedin_upload_url_expired");
      return { done: false, next: `linkedin-register-${progress.attemptsNewSession}` };
    }
    await ctx.save({}, parts.length > 1 ? `Uploading video to LinkedIn (part ${part.partNumber} of ${parts.length})` : "Uploading video to LinkedIn");
    const data = await readRange(ctx.media[0]!, part.start, part.end);
    let etag: string | null;
    try {
      const timeout = progress.uploadKind === "single" ? UPLOAD_CONFIG.SINGLE_PUT_TIMEOUT_MS : UPLOAD_CONFIG.CHUNK_TIMEOUT_MS;
      etag = await provider.uploadVideoBytes(part.url, data, part.headers, timeout);
    } catch (error) {
      if (!isLostUpload(error)) throw error; // transient → the step retries this same part
      progress = await restartUploadSession(ctx, progress, "linkedin_upload_url_rejected");
      return { done: false, next: `linkedin-register-${progress.attemptsNewSession}` };
    }
    if (progress.uploadKind === "multipart" && !etag) throw new Error("LinkedIn returned no ETag for an uploaded part");
    const partEtags = [...progress.partEtags, { partNumber: part.partNumber, etag: etag ?? "" }].sort((a, b) => a.partNumber - b.partNumber);
    progress = await saveUploadProgress(ctx, "linkedin", { partEtags });
  }
  const next = pending()[0];
  if (next) return { done: false, next: `linkedin-part-${next.partNumber}` };

  if (progress.uploadKind === "multipart") {
    await provider.completeMultiPartUpload({
      mediaArtifact: progress.mediaArtifact!,
      metadata: progress.uploadMetadata ?? "",
      etags: progress.partEtags.map((p) => p.etag),
    });
  }
  await saveUploadProgress(ctx, "linkedin", {
    externalVideoId: progress.sessionRef,
    phase: "processing",
    processingStartedAt: new Date().toISOString(),
    pollCount: 0,
  });
  await ctx.save({}, "Waiting for LinkedIn to process the video");
  logUploadEvent(ctx, "linkedin", "upload_complete", { parts: parts.length });
  return { done: false, next: "linkedin-processing-0", waitSeconds: pollDelaySeconds(0) };
}

async function pollAsset(provider: LinkedInProvider, ctx: PublishContext, progress: UploadProgress): Promise<PrepareStep> {
  let asset;
  try {
    asset = await provider.getAsset(progress.sessionRef!);
  } catch (error) {
    if (!(error instanceof ProviderError && error.status === 404)) throw error;
    const restarted = await restartUploadSession(ctx, progress, "linkedin_asset_unknown");
    return { done: false, next: `linkedin-register-${restarted.attemptsNewSession}` };
  }
  const statuses = asset.recipes.map((r) => r.status);
  if (statuses.length > 0 && statuses.every((s) => s === "AVAILABLE")) {
    await saveUploadProgress(ctx, "linkedin", { phase: "ready" });
    await ctx.save({ assetsReady: true });
    logUploadEvent(ctx, "linkedin", "processing_done", { polls: progress.pollCount });
    return { done: true };
  }
  const failed = statuses.find((s) => ["CLIENT_ERROR", "PROCESSING_FAILED", "SERVER_ERROR", "INCOMPLETE", "FAILED"].includes(s));
  if (failed) return failUpload(ctx, "linkedin", "linkedin_processing_failed", `LinkedIn couldn't process the video (${failed}).`);
  if (elapsedSince(progress.processingStartedAt) > UPLOAD_CONFIG.PROCESSING_CAP_MS.linkedin) {
    return failUpload(ctx, "linkedin", "linkedin_processing_timeout", "LinkedIn took too long to process the video. Try again later.");
  }
  const pollCount = progress.pollCount + 1;
  await saveUploadProgress(ctx, "linkedin", { pollCount });
  return { done: false, next: `linkedin-processing-${pollCount}`, waitSeconds: pollDelaySeconds(pollCount) };
}

/**
 * Create the post at most once per known attempt. A definite rejection (4xx)
 * doesn't count; an unknown outcome (timeout, dropped connection, 5xx) does.
 * The v2 API can't list the member's shares with w_member_social, so after an
 * unknown outcome we retry once (logged as a possible duplicate), then stop.
 */
async function createOnce<T>(ctx: PublishContext, create: () => Promise<T>): Promise<T> {
  const attempts = Number(ctx.progress.createAttempts ?? 0);
  if (attempts >= 2) {
    throw new PermanentPublishError("possible_duplicate", "LinkedIn didn't confirm the post twice. Check your profile before retrying.");
  }
  if (attempts === 1) logger.warn("publish.linkedin.possible_duplicate", { postId: ctx.postId });
  await ctx.save({ createAttempts: attempts + 1 });
  try {
    return await create();
  } catch (error) {
    const definite = error instanceof ProviderError && error.status !== null && error.status < 500;
    if (definite) await ctx.save({ createAttempts: attempts });
    throw error;
  }
}
