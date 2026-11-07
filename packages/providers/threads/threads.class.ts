import type { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { HttpClient, type HttpRequest, type QueryValue } from "../common/http-client";
import {
  GraphIdSchema,
  graphListSchema,
  parseGraphError,
  toGraphForm,
  toGraphPage,
  type GraphId,
} from "../common/meta-graph";
import type { Page } from "../common/pagination";
import { ProviderError } from "../common/provider-error";
import type { BaseProviderConfig, ProviderAccount } from "../common/provider.types";
import { verifyMetaWebhookSignature, verifyMetaWebhookSubscription } from "../common/webhooks";
import { THREADS_API_BASE_URL, THREADS_API_VERSION, THREADS_CONTAINER_POLL, THREADS_OEMBED_URL } from "./constants";
import { ThreadsEndpoints as E } from "./endpoints";
import {
  CreateCarouselItemInputSchema,
  CreateContainerInputSchema,
  CreateQuotePostInputSchema,
  CreateReplyInputSchema,
  DeleteMediaResponseSchema,
  GetLocationInputSchema,
  GetMediaInputSchema,
  GetMediaInsightsInputSchema,
  GetProfileInputSchema,
  GetPublishingLimitInputSchema,
  GetUserInsightsInputSchema,
  KeywordSearchInputSchema,
  ListPendingRepliesInputSchema,
  ListRepliesInputSchema,
  ListUserMediaInputSchema,
  ListUserRepliesInputSchema,
  ListUserThreadsInputSchema,
  LocationSearchInputSchema,
  ManagePendingReplyInputSchema,
  ManageReplyInputSchema,
  OEmbedInputSchema,
  ProfileLookupInputSchema,
  ProfilePostsInputSchema,
  PublishCarouselInputSchema,
  PublishContainerInputSchema,
  ThreadsContainerStatusSchema,
  ThreadsIdSchema,
  ThreadsImageContainerSchema,
  ThreadsInsightsResponseSchema,
  ThreadsLocationSchema,
  ThreadsMediaListSchema,
  ThreadsMediaSchema,
  ThreadsOEmbedSchema,
  ThreadsProfileSchema,
  ThreadsPublicProfileSchema,
  ThreadsPublishingLimitResponseSchema,
  ThreadsTextContainerSchema,
  ThreadsVideoContainerSchema,
  ThreadsWebhookEventSchema,
  WaitForContainerOptionsSchema,
  type CreateContainerInput,
  type DeleteMediaResponse,
  type GetLocationInput,
  type GetMediaInput,
  type GetMediaInsightsInput,
  type GetProfileInput,
  type GetPublishingLimitInput,
  type GetUserInsightsInput,
  type KeywordSearchInput,
  type ListPendingRepliesInput,
  type ListRepliesInput,
  type ListUserMediaInput,
  type ListUserRepliesInput,
  type ListUserThreadsInput,
  type LocationSearchInput,
  type ManagePendingReplyInput,
  type ManageReplyInput,
  type OEmbedInput,
  type ProfileLookupInput,
  type ProfilePostsInput,
  type PublishCarouselInput,
  type ThreadsCarouselItem,
  type ThreadsContainerStatus,
  type ThreadsImageContainerInput,
  type ThreadsInsight,
  type ThreadsLocation,
  type ThreadsMedia,
  type ThreadsOEmbed,
  type ThreadsProfile,
  type ThreadsPublicProfile,
  type ThreadsPublishingLimit,
  type ThreadsTextContainerInput,
  type ThreadsVideoContainerInput,
  type ThreadsWebhookEvent,
  type WaitForContainerOptions,
} from "./model";

export interface ThreadsProviderConfig extends BaseProviderConfig {
  /** Threads user ID (provider_account_id) — not a Facebook or Instagram ID. */
  userId: string;
  /** Graph version path segment (default v1.0). */
  version?: string;
  baseUrl?: string;
}

/** Result of a create-and-publish helper. */
export interface ThreadsPublishResult {
  containerId: string;
  mediaId: string;
}

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Threads API (graph.threads.net). Direct HTTP: Meta publishes no official
 * Threads SDK. Uses Threads user tokens only — never Facebook Page tokens.
 *
 * Not supported by the Threads API (so not implemented): follower/following
 * management, direct messages, editing published posts, undoing a repost.
 */
export class ThreadsProvider extends BaseProvider<ThreadsProviderConfig> {
  readonly name = "THREADS" as const;
  readonly userId: string;
  readonly version: string;
  private readonly http: HttpClient;

  constructor(config: ThreadsProviderConfig) {
    super(config);
    this.userId = this.validate(ThreadsIdSchema, config.userId, "constructor.userId");
    this.version = config.version ?? THREADS_API_VERSION;
    this.http = new HttpClient({
      provider: "THREADS",
      baseUrl: `${(config.baseUrl ?? THREADS_API_BASE_URL).replace(/\/$/, "")}/${this.version}`,
      tokens: this.tokens,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      sleep: config.sleep,
      authorize: (token) => ({ query: { access_token: token } }),
      parseError: parseGraphError,
    });
  }

  // ---------- helpers ----------

  private async get<S extends z.ZodType>(url: string, query: Record<string, QueryValue>, schema: S): Promise<z.output<S>> {
    return (await this.http.json({ method: "GET", url, query }, schema)).data;
  }

  private async post<S extends z.ZodType>(url: string, form: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    const req: HttpRequest = { method: "POST", url, body: { kind: "form", value: toGraphForm(form) } };
    return (await this.http.json(req, schema)).data;
  }

  private async list(url: string, query: Record<string, QueryValue>): Promise<Page<ThreadsMedia>> {
    return toGraphPage(await this.get(url, query, ThreadsMediaListSchema));
  }

  private uid(userId: string | undefined) {
    return userId ?? this.userId;
  }

  // ================= profile =================

  /** GET /{threads-user-id} — profile of the configured (or given) user. */
  async getProfile(input: GetProfileInput = {}): Promise<ThreadsProfile> {
    const v = this.validate(GetProfileInputSchema, input, "getProfile");
    return this.get(E.user(this.uid(v.userId)), { fields: v.fields ?? ["id", "username", "name", "threads_profile_picture_url"] }, ThreadsProfileSchema);
  }

  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const me = await this.getProfile();
    return {
      provider: this.name,
      id: me.id,
      username: me.username ?? null,
      displayName: me.name ?? null,
      profilePictureUrl: me.threads_profile_picture_url ?? null,
    };
  }

  /** GET /profile_lookup — public profile (≥100 followers). Needs threads_profile_discovery. */
  async lookupProfile(input: ProfileLookupInput): Promise<ThreadsPublicProfile> {
    const v = this.validate(ProfileLookupInputSchema, input, "lookupProfile");
    return this.get(E.profileLookup, { username: v.username }, ThreadsPublicProfileSchema);
  }

  /** GET /profile_posts — public posts of a profile. Needs threads_profile_discovery. */
  async getProfilePosts(input: ProfilePostsInput): Promise<Page<ThreadsMedia>> {
    const v = this.validate(ProfilePostsInputSchema, input, "getProfilePosts");
    return this.list(E.profilePosts, { ...v });
  }

  /** GET /{threads-user-id}/threads — the user's own posts. */
  async listThreads(input: ListUserThreadsInput = {}): Promise<Page<ThreadsMedia>> {
    const { userId, ...q } = this.validate(ListUserThreadsInputSchema, input, "listThreads");
    return this.list(E.userThreads(this.uid(userId)), q);
  }

  /** GET /{threads-user-id}/replies — replies the user created. Needs threads_read_replies. */
  async listUserReplies(input: ListUserRepliesInput = {}): Promise<Page<ThreadsMedia>> {
    const { userId, ...q } = this.validate(ListUserRepliesInputSchema, input, "listUserReplies");
    return this.list(E.userReplies(this.uid(userId)), q);
  }

  /** GET /{threads-user-id}/mentions — public posts mentioning the user. Needs threads_manage_mentions. */
  async listMentions(input: ListUserMediaInput = {}): Promise<Page<ThreadsMedia>> {
    const { userId, ...q } = this.validate(ListUserMediaInputSchema, input, "listMentions");
    return this.list(E.userMentions(this.uid(userId)), q);
  }

  /** GET /{threads-user-id}/ghost_posts — the user's ghost posts. */
  async listGhostPosts(input: ListUserMediaInput = {}): Promise<Page<ThreadsMedia>> {
    const { userId, ...q } = this.validate(ListUserMediaInputSchema, input, "listGhostPosts");
    return this.list(E.userGhostPosts(this.uid(userId)), q);
  }

  /** GET /{threads-user-id}/threads_publishing_limit — current 24h quota usage. */
  async getPublishingLimit(input: GetPublishingLimitInput = {}): Promise<ThreadsPublishingLimit | null> {
    const v = this.validate(GetPublishingLimitInputSchema, input, "getPublishingLimit");
    const data = await this.get(
      E.publishingLimit(this.uid(v.userId)),
      { fields: v.fields ?? ["quota_usage", "config", "reply_quota_usage", "reply_config"] },
      ThreadsPublishingLimitResponseSchema,
    );
    return data.data[0] ?? null;
  }

  // ================= publishing =================

  /** POST /{threads-user-id}/threads — create a media container (TEXT, IMAGE, VIDEO or CAROUSEL). */
  async createContainer(input: CreateContainerInput): Promise<GraphId> {
    const v = this.validate(CreateContainerInputSchema, input, "createContainer");
    return this.post(E.createContainer(this.userId), v, GraphIdSchema);
  }

  /** POST /{threads-user-id}/threads with is_carousel_item=true. */
  async createCarouselItem(input: ThreadsCarouselItem): Promise<GraphId> {
    const v = this.validate(CreateCarouselItemInputSchema, input, "createCarouselItem");
    return this.post(E.createContainer(this.userId), { ...v, is_carousel_item: true }, GraphIdSchema);
  }

  /** POST /{threads-user-id}/threads_publish — publish a FINISHED container. Needs threads_content_publish. */
  async publishContainer(creationId: string): Promise<GraphId> {
    const v = this.validate(PublishContainerInputSchema, { creation_id: creationId }, "publishContainer");
    return this.post(E.publish(this.userId), v, GraphIdSchema);
  }

  /** GET /{container-id}?fields=id,status,error_message — container processing status. */
  async getContainerStatus(containerId: string): Promise<ThreadsContainerStatus> {
    const id = this.validate(ThreadsIdSchema, containerId, "getContainerStatus");
    return this.get(E.media(id), { fields: ["id", "status", "error_message"] }, ThreadsContainerStatusSchema);
  }

  /**
   * Poll a container until FINISHED (Meta: once a minute, at most 5 minutes).
   * Throws on ERROR / EXPIRED / timeout.
   */
  async waitForContainer(containerId: string, options: WaitForContainerOptions = {}): Promise<ThreadsContainerStatus> {
    const o = this.validate(WaitForContainerOptionsSchema, options, "waitForContainer");
    const intervalMs = o.intervalMs ?? THREADS_CONTAINER_POLL.intervalMs;
    const maxAttempts = o.maxAttempts ?? THREADS_CONTAINER_POLL.maxAttempts;
    const sleep = this.config.sleep ?? sleepDefault;
    for (let attempt = 1; ; attempt++) {
      const status = await this.getContainerStatus(containerId);
      if (status.status === "FINISHED" || status.status === "PUBLISHED") return status;
      if (status.status === "ERROR" || status.status === "EXPIRED") {
        throw new ProviderError({
          provider: this.name,
          code: "PROVIDER_ERROR",
          message: `Threads container ${status.status}${status.error_message ? `: ${status.error_message}` : ""}`,
          providerCode: status.error_message ?? status.status,
          details: status,
        });
      }
      if (attempt >= maxAttempts) {
        throw new ProviderError({
          provider: this.name,
          code: "TIMEOUT",
          message: "Threads container did not finish processing in time",
          retryable: true,
          details: status,
        });
      }
      await sleep(intervalMs);
    }
  }

  private async createAndPublish(input: CreateContainerInput, wait: WaitForContainerOptions | false): Promise<ThreadsPublishResult> {
    const { id: containerId } = await this.createContainer(input);
    if (wait !== false) await this.waitForContainer(containerId, wait);
    const { id: mediaId } = await this.publishContainer(containerId);
    return { containerId, mediaId };
  }

  /** Text post (also used for polls, link/GIF/text attachments, quotes and replies). */
  async publishText(input: Omit<ThreadsTextContainerInput, "media_type">): Promise<ThreadsPublishResult> {
    const v = this.validate(ThreadsTextContainerSchema, { ...input, media_type: "TEXT" }, "publishText");
    if (v.auto_publish_text) {
      const { id } = await this.createContainer(v);
      return { containerId: id, mediaId: id };
    }
    return this.createAndPublish(v, false);
  }

  /** Image post from a public image URL. */
  async publishImage(input: Omit<ThreadsImageContainerInput, "media_type">, wait: WaitForContainerOptions = {}): Promise<ThreadsPublishResult> {
    const v = this.validate(ThreadsImageContainerSchema, { ...input, media_type: "IMAGE" }, "publishImage");
    return this.createAndPublish(v, wait);
  }

  /** Video post from a public video URL; waits for processing before publishing. */
  async publishVideo(input: Omit<ThreadsVideoContainerInput, "media_type">, wait: WaitForContainerOptions = {}): Promise<ThreadsPublishResult> {
    const v = this.validate(ThreadsVideoContainerSchema, { ...input, media_type: "VIDEO" }, "publishVideo");
    return this.createAndPublish(v, wait);
  }

  /** Carousel (2–20 items): creates each child, waits for them, then creates and publishes the parent. */
  async publishCarousel(input: PublishCarouselInput, wait: WaitForContainerOptions = {}): Promise<ThreadsPublishResult> {
    const { items, ...rest } = this.validate(PublishCarouselInputSchema, input, "publishCarousel");
    const children: string[] = [];
    for (const item of items) {
      const { id } = await this.createCarouselItem(item);
      if (item.media_type === "VIDEO") await this.waitForContainer(id, wait);
      children.push(id);
    }
    return this.createAndPublish({ ...rest, media_type: "CAROUSEL", children }, wait);
  }

  /** Reply to a post or reply (text). Needs threads_manage_replies. */
  async createReply(input: Omit<ThreadsTextContainerInput, "media_type"> & { reply_to_id: string }): Promise<ThreadsPublishResult> {
    const v = this.validate(CreateReplyInputSchema, { ...input, media_type: "TEXT" }, "createReply");
    return this.publishText(v);
  }

  /** Quote a post (text). */
  async createQuotePost(input: Omit<ThreadsTextContainerInput, "media_type"> & { quote_post_id: string }): Promise<ThreadsPublishResult> {
    const v = this.validate(CreateQuotePostInputSchema, { ...input, media_type: "TEXT" }, "createQuotePost");
    return this.publishText(v);
  }

  /** POST /{threads-media-id}/repost. Needs threads_content_publish. */
  async repost(mediaId: string): Promise<GraphId> {
    const id = this.validate(ThreadsIdSchema, mediaId, "repost");
    return this.post(E.repost(id), {}, GraphIdSchema);
  }

  /** DELETE /{threads-media-id} — own posts only (100/day). Needs threads_delete. */
  async deletePost(mediaId: string): Promise<DeleteMediaResponse> {
    const id = this.validate(ThreadsIdSchema, mediaId, "deletePost");
    return (await this.http.json({ method: "DELETE", url: E.media(id) }, DeleteMediaResponseSchema)).data;
  }

  // ================= media retrieval =================

  /** GET /{threads-media-id}. */
  async getPost(input: GetMediaInput): Promise<ThreadsMedia> {
    const v = this.validate(GetMediaInputSchema, input, "getPost");
    return this.get(E.media(v.mediaId), { fields: v.fields }, ThreadsMediaSchema);
  }

  // ================= replies =================

  /** GET /{threads-media-id}/replies — top-level replies. Needs threads_read_replies. */
  async listReplies(input: ListRepliesInput): Promise<Page<ThreadsMedia>> {
    const { mediaId, ...q } = this.validate(ListRepliesInputSchema, input, "listReplies");
    return this.list(E.replies(mediaId), q);
  }

  /** GET /{threads-media-id}/conversation — flattened replies at all depths. */
  async listConversation(input: ListRepliesInput): Promise<Page<ThreadsMedia>> {
    const { mediaId, ...q } = this.validate(ListRepliesInputSchema, input, "listConversation");
    return this.list(E.conversation(mediaId), q);
  }

  /** GET /{threads-media-id}/pending_replies — replies awaiting approval. */
  async listPendingReplies(input: ListPendingRepliesInput): Promise<Page<ThreadsMedia>> {
    const { mediaId, ...q } = this.validate(ListPendingRepliesInputSchema, input, "listPendingReplies");
    return this.list(E.pendingReplies(mediaId), q);
  }

  /** POST /{threads-reply-id}/manage_reply — hide (true) or unhide (false). Needs threads_manage_replies. */
  async manageReply(input: ManageReplyInput): Promise<boolean> {
    const v = this.validate(ManageReplyInputSchema, input, "manageReply");
    const res = await this.post(E.manageReply(v.replyId), { hide: v.hide }, DeleteMediaResponseSchema.pick({ success: true }));
    return res.success;
  }

  hideReply(replyId: string): Promise<boolean> {
    return this.manageReply({ replyId, hide: true });
  }

  unhideReply(replyId: string): Promise<boolean> {
    return this.manageReply({ replyId, hide: false });
  }

  /** POST /{threads-reply-id}/manage_pending_reply — approve (true) or ignore (false). */
  async managePendingReply(input: ManagePendingReplyInput): Promise<boolean> {
    const v = this.validate(ManagePendingReplyInputSchema, input, "managePendingReply");
    const res = await this.post(E.managePendingReply(v.replyId), { approve: v.approve }, DeleteMediaResponseSchema.pick({ success: true }));
    return res.success;
  }

  // ================= insights =================

  /** GET /{threads-media-id}/insights. Needs threads_manage_insights. */
  async getMediaInsights(input: GetMediaInsightsInput): Promise<ThreadsInsight[]> {
    const v = this.validate(GetMediaInsightsInputSchema, input, "getMediaInsights");
    return (await this.get(E.mediaInsights(v.mediaId), { metric: v.metric }, ThreadsInsightsResponseSchema)).data;
  }

  /** GET /{threads-user-id}/threads_insights. Needs threads_manage_insights. */
  async getUserInsights(input: GetUserInsightsInput): Promise<ThreadsInsight[]> {
    const { userId, ...q } = this.validate(GetUserInsightsInputSchema, input, "getUserInsights");
    return (await this.get(E.userInsights(this.uid(userId)), q, ThreadsInsightsResponseSchema)).data;
  }

  // ================= search & discovery =================

  /** GET /keyword_search — public posts by keyword or tag (2,200 queries/24h). Needs threads_keyword_search. */
  async keywordSearch(input: KeywordSearchInput): Promise<Page<ThreadsMedia>> {
    const v = this.validate(KeywordSearchInputSchema, input, "keywordSearch");
    return this.list(E.keywordSearch, { ...v });
  }

  /** GET /location_search — locations to tag (500/24h). */
  async searchLocations(input: LocationSearchInput): Promise<ThreadsLocation[]> {
    const v = this.validate(LocationSearchInputSchema, input, "searchLocations");
    const data = await this.get(E.locationSearch, { ...v }, graphListSchema(ThreadsLocationSchema));
    return data.data;
  }

  /** GET /{location-id}. */
  async getLocation(input: GetLocationInput): Promise<ThreadsLocation> {
    const v = this.validate(GetLocationInputSchema, input, "getLocation");
    return this.get(E.location(v.locationId), { fields: v.fields }, ThreadsLocationSchema);
  }

  /** GET https://www.threads.com/oembed — embed HTML for a public post or profile (no token is sent to this host). */
  async getOEmbed(input: OEmbedInput): Promise<ThreadsOEmbed> {
    const v = this.validate(OEmbedInputSchema, input, "getOEmbed");
    return (await this.http.json({ method: "GET", url: THREADS_OEMBED_URL, query: { ...v }, auth: false }, ThreadsOEmbedSchema)).data;
  }

  // ================= webhooks =================

  /** Answer Meta's GET verification: returns hub.challenge or null. */
  static verifyWebhookSubscription(query: Record<string, unknown>, verifyToken: string): string | null {
    return verifyMetaWebhookSubscription(query, verifyToken);
  }

  /** Check X-Hub-Signature-256 against the exact raw body. */
  static verifyWebhookSignature(rawBody: Buffer | string, signature: string | null | undefined, appSecret: string): boolean {
    return verifyMetaWebhookSignature(rawBody, signature, appSecret);
  }

  /** Parse a (signature-verified) notification body. */
  static parseWebhookEvent(body: unknown): ThreadsWebhookEvent {
    const result = ThreadsWebhookEventSchema.safeParse(body);
    if (!result.success) {
      throw new ProviderError({ provider: "THREADS", code: "VALIDATION", message: "Invalid Threads webhook payload", details: result.error.issues });
    }
    return result.data;
  }
}
