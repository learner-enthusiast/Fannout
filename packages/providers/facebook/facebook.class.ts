import type { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { HttpClient, type HttpRequest, type QueryValue } from "../common/http-client";
import { createRangeReader, readAll, toBlob } from "../common/media";
import {
  appSecretProof,
  GraphIdSchema,
  graphListSchema,
  GraphSuccessSchema,
  parseGraphError,
  toGraphForm,
  toGraphPage,
  type GraphId,
} from "../common/meta-graph";
import type { Page } from "../common/pagination";
import { ProviderError } from "../common/provider-error";
import type { BaseProviderConfig, ProviderAccount } from "../common/provider.types";
import { verifyMetaWebhookSignature, verifyMetaWebhookSubscription } from "../common/webhooks";
import { FACEBOOK_DEFAULT_GRAPH_VERSION, FACEBOOK_GRAPH_BASE_URL, FACEBOOK_GRAPH_VIDEO_BASE_URL } from "./constants";
import { FacebookEndpoints as E } from "./endpoints";
import {
  CreateCommentInputSchema,
  CreatePostInputSchema,
  FacebookCommentListSchema,
  FacebookCommentSchema,
  FacebookInsightsResponseSchema,
  FacebookPageSchema,
  FacebookPhotoSchema,
  FacebookPostListSchema,
  FacebookPostSchema,
  FacebookReactionListSchema,
  FacebookVideoStatusSchema,
  FinishReelInputSchema,
  FinishReelResponseSchema,
  FinishVideoUploadInputSchema,
  GetCommentInputSchema,
  GetPageInputSchema,
  GetPageInsightsInputSchema,
  GetPostInputSchema,
  GetPostInsightsInputSchema,
  GraphNodeIdSchema,
  ListCommentsInputSchema,
  ListFeedInputSchema,
  ListPhotosInputSchema,
  ListReactionsInputSchema,
  PagePostIdSchema,
  PageWebhookPayloadSchema,
  PublishReelInputSchema,
  StartReelUploadResponseSchema,
  StartVideoUploadInputSchema,
  StartVideoUploadResponseSchema,
  SubscribeAppInputSchema,
  SubscribedAppsResponseSchema,
  TransferVideoChunkInputSchema,
  TransferVideoChunkResponseSchema,
  UpdateCommentInputSchema,
  UpdatePostInputSchema,
  UploadPhotoInputSchema,
  UploadPhotoResponseSchema,
  UploadReelInputSchema,
  UploadVideoInputSchema,
  UploadVideoResponseSchema,
  type CreateCommentInput,
  type CreatePostInput,
  type FacebookComment,
  type FacebookInsight,
  type FacebookPage,
  type FacebookPhoto,
  type FacebookPost,
  type FacebookReaction,
  type FacebookVideoStatus,
  type FinishReelInput,
  type FinishReelResponse,
  type FinishVideoUploadInput,
  type GetCommentInput,
  type GetPageInput,
  type GetPageInsightsInput,
  type GetPostInput,
  type GetPostInsightsInput,
  type ListCommentsInput,
  type ListFeedInput,
  type ListPhotosInput,
  type ListReactionsInput,
  type PageWebhookPayload,
  type PublishReelInput,
  type StartReelUploadResponse,
  type StartVideoUploadResponse,
  type SubscribeAppInput,
  type SubscribedApp,
  type TransferVideoChunkInput,
  type UpdateCommentInput,
  type UpdatePostInput,
  type UploadPhotoInput,
  type UploadPhotoResponse,
  type UploadReelInput,
  type UploadVideoInput,
  type UploadVideoResponse,
} from "./model";

export interface FacebookProviderConfig extends BaseProviderConfig {
  /** The selected Page (provider_account_id). `accessToken` must be that Page's access token. */
  pageId: string;
  /** App secret: when set, every call sends appsecret_proof (required if the app enforces it). */
  appSecret?: string;
  /** Graph API version, e.g. "v23.0". */
  version?: string;
  baseUrl?: string;
  videoBaseUrl?: string;
}

type CommentPage = Page<FacebookComment> & { summary?: { order?: string; total_count?: number } };
type ReactionPage = Page<FacebookReaction> & { summary?: { total_count?: number; viewer_reaction?: string } };

const DEFAULT_PAGE_FIELDS = ["id", "name", "username", "picture{url}", "fan_count", "followers_count"];

/**
 * Facebook Pages via the Graph API. Direct HTTP: Meta's Business SDK targets
 * the Marketing API, configures auth through a process-wide singleton
 * (unsafe with per-Page tokens), ships no TypeScript types and has no Reels
 * or chunked-upload helpers — see docs/providers/sdk-comparison.md.
 * Personal-profile publishing is not available in the Graph API and is not implemented.
 */
export class FacebookProvider extends BaseProvider<FacebookProviderConfig> {
  readonly name = "FACEBOOK" as const;
  readonly pageId: string;
  readonly version: string;
  private readonly http: HttpClient;
  private readonly videoHttp: HttpClient;

  constructor(config: FacebookProviderConfig) {
    super(config);
    this.pageId = this.validate(GraphNodeIdSchema, config.pageId, "constructor.pageId");
    this.version = config.version ?? FACEBOOK_DEFAULT_GRAPH_VERSION;
    const authorize = (token: string) => ({
      query: { access_token: token, ...(config.appSecret ? { appsecret_proof: appSecretProof(token, config.appSecret) } : {}) },
    });
    const common = {
      provider: "FACEBOOK" as const,
      tokens: this.tokens,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      sleep: config.sleep,
      authorize,
      parseError: parseGraphError,
    };
    this.http = new HttpClient({ ...common, baseUrl: `${(config.baseUrl ?? FACEBOOK_GRAPH_BASE_URL).replace(/\/$/, "")}/${this.version}` });
    this.videoHttp = new HttpClient({
      ...common,
      baseUrl: `${(config.videoBaseUrl ?? FACEBOOK_GRAPH_VIDEO_BASE_URL).replace(/\/$/, "")}/${this.version}`,
    });
  }

  // ---------- helpers ----------

  private async get<S extends z.ZodType>(url: string, query: Record<string, QueryValue>, schema: S): Promise<z.output<S>> {
    return (await this.http.json({ method: "GET", url, query }, schema)).data;
  }

  private async post<S extends z.ZodType>(url: string, form: Record<string, unknown>, schema: S, client = this.http): Promise<z.output<S>> {
    const req: HttpRequest = { method: "POST", url, body: { kind: "form", value: toGraphForm(form) } };
    return (await client.json(req, schema)).data;
  }

  private async del(url: string): Promise<boolean> {
    return (await this.http.json({ method: "DELETE", url }, GraphSuccessSchema)).data.success;
  }

  private multipart(fields: Record<string, unknown>, file: { name: string; data: Uint8Array; mimeType: string; filename?: string }) {
    const form = new FormData();
    for (const [key, value] of Object.entries(toGraphForm(fields))) if (value !== undefined) form.set(key, String(value));
    form.set(file.name, toBlob(file.data, file.mimeType), file.filename ?? "upload");
    return form;
  }

  // ================= page =================

  /** GET /{page-id}. */
  async getPage(input: GetPageInput = {}): Promise<FacebookPage> {
    const v = this.validate(GetPageInputSchema, input, "getPage");
    return this.get(E.page(this.pageId), { fields: v.fields ?? DEFAULT_PAGE_FIELDS }, FacebookPageSchema);
  }

  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const page = await this.getPage();
    return {
      provider: this.name,
      id: page.id,
      username: page.username ?? null,
      displayName: page.name ?? null,
      profilePictureUrl: page.picture?.data?.url ?? null,
    };
  }

  /** GET /{page-id}/feed — posts by the Page incl. unpublished (max 100 per page). */
  async listFeed(input: ListFeedInput = {}): Promise<Page<FacebookPost>> {
    const v = this.validate(ListFeedInputSchema, input, "listFeed");
    return toGraphPage(await this.get(E.feed(this.pageId), { ...v }, FacebookPostListSchema));
  }

  /** GET /{page-id}/tagged — posts the Page is tagged/mentioned in. Needs pages_read_user_content. */
  async listTagged(input: ListFeedInput = {}): Promise<Page<FacebookPost>> {
    const v = this.validate(ListFeedInputSchema, input, "listTagged");
    return toGraphPage(await this.get(E.tagged(this.pageId), { ...v }, FacebookPostListSchema));
  }

  /** GET /{page-id}/insights — needs read_insights + pages_read_engagement (ANALYZE task). */
  async getPageInsights(input: GetPageInsightsInput): Promise<Page<FacebookInsight>> {
    const v = this.validate(GetPageInsightsInputSchema, input, "getPageInsights");
    return toGraphPage(await this.get(E.insights(this.pageId), { ...v }, FacebookInsightsResponseSchema));
  }

  /** GET /{page-post-id}/insights. */
  async getPostInsights(input: GetPostInsightsInput): Promise<Page<FacebookInsight>> {
    const { postId, ...q } = this.validate(GetPostInsightsInputSchema, input, "getPostInsights");
    return toGraphPage(await this.get(E.insights(postId), q, FacebookInsightsResponseSchema));
  }

  // ================= posts =================

  /** POST /{page-id}/feed — text, link, scheduled or carousel-link posts. Needs pages_manage_posts. */
  async createPost(input: CreatePostInput): Promise<GraphId> {
    const v = this.validate(CreatePostInputSchema, input, "createPost");
    return this.post(E.feed(this.pageId), v, GraphIdSchema);
  }

  /** Text-only Page post. */
  createTextPost(message: string, options: Omit<CreatePostInput, "message" | "link"> = {}): Promise<GraphId> {
    return this.createPost({ ...options, message });
  }

  /** Link Page post (optionally with a message). */
  createLinkPost(link: string, options: Omit<CreatePostInput, "link"> = {}): Promise<GraphId> {
    return this.createPost({ ...options, link });
  }

  /** GET /{page-post-id}. Reels are not returned by this endpoint. */
  async getPost(input: GetPostInput): Promise<FacebookPost> {
    const v = this.validate(GetPostInputSchema, input, "getPost");
    return this.get(E.node(v.postId), { fields: v.fields }, FacebookPostSchema);
  }

  /** POST /{page-post-id} — only posts created by this app. */
  async updatePost(input: UpdatePostInput): Promise<boolean> {
    const { postId, ...body } = this.validate(UpdatePostInputSchema, input, "updatePost");
    return (await this.post(E.node(postId), body, GraphSuccessSchema)).success;
  }

  /** Publish a post created with published=false. */
  publishUnpublishedPost(postId: string): Promise<boolean> {
    return this.updatePost({ postId, is_published: true });
  }

  /** DELETE /{page-post-id} — Meta restricts this to select developers. */
  async deletePost(postId: string): Promise<boolean> {
    return this.del(E.node(this.validate(PagePostIdSchema, postId, "deletePost")));
  }

  /**
   * DELETE /{video-id} — for video posts where only the video id is known.
   * (Graph video node; the Pages posts guide covers /{page_post_id} only.)
   */
  async deleteVideo(videoId: string): Promise<boolean> {
    return this.del(E.node(this.validate(GraphNodeIdSchema, videoId, "deleteVideo")));
  }

  /** POST /{video-id} with a new description (video node). */
  async updateVideoDescription(videoId: string, description: string): Promise<boolean> {
    const id = this.validate(GraphNodeIdSchema, videoId, "updateVideoDescription");
    return (await this.post(E.node(id), { description }, GraphSuccessSchema)).success;
  }

  // ================= photos =================

  /** POST /{page-id}/photos — `url` sources by URL, otherwise multipart `source`. */
  async uploadPhoto(input: UploadPhotoInput): Promise<UploadPhotoResponse> {
    const { media, ...fields } = this.validate(UploadPhotoInputSchema, input, "uploadPhoto");
    if (media.type === "url") return this.post(E.photos(this.pageId), { ...fields, url: media.url }, UploadPhotoResponseSchema);
    const data = await readAll(media);
    const form = this.multipart(fields, { name: "source", data, mimeType: media.mimeType, filename: media.filename });
    return (await this.http.json({ method: "POST", url: E.photos(this.pageId), body: { kind: "multipart", value: form } }, UploadPhotoResponseSchema)).data;
  }

  /** GET /{page-id}/photos?type=uploaded|profile|tagged. */
  async listPhotos(input: ListPhotosInput = {}): Promise<Page<FacebookPhoto>> {
    const v = this.validate(ListPhotosInputSchema, input, "listPhotos");
    return toGraphPage(await this.get(E.photos(this.pageId), { ...v }, graphListSchema(FacebookPhotoSchema)));
  }

  // ================= videos =================

  /** POST /{page-id}/videos upload_phase=start. */
  async startVideoUpload(fileSize: number): Promise<StartVideoUploadResponse> {
    const v = this.validate(StartVideoUploadInputSchema, { file_size: fileSize }, "startVideoUpload");
    return this.post(E.videos(this.pageId), { upload_phase: "start", ...v }, StartVideoUploadResponseSchema, this.videoHttp);
  }

  /** POST /{page-id}/videos upload_phase=transfer — returns the next offsets (start === end when done). */
  async transferVideoChunk(input: TransferVideoChunkInput): Promise<{ start_offset: number; end_offset: number }> {
    const { video_file_chunk, ...fields } = this.validate(TransferVideoChunkInputSchema, input, "transferVideoChunk");
    const form = this.multipart(
      { upload_phase: "transfer", ...fields },
      { name: "video_file_chunk", data: video_file_chunk, mimeType: "application/octet-stream", filename: "chunk" },
    );
    const req: HttpRequest = { method: "POST", url: E.videos(this.pageId), body: { kind: "multipart", value: form }, retry: true };
    return (await this.videoHttp.json(req, TransferVideoChunkResponseSchema)).data;
  }

  /** POST /{page-id}/videos upload_phase=finish — sets metadata and publishes (unless published=false). */
  async finishVideoUpload(input: FinishVideoUploadInput): Promise<UploadVideoResponse> {
    const v = this.validate(FinishVideoUploadInputSchema, input, "finishVideoUpload");
    return this.post(E.videos(this.pageId), { upload_phase: "finish", ...v }, UploadVideoResponseSchema, this.videoHttp);
  }

  /** POST /{page-id}/videos upload_phase=cancel. */
  async cancelVideoUpload(uploadSessionId: string): Promise<boolean> {
    const res = await this.post(E.videos(this.pageId), { upload_phase: "cancel", upload_session_id: uploadSessionId }, GraphSuccessSchema, this.videoHttp);
    return res.success;
  }

  /**
   * Upload and publish a Page video. URL sources use `file_url` (Meta fetches
   * it); bytes/streams use the chunked start → transfer → finish protocol.
   */
  async uploadVideo(input: UploadVideoInput): Promise<UploadVideoResponse> {
    const { media, ...metadata } = this.validate(UploadVideoInputSchema, input, "uploadVideo");
    if (media.type === "url") {
      return this.post(E.videos(this.pageId), { ...metadata, file_url: media.url }, UploadVideoResponseSchema, this.videoHttp);
    }
    const size = media.type === "buffer" ? media.data.byteLength : media.size;
    const session = await this.startVideoUpload(size);
    const reader = createRangeReader(media);
    let { start_offset: start, end_offset: end } = session;
    try {
      while (start < end) {
        const chunk = await reader.read(start, end);
        ({ start_offset: start, end_offset: end } = await this.transferVideoChunk({
          upload_session_id: session.upload_session_id,
          start_offset: start,
          video_file_chunk: chunk,
        }));
      }
    } catch (error) {
      await this.cancelVideoUpload(session.upload_session_id).catch(() => undefined);
      throw error;
    }
    const result = await this.finishVideoUpload({ upload_session_id: session.upload_session_id, ...metadata });
    return { ...result, video_id: result.video_id ?? session.video_id };
  }

  /** GET /{video-id}?fields=status — upload/processing/publishing phases. */
  async getVideoStatus(videoId: string): Promise<FacebookVideoStatus> {
    const id = this.validate(GraphNodeIdSchema, videoId, "getVideoStatus");
    return this.get(E.node(id), { fields: ["id", "status"] }, FacebookVideoStatusSchema);
  }

  // ================= reels =================

  /** POST /{page-id}/video_reels upload_phase=start → video_id + upload_url. */
  async startReelUpload(): Promise<StartReelUploadResponse> {
    return this.post(E.videoReels(this.pageId), { upload_phase: "start" }, StartReelUploadResponseSchema);
  }

  /** POST {upload_url} (rupload.facebook.com) with the bytes, or a `file_url` header for hosted files. */
  async uploadReel(input: UploadReelInput): Promise<boolean> {
    const v = this.validate(UploadReelInputSchema, input, "uploadReel");
    const token = await this.tokens.getAccessToken();
    const headers: Record<string, string> = { authorization: `OAuth ${token}` };
    let req: HttpRequest;
    if (v.media.type === "url") {
      req = { method: "POST", url: v.uploadUrl, auth: false, headers: { ...headers, file_url: v.media.url } };
    } else {
      const data = await readAll(v.media);
      req = {
        method: "POST",
        url: v.uploadUrl,
        auth: false,
        headers: { ...headers, offset: "0", file_size: String(data.byteLength) },
        body: { kind: "binary", value: data, contentType: "application/octet-stream" },
      };
    }
    return (await this.http.json(req, GraphSuccessSchema)).data.success;
  }

  /** POST /{page-id}/video_reels upload_phase=finish — publish, draft or schedule. */
  async finishReel(input: FinishReelInput): Promise<FinishReelResponse> {
    const v = this.validate(FinishReelInputSchema, input, "finishReel");
    return this.post(E.videoReels(this.pageId), { upload_phase: "finish", ...v }, FinishReelResponseSchema);
  }

  /** Reel in one call (30 API-published reels per Page per 24h). */
  async publishReel(input: PublishReelInput): Promise<FinishReelResponse & { video_id: string }> {
    const { media, ...rest } = this.validate(PublishReelInputSchema, input, "publishReel");
    const { video_id, upload_url } = await this.startReelUpload();
    await this.uploadReel({ uploadUrl: upload_url, media });
    const result = await this.finishReel({ ...rest, video_id });
    return { ...result, video_id };
  }

  // ================= comments =================

  /** GET /{object-id}/comments. */
  async listComments(input: ListCommentsInput): Promise<CommentPage> {
    const { objectId, ...q } = this.validate(ListCommentsInputSchema, input, "listComments");
    const data = await this.get(E.comments(objectId), q, FacebookCommentListSchema);
    return { ...toGraphPage(data), summary: data.summary };
  }

  /** GET /{comment-id}. */
  async getComment(input: GetCommentInput): Promise<FacebookComment> {
    const v = this.validate(GetCommentInputSchema, input, "getComment");
    return this.get(E.node(v.commentId), { fields: v.fields }, FacebookCommentSchema);
  }

  /** POST /{object-id}/comments — comment on a post, or reply when objectId is a comment. Needs pages_manage_engagement. */
  async createComment(input: CreateCommentInput): Promise<GraphId> {
    const { objectId, ...body } = this.validate(CreateCommentInputSchema, input, "createComment");
    return this.post(E.comments(objectId), body, GraphIdSchema);
  }

  /** Reply to a comment. */
  replyToComment(commentId: string, input: Omit<CreateCommentInput, "objectId">): Promise<GraphId> {
    return this.createComment({ ...input, objectId: commentId });
  }

  /** POST /{comment-id} — edit, or hide/unhide (Page comments only). */
  async updateComment(input: UpdateCommentInput): Promise<boolean> {
    const { commentId, ...body } = this.validate(UpdateCommentInputSchema, input, "updateComment");
    return (await this.post(E.node(commentId), body, GraphSuccessSchema)).success;
  }

  hideComment(commentId: string): Promise<boolean> {
    return this.updateComment({ commentId, is_hidden: true });
  }

  unhideComment(commentId: string): Promise<boolean> {
    return this.updateComment({ commentId, is_hidden: false });
  }

  /** DELETE /{comment-id}. */
  async deleteComment(commentId: string): Promise<boolean> {
    return this.del(E.node(this.validate(GraphNodeIdSchema, commentId, "deleteComment")));
  }

  // ================= reactions & likes =================

  /** GET /{object-id}/reactions. Only the Page's own reaction is visible per object. */
  async listReactions(input: ListReactionsInput): Promise<ReactionPage> {
    const { objectId, ...q } = this.validate(ListReactionsInputSchema, input, "listReactions");
    const data = await this.get(E.reactions(objectId), q, FacebookReactionListSchema);
    return { ...toGraphPage(data), summary: data.summary };
  }

  /** POST /{object-id}/likes — like as the Page (creating other reaction types is not supported by the API). */
  async like(objectId: string): Promise<boolean> {
    const id = this.validate(GraphNodeIdSchema, objectId, "like");
    return (await this.post(E.likes(id), {}, GraphSuccessSchema)).success;
  }

  /** DELETE /{object-id}/likes — remove the Page's like. */
  async unlike(objectId: string): Promise<boolean> {
    return this.del(E.likes(this.validate(GraphNodeIdSchema, objectId, "unlike")));
  }

  // ================= webhooks =================

  /** GET /{page-id}/subscribed_apps. Needs pages_manage_metadata. */
  async listSubscribedApps(): Promise<SubscribedApp[]> {
    return (await this.get(E.subscribedApps(this.pageId), {}, SubscribedAppsResponseSchema)).data;
  }

  /** POST /{page-id}/subscribed_apps — subscribe this app to Page webhook fields. */
  async subscribeApp(input: SubscribeAppInput): Promise<boolean> {
    const v = this.validate(SubscribeAppInputSchema, input, "subscribeApp");
    return (await this.post(E.subscribedApps(this.pageId), v, GraphSuccessSchema)).success;
  }

  /** DELETE /{page-id}/subscribed_apps. */
  async unsubscribeApp(): Promise<boolean> {
    return this.del(E.subscribedApps(this.pageId));
  }

  static verifyWebhookSubscription(query: Record<string, unknown>, verifyToken: string): string | null {
    return verifyMetaWebhookSubscription(query, verifyToken);
  }

  static verifyWebhookSignature(rawBody: Buffer | string, signature: string | null | undefined, appSecret: string): boolean {
    return verifyMetaWebhookSignature(rawBody, signature, appSecret);
  }

  /** Parse a (signature-verified) Page webhook body: { object: "page", entry: [{ id, time, changes }] }. */
  static parseWebhookPayload(body: unknown): PageWebhookPayload {
    const result = PageWebhookPayloadSchema.safeParse(body);
    if (!result.success) {
      throw new ProviderError({ provider: "FACEBOOK", code: "VALIDATION", message: "Invalid Page webhook payload", details: result.error.issues });
    }
    return result.data;
  }
}
