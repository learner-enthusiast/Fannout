import { ApiError, Client, type HttpClient as XdkHttpClient } from "@xdevplatform/xdk";
import type { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { openMediaStream, readAll, readChunks } from "../common/media";
import { paginate, type Page } from "../common/pagination";
import { ProviderError, codeFromStatus, isRetryableStatus } from "../common/provider-error";
import {
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  type BaseProviderConfig,
  type FetchLike,
  type ProviderAccount,
} from "../common/provider.types";
import { computeRetryDelayMs, parseRateLimitHeaders } from "../common/rate-limit";
import { X_API_BASE_URL, X_MEDIA_CHUNK_BYTES } from "./constants";
import {
  XActionResultSchema,
  XAppendMediaUploadInputSchema,
  XBlockMuteListInputSchema,
  XBookmarkPostInputSchema,
  XBookmarksInputSchema,
  XConversationInputSchema,
  XCountsSchema,
  XCreateDmGroupInputSchema,
  XCreateListInputSchema,
  XCreatePostInputSchema,
  XCreatedPostSchema,
  XDmConversationEventsInputSchema,
  XDmEventInputSchema,
  XDmEventSchema,
  XDmEventsInputSchema,
  XDmParticipantEventsInputSchema,
  XGetListInputSchema,
  XGetPostInputSchema,
  XGetPostsInputSchema,
  XGetSpaceInputSchema,
  XGetSpacesInputSchema,
  XGetUserByIdInputSchema,
  XGetUserByUsernameInputSchema,
  XGetUsersByIdsInputSchema,
  XGetUsersByUsernamesInputSchema,
  XHideReplyInputSchema,
  XHomeTimelineInputSchema,
  XIdSchema,
  XInitializeMediaUploadInputSchema,
  XLikedPostsInputSchema,
  XListIdInputSchema,
  XListMemberInputSchema,
  XListMembersInputSchema,
  XListPostsInputSchema,
  XListSchema,
  XMediaAltTextInputSchema,
  XMediaUploadResponseSchema,
  XMentionsInputSchema,
  XPinnedListsInputSchema,
  XPostIdInputSchema,
  XPostSchema,
  XPostUsersInputSchema,
  XQuoteInputSchema,
  XQuotePostsInputSchema,
  XRecentCountsInputSchema,
  XReplyInputSchema,
  XSearchAllInputSchema,
  XSearchRecentInputSchema,
  XSearchSpacesInputSchema,
  XSearchUsersInputSchema,
  XSendDmToConversationInputSchema,
  XSendDmToParticipantInputSchema,
  XSpaceBuyersInputSchema,
  XSpacePostsInputSchema,
  XSpaceSchema,
  XSpacesByCreatorsInputSchema,
  XTargetUserInputSchema,
  XUpdateListInputSchema,
  XUploadMediaChunkedInputSchema,
  XUploadMediaInputSchema,
  XUserConnectionsInputSchema,
  XUserListsInputSchema,
  XUserLookupOptionsSchema,
  XUserPostsInputSchema,
  XUserSchema,
  xList,
  xSingle,
  type XBlockMuteListInput,
  type XBookmarksInput,
  type XConversationInput,
  type XCreateDmGroupInput,
  type XCreateListInput,
  type XCreatePostInput,
  type XDmConversationEventsInput,
  type XDmEventInput,
  type XDmEventsInput,
  type XDmParticipantEventsInput,
  type XGetListInput,
  type XGetPostInput,
  type XGetPostsInput,
  type XGetSpaceInput,
  type XGetSpacesInput,
  type XGetUserByIdInput,
  type XGetUserByUsernameInput,
  type XGetUsersByIdsInput,
  type XGetUsersByUsernamesInput,
  type XHomeTimelineInput,
  type XInitializeMediaUploadInput,
  type XLikedPostsInput,
  type XListMembersInput,
  type XListPostsInput,
  type XMentionsInput,
  type XQuoteInput,
  type XQuotePostsInput,
  type XRecentCountsInput,
  type XReplyInput,
  type XSearchAllInput,
  type XSearchRecentInput,
  type XSearchSpacesInput,
  type XSearchUsersInput,
  type XSendDmToConversationInput,
  type XSendDmToParticipantInput,
  type XSpaceBuyersInput,
  type XSpacePostsInput,
  type XSpacesByCreatorsInput,
  type XUpdateListInput,
  type XUploadMediaChunkedInput,
  type XUploadMediaInput,
  type XUserConnectionsInput,
  type XUserListsInput,
  type XUserPostsInput,
} from "./model";

export interface XProviderConfig extends BaseProviderConfig {
  /** Authenticated user's X id; resolved with GET /2/users/me when omitted. */
  userId?: string;
  baseUrl?: string;
  /** Inject a preconfigured XDK client (tests). Auth/fetch options are then ignored. */
  client?: Client;
}

const IDEMPOTENT = new Set(["GET", "PUT", "DELETE"]);
const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * X API v2 through the official TypeScript XDK (@xdevplatform/xdk). The SDK
 * does request building, auth header selection and camelCase mapping; this
 * class adds input validation, response parsing, token refresh, retries and
 * error normalisation. Inputs/outputs use the XDK's camelCase names.
 */
export class XProvider extends BaseProvider<XProviderConfig> {
  readonly name = "X" as const;
  readonly sdk: Client;
  private userId: string | undefined;

  constructor(config: XProviderConfig) {
    super(config);
    this.userId = config.userId;
    if (config.client) {
      this.sdk = config.client;
    } else {
      // The token is attached per request by the adapter below, so it can be
      // fetched lazily and refreshed; "deferred" only selects OAuth2 user auth.
      this.sdk = new Client({ accessToken: "deferred", baseUrl: config.baseUrl ?? X_API_BASE_URL });
      Object.defineProperty(this.sdk, "httpClient", { value: this.createHttpAdapter(), configurable: true });
    }
  }

  /** Replaces the XDK transport: token injection, 401 refresh, retries, timeouts, injectable fetch. */
  private createHttpAdapter(): Pick<XdkHttpClient, "request"> {
    const fetchImpl: FetchLike = this.config.fetch ?? ((input, init) => fetch(input, init));
    const retry = { ...DEFAULT_RETRY, ...this.config.retry };
    const sleep = this.config.sleep ?? sleepDefault;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const tokens = this.tokens;

    return {
      request: async (url, options = {}) => {
        const method = options.method ?? "GET";
        const send = async (token: string) => {
          const headers = new Headers(options.headers as HeadersInit | undefined);
          headers.set("authorization", `Bearer ${token}`);
          return fetchImpl(url, {
            method,
            headers,
            body: options.body as BodyInit | undefined,
            signal: options.signal ?? AbortSignal.timeout(timeoutMs),
          });
        };
        let refreshed = false;
        for (let attempt = 0; ; attempt++) {
          const response = await send(await tokens.getAccessToken());
          if (response.status === 401 && !refreshed && tokens.canRefresh) {
            refreshed = true;
            if (await tokens.refresh()) {
              attempt -= 1;
              continue;
            }
          }
          const canRetry = response.status === 429 || (IDEMPOTENT.has(method) && response.status >= 500);
          if (canRetry && attempt < retry.maxRetries) {
            await sleep(computeRetryDelayMs(attempt, parseRateLimitHeaders(response.headers), retry));
            continue;
          }
          return response;
        }
      },
    };
  }

  private normalize(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    if (error instanceof ApiError) {
      const data = (error.data ?? {}) as { title?: unknown; detail?: unknown; type?: unknown };
      if (error.status === 0) {
        return new ProviderError({ provider: this.name, code: "NETWORK", message: "Network request failed", retryable: true, cause: error });
      }
      return new ProviderError({
        provider: this.name,
        code: codeFromStatus(error.status),
        status: error.status,
        message: typeof data.detail === "string" ? data.detail : typeof data.title === "string" ? data.title : error.message,
        providerCode: typeof data.type === "string" ? data.type : null,
        retryable: isRetryableStatus(error.status),
        rateLimit: parseRateLimitHeaders(error.headers),
        details: error.data,
      });
    }
    return new ProviderError({ provider: this.name, code: "PROVIDER_ERROR", message: "X request failed", cause: error });
  }

  private async call<S extends z.ZodType>(operation: string, schema: S, run: (sdk: Client) => Promise<unknown>) {
    let data: unknown;
    try {
      data = await run(this.sdk);
    } catch (error) {
      throw this.normalize(error);
    }
    return this.parseResponse(schema, data, operation);
  }

  private static page<T>(res: { data?: T[]; meta?: { nextToken?: string; previousToken?: string } }): Page<T> {
    return { items: res.data ?? [], nextCursor: res.meta?.nextToken ?? null, previousCursor: res.meta?.previousToken ?? null };
  }

  /** Authenticated user's id (from config, else GET /2/users/me, cached). */
  async getAuthenticatedUserId(): Promise<string> {
    this.userId ??= (await this.getMe()).data?.id;
    if (!this.userId) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "Could not resolve user id" });
    return this.userId;
  }

  /** Iterate all pages of any list method that takes `paginationToken`. */
  iterate<I extends { paginationToken?: string }, T>(
    method: (input: I) => Promise<Page<T>>,
    input: I,
    options?: { maxPages?: number; maxItems?: number },
  ): AsyncGenerator<T> {
    return paginate((cursor) => method({ ...input, paginationToken: cursor ?? input.paginationToken }), options);
  }

  // ================= users =================

  /** GET /2/users/me */
  async getMe(input: z.input<typeof XUserLookupOptionsSchema> = {}) {
    const v = this.validate(XUserLookupOptionsSchema, input, "getMe");
    return this.call("getMe", xSingle(XUserSchema), (sdk) => sdk.users.getMe(v));
  }

  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const me = await this.getMe({ userFields: ["profile_image_url"] });
    if (!me.data) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "No user returned" });
    this.userId = me.data.id;
    return {
      provider: this.name,
      id: me.data.id,
      username: me.data.username,
      displayName: me.data.name,
      profilePictureUrl: me.data.profileImageUrl ?? null,
    };
  }

  /** GET /2/users/:id */
  async getUserById(input: XGetUserByIdInput) {
    const { id, ...o } = this.validate(XGetUserByIdInputSchema, input, "getUserById");
    return this.call("getUserById", xSingle(XUserSchema), (sdk) => sdk.users.getById(id, o));
  }

  /** GET /2/users/by/username/:username */
  async getUserByUsername(input: XGetUserByUsernameInput) {
    const { username, ...o } = this.validate(XGetUserByUsernameInputSchema, input, "getUserByUsername");
    return this.call("getUserByUsername", xSingle(XUserSchema), (sdk) => sdk.users.getByUsername(username, o));
  }

  /** GET /2/users/by?usernames= (≤100) */
  async getUsersByUsernames(input: XGetUsersByUsernamesInput) {
    const { usernames, ...o } = this.validate(XGetUsersByUsernamesInputSchema, input, "getUsersByUsernames");
    return this.call("getUsersByUsernames", xList(XUserSchema), (sdk) => sdk.users.getByUsernames(usernames, o));
  }

  /** GET /2/users?ids= (≤100) */
  async getUsersByIds(input: XGetUsersByIdsInput) {
    const { ids, ...o } = this.validate(XGetUsersByIdsInputSchema, input, "getUsersByIds");
    return this.call("getUsersByIds", xList(XUserSchema), (sdk) => sdk.users.getByIds(ids, o));
  }

  /** GET /2/users/search */
  async searchUsers(input: XSearchUsersInput) {
    const { query, ...o } = this.validate(XSearchUsersInputSchema, input, "searchUsers");
    return XProvider.page(await this.call("searchUsers", xList(XUserSchema), (sdk) => sdk.users.search(query, o)));
  }

  /** GET /2/users/:id/followers */
  async getFollowers(input: XUserConnectionsInput = {}) {
    const { userId, ...o } = this.validate(XUserConnectionsInputSchema, input, "getFollowers");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getFollowers", xList(XUserSchema), (sdk) => sdk.users.getFollowers(id, o)));
  }

  /** GET /2/users/:id/following */
  async getFollowing(input: XUserConnectionsInput = {}) {
    const { userId, ...o } = this.validate(XUserConnectionsInputSchema, input, "getFollowing");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getFollowing", xList(XUserSchema), (sdk) => sdk.users.getFollowing(id, o)));
  }

  /** POST /2/users/:id/following (follows.write) */
  async followUser(targetUserId: string) {
    const v = this.validate(XTargetUserInputSchema, { targetUserId }, "followUser");
    const me = await this.getAuthenticatedUserId();
    return this.call("followUser", XActionResultSchema, (sdk) => sdk.users.followUser(me, { targetUserId: v.targetUserId }));
  }

  /** DELETE /2/users/:source_user_id/following/:target_user_id */
  async unfollowUser(targetUserId: string) {
    const v = this.validate(XTargetUserInputSchema, { targetUserId }, "unfollowUser");
    const me = await this.getAuthenticatedUserId();
    return this.call("unfollowUser", XActionResultSchema, (sdk) => sdk.users.unfollowUser(me, v.targetUserId));
  }

  /** GET /2/users/:id/blocking (block.read). Blocking/unblocking writes are not in the v2 API. */
  async getBlockedUsers(input: XBlockMuteListInput = {}) {
    const { userId, ...o } = this.validate(XBlockMuteListInputSchema, input, "getBlockedUsers");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getBlockedUsers", xList(XUserSchema), (sdk) => sdk.users.getBlocking(id, o)));
  }

  /** GET /2/users/:id/muting (mute.read) */
  async getMutedUsers(input: XBlockMuteListInput = {}) {
    const { userId, ...o } = this.validate(XBlockMuteListInputSchema, input, "getMutedUsers");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getMutedUsers", xList(XUserSchema), (sdk) => sdk.users.getMuting(id, o)));
  }

  /** POST /2/users/:id/muting (mute.write) */
  async muteUser(targetUserId: string) {
    const v = this.validate(XTargetUserInputSchema, { targetUserId }, "muteUser");
    const me = await this.getAuthenticatedUserId();
    return this.call("muteUser", XActionResultSchema, (sdk) => sdk.users.muteUser(me, { targetUserId: v.targetUserId }));
  }

  /** DELETE /2/users/:source_user_id/muting/:target_user_id */
  async unmuteUser(targetUserId: string) {
    const v = this.validate(XTargetUserInputSchema, { targetUserId }, "unmuteUser");
    const me = await this.getAuthenticatedUserId();
    return this.call("unmuteUser", XActionResultSchema, (sdk) => sdk.users.unmuteUser(me, v.targetUserId));
  }

  // ================= posts =================

  /** POST /2/tweets — text, media, poll, reply, quote, edit… */
  async createPost(input: XCreatePostInput) {
    const body = this.validate(XCreatePostInputSchema, input, "createPost");
    return this.call("createPost", XCreatedPostSchema, (sdk) => sdk.posts.create(body));
  }

  /** Reply to a post (POST /2/tweets with reply.inReplyToTweetId). */
  async replyToPost(input: XReplyInput) {
    const v = this.validate(XReplyInputSchema, input, "replyToPost");
    return this.createPost({
      text: v.text,
      reply: { inReplyToTweetId: v.inReplyToTweetId, excludeReplyUserIds: v.excludeReplyUserIds },
      media: v.mediaIds ? { mediaIds: v.mediaIds } : undefined,
    });
  }

  /** Quote a post (POST /2/tweets with quoteTweetId). */
  async quotePost(input: XQuoteInput) {
    const v = this.validate(XQuoteInputSchema, input, "quotePost");
    return this.createPost({ text: v.text, quoteTweetId: v.quoteTweetId, media: v.mediaIds ? { mediaIds: v.mediaIds } : undefined });
  }

  /** DELETE /2/tweets/:id */
  async deletePost(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "deletePost");
    return this.call("deletePost", XActionResultSchema, (sdk) => sdk.posts.delete(v.postId));
  }

  /** GET /2/tweets/:id */
  async getPost(input: XGetPostInput) {
    const { id, ...o } = this.validate(XGetPostInputSchema, input, "getPost");
    return this.call("getPost", xSingle(XPostSchema), (sdk) => sdk.posts.getById(id, o));
  }

  /** GET /2/tweets?ids= (≤100) */
  async getPosts(input: XGetPostsInput) {
    const { ids, ...o } = this.validate(XGetPostsInputSchema, input, "getPosts");
    return this.call("getPosts", xList(XPostSchema), (sdk) => sdk.posts.getByIds(ids, o));
  }

  /** GET /2/tweets/:id/quote_tweets */
  async getQuotePosts(input: XQuotePostsInput) {
    const { id, ...o } = this.validate(XQuotePostsInputSchema, input, "getQuotePosts");
    return XProvider.page(await this.call("getQuotePosts", xList(XPostSchema), (sdk) => sdk.posts.getQuoted(id, o)));
  }

  /** GET /2/tweets/:id/retweeted_by */
  async getRepostedBy(input: z.input<ReturnType<typeof XPostUsersInputSchema>>) {
    const { id, ...o } = this.validate(XPostUsersInputSchema({ min: 1, max: 100 }), input, "getRepostedBy");
    return XProvider.page(await this.call("getRepostedBy", xList(XUserSchema), (sdk) => sdk.posts.getRepostedBy(id, o)));
  }

  /** GET /2/tweets/:id/liking_users */
  async getLikingUsers(input: z.input<ReturnType<typeof XPostUsersInputSchema>>) {
    const { id, ...o } = this.validate(XPostUsersInputSchema({ min: 1, max: 100 }), input, "getLikingUsers");
    return XProvider.page(await this.call("getLikingUsers", xList(XUserSchema), (sdk) => sdk.posts.getLikingUsers(id, o)));
  }

  /** PUT /2/tweets/:id/hidden — hide/unhide a reply to the user's own conversation. */
  async hideReply(input: z.input<typeof XHideReplyInputSchema>) {
    const v = this.validate(XHideReplyInputSchema, input, "hideReply");
    return this.call("hideReply", XActionResultSchema, (sdk) => sdk.posts.hideReply(v.replyId, { hidden: v.hidden }));
  }

  /** GET /2/tweets/search/recent (last 7 days) */
  async searchRecentPosts(input: XSearchRecentInput) {
    const { query, ...o } = this.validate(XSearchRecentInputSchema, input, "searchRecentPosts");
    const res = await this.call("searchRecentPosts", xList(XPostSchema), (sdk) => sdk.posts.searchRecent(query, o));
    return XProvider.page(res);
  }

  /** GET /2/tweets/search/all (full archive — Pro/Enterprise only) */
  async searchAllPosts(input: XSearchAllInput) {
    const { query, ...o } = this.validate(XSearchAllInputSchema, input, "searchAllPosts");
    return XProvider.page(await this.call("searchAllPosts", xList(XPostSchema), (sdk) => sdk.posts.searchAll(query, o)));
  }

  /** GET /2/tweets/counts/recent */
  async getRecentPostCounts(input: XRecentCountsInput) {
    const { query, ...o } = this.validate(XRecentCountsInputSchema, input, "getRecentPostCounts");
    return this.call("getRecentPostCounts", XCountsSchema, (sdk) => sdk.posts.getCountsRecent(query, o));
  }

  /** Conversation thread via recent search `conversation_id:{id}` (last 7 days only). */
  async getConversation(input: XConversationInput) {
    const { conversationId, ...o } = this.validate(XConversationInputSchema, input, "getConversation");
    return this.searchRecentPosts({ ...o, query: `conversation_id:${conversationId}` });
  }

  /** POST /2/users/:id/retweets */
  async repost(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "repost");
    const me = await this.getAuthenticatedUserId();
    return this.call("repost", XActionResultSchema, (sdk) => sdk.users.repostPost(me, { tweetId: v.postId }));
  }

  /** DELETE /2/users/:id/retweets/:source_tweet_id */
  async undoRepost(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "undoRepost");
    const me = await this.getAuthenticatedUserId();
    return this.call("undoRepost", XActionResultSchema, (sdk) => sdk.users.unrepostPost(me, v.postId));
  }

  /** POST /2/users/:id/likes (like.write) */
  async likePost(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "likePost");
    const me = await this.getAuthenticatedUserId();
    return this.call("likePost", XActionResultSchema, (sdk) => sdk.users.likePost(me, { tweetId: v.postId }));
  }

  /** DELETE /2/users/:id/likes/:tweet_id */
  async unlikePost(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "unlikePost");
    const me = await this.getAuthenticatedUserId();
    return this.call("unlikePost", XActionResultSchema, (sdk) => sdk.users.unlikePost(me, v.postId));
  }

  /** GET /2/users/:id/liked_tweets */
  async getLikedPosts(input: XLikedPostsInput = {}) {
    const { userId, ...o } = this.validate(XLikedPostsInputSchema, input, "getLikedPosts");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getLikedPosts", xList(XPostSchema), (sdk) => sdk.users.getLikedPosts(id, o)));
  }

  /** GET /2/users/:id/bookmarks (authenticated user only) */
  async getBookmarks(input: XBookmarksInput = {}) {
    const o = this.validate(XBookmarksInputSchema, input, "getBookmarks");
    const me = await this.getAuthenticatedUserId();
    return XProvider.page(await this.call("getBookmarks", xList(XPostSchema), (sdk) => sdk.users.getBookmarks(me, o)));
  }

  /** POST /2/users/:id/bookmarks */
  async bookmarkPost(input: z.input<typeof XBookmarkPostInputSchema>) {
    const v = this.validate(XBookmarkPostInputSchema, input, "bookmarkPost");
    const me = await this.getAuthenticatedUserId();
    return this.call("bookmarkPost", XActionResultSchema, (sdk) =>
      sdk.users.createBookmark(me, { tweetId: v.postId, folderId: v.folderId }),
    );
  }

  /** DELETE /2/users/:id/bookmarks/:tweet_id */
  async removeBookmark(postId: string) {
    const v = this.validate(XPostIdInputSchema, { postId }, "removeBookmark");
    const me = await this.getAuthenticatedUserId();
    return this.call("removeBookmark", XActionResultSchema, (sdk) => sdk.users.deleteBookmark(me, v.postId));
  }

  /** GET /2/users/:id/tweets (user timeline) */
  async getUserPosts(input: XUserPostsInput = {}) {
    const { userId, ...o } = this.validate(XUserPostsInputSchema, input, "getUserPosts");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getUserPosts", xList(XPostSchema), (sdk) => sdk.users.getPosts(id, o)));
  }

  /** GET /2/users/:id/mentions */
  async getUserMentions(input: XMentionsInput = {}) {
    const { userId, ...o } = this.validate(XMentionsInputSchema, input, "getUserMentions");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getUserMentions", xList(XPostSchema), (sdk) => sdk.users.getMentions(id, o)));
  }

  /** GET /2/users/:id/timelines/reverse_chronological (authenticated user's home timeline) */
  async getHomeTimeline(input: XHomeTimelineInput = {}) {
    const o = this.validate(XHomeTimelineInputSchema, input, "getHomeTimeline");
    const me = await this.getAuthenticatedUserId();
    return XProvider.page(await this.call("getHomeTimeline", xList(XPostSchema), (sdk) => sdk.users.getTimeline(me, o)));
  }

  // ================= media =================

  /** POST /2/media/upload — single request (images/GIFs; small media). */
  async uploadMedia(input: XUploadMediaInput) {
    const v = this.validate(XUploadMediaInputSchema, input, "uploadMedia");
    const bytes = await readAll(await openMediaStream(v.source, this.config.fetch));
    return this.call("uploadMedia", XMediaUploadResponseSchema, (sdk) =>
      sdk.media.upload({
        media: Buffer.from(bytes).toString("base64"),
        mediaCategory: v.mediaCategory,
        additionalOwners: v.additionalOwners?.join(","),
      }),
    );
  }

  /** POST /2/media/upload/initialize (chunked upload, step 1) */
  async initializeMediaUpload(input: XInitializeMediaUploadInput) {
    const v = this.validate(XInitializeMediaUploadInputSchema, input, "initializeMediaUpload");
    return this.call("initializeMediaUpload", XMediaUploadResponseSchema, (sdk) => sdk.media.initializeUpload(v));
  }

  /** POST /2/media/upload/:id/append (chunked upload, step 2; one segment) */
  async appendMediaUpload(input: z.input<typeof XAppendMediaUploadInputSchema>) {
    const v = this.validate(XAppendMediaUploadInputSchema, input, "appendMediaUpload");
    return this.call("appendMediaUpload", XActionResultSchema, (sdk) =>
      sdk.media.appendUpload(v.mediaId, { media: Buffer.from(v.data).toString("base64"), segmentIndex: v.segmentIndex }),
    );
  }

  /** POST /2/media/upload/:id/finalize (chunked upload, step 3) */
  async finalizeMediaUpload(mediaId: string) {
    const id = this.validate(XIdSchema, mediaId, "finalizeMediaUpload");
    return this.call("finalizeMediaUpload", XMediaUploadResponseSchema, (sdk) => sdk.media.finalizeUpload(id));
  }

  /** GET /2/media/upload?command=STATUS&media_id= (async processing state) */
  async getMediaUploadStatus(mediaId: string) {
    const id = this.validate(XIdSchema, mediaId, "getMediaUploadStatus");
    return this.call("getMediaUploadStatus", XMediaUploadResponseSchema, (sdk) =>
      sdk.media.getUploadStatus(id, { command: "STATUS" }),
    );
  }

  /** POST /2/media/metadata — alt text for uploaded media. */
  async setMediaAltText(input: z.input<typeof XMediaAltTextInputSchema>) {
    const v = this.validate(XMediaAltTextInputSchema, input, "setMediaAltText");
    return this.call("setMediaAltText", XActionResultSchema, (sdk) =>
      sdk.media.createMetadata({ id: v.mediaId, metadata: { altText: { text: v.altText } } }),
    );
  }

  /**
   * Chunked upload (videos, GIFs, large images): INIT → APPEND segments
   * (streamed, one chunk in memory) → FINALIZE → poll STATUS until
   * `succeeded`. Returns the media id for createPost({ media: { mediaIds } }).
   */
  async uploadMediaChunked(input: XUploadMediaChunkedInput): Promise<{ mediaId: string; mediaKey: string | null }> {
    const v = this.validate(XUploadMediaChunkedInputSchema, input, "uploadMediaChunked");
    const source = await openMediaStream(v.source, this.config.fetch);
    const totalBytes = source.type === "buffer" ? source.data.byteLength : source.size;
    const init = await this.initializeMediaUpload({
      mediaType: v.mediaType,
      totalBytes,
      mediaCategory: v.mediaCategory,
      additionalOwners: v.additionalOwners,
    });
    const mediaId = init.data?.id;
    if (!mediaId) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "INIT returned no media id" });

    for await (const chunk of readChunks(source, X_MEDIA_CHUNK_BYTES)) {
      await this.appendMediaUpload({ mediaId, segmentIndex: chunk.index, data: chunk.data });
    }
    let status = await this.finalizeMediaUpload(mediaId);
    const sleep = this.config.sleep ?? sleepDefault;
    const deadline = Date.now() + v.processingTimeoutMs;
    while (v.waitForProcessing && status.data?.processingInfo && status.data.processingInfo.state !== "succeeded") {
      const info = status.data.processingInfo;
      if (info.state === "failed") {
        throw new ProviderError({ provider: this.name, code: "PROVIDER_ERROR", message: "X media processing failed", details: info });
      }
      if (Date.now() > deadline) {
        throw new ProviderError({ provider: this.name, code: "TIMEOUT", message: "X media processing timed out" });
      }
      await sleep(Math.max(1, info.checkAfterSecs ?? 5) * 1000);
      status = await this.getMediaUploadStatus(mediaId);
    }
    return { mediaId, mediaKey: status.data?.mediaKey ?? init.data?.mediaKey ?? null };
  }

  // ================= lists =================

  /** POST /2/lists */
  async createList(input: XCreateListInput) {
    const v = this.validate(XCreateListInputSchema, input, "createList");
    return this.call("createList", xSingle(XListSchema), (sdk) => sdk.lists.create(v));
  }

  /** PUT /2/lists/:id */
  async updateList(input: XUpdateListInput) {
    const { listId, ...body } = this.validate(XUpdateListInputSchema, input, "updateList");
    return this.call("updateList", XActionResultSchema, (sdk) => sdk.lists.update(listId, body));
  }

  /** DELETE /2/lists/:id */
  async deleteList(listId: string) {
    const v = this.validate(XListIdInputSchema, { listId }, "deleteList");
    return this.call("deleteList", XActionResultSchema, (sdk) => sdk.lists.delete(v.listId));
  }

  /** GET /2/lists/:id */
  async getList(input: XGetListInput) {
    const { listId, ...o } = this.validate(XGetListInputSchema, input, "getList");
    return this.call("getList", xSingle(XListSchema), (sdk) => sdk.lists.getById(listId, o));
  }

  /** GET /2/lists/:id/members */
  async getListMembers(input: XListMembersInput) {
    const { listId, ...o } = this.validate(XListMembersInputSchema, input, "getListMembers");
    return XProvider.page(await this.call("getListMembers", xList(XUserSchema), (sdk) => sdk.lists.getMembers(listId, o)));
  }

  /** POST /2/lists/:id/members */
  async addListMember(input: z.input<typeof XListMemberInputSchema>) {
    const v = this.validate(XListMemberInputSchema, input, "addListMember");
    return this.call("addListMember", XActionResultSchema, (sdk) => sdk.lists.addMember(v.listId, { userId: v.userId }));
  }

  /** DELETE /2/lists/:id/members/:user_id */
  async removeListMember(input: z.input<typeof XListMemberInputSchema>) {
    const v = this.validate(XListMemberInputSchema, input, "removeListMember");
    return this.call("removeListMember", XActionResultSchema, (sdk) => sdk.lists.removeMemberByUserId(v.listId, v.userId));
  }

  /** GET /2/lists/:id/tweets */
  async getListPosts(input: XListPostsInput) {
    const { listId, ...o } = this.validate(XListPostsInputSchema, input, "getListPosts");
    return XProvider.page(await this.call("getListPosts", xList(XPostSchema), (sdk) => sdk.lists.getPosts(listId, o)));
  }

  /** GET /2/lists/:id/followers */
  async getListFollowers(input: XListMembersInput) {
    const { listId, ...o } = this.validate(XListMembersInputSchema, input, "getListFollowers");
    return XProvider.page(await this.call("getListFollowers", xList(XUserSchema), (sdk) => sdk.lists.getFollowers(listId, o)));
  }

  /** GET /2/users/:id/owned_lists */
  async getOwnedLists(input: XUserListsInput = {}) {
    const { userId, ...o } = this.validate(XUserListsInputSchema, input, "getOwnedLists");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getOwnedLists", xList(XListSchema), (sdk) => sdk.users.getOwnedLists(id, o)));
  }

  /** GET /2/users/:id/followed_lists */
  async getFollowedLists(input: XUserListsInput = {}) {
    const { userId, ...o } = this.validate(XUserListsInputSchema, input, "getFollowedLists");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getFollowedLists", xList(XListSchema), (sdk) => sdk.users.getFollowedLists(id, o)));
  }

  /** GET /2/users/:id/list_memberships */
  async getListMemberships(input: XUserListsInput = {}) {
    const { userId, ...o } = this.validate(XUserListsInputSchema, input, "getListMemberships");
    const id = userId ?? (await this.getAuthenticatedUserId());
    return XProvider.page(await this.call("getListMemberships", xList(XListSchema), (sdk) => sdk.users.getListMemberships(id, o)));
  }

  /** POST /2/users/:id/followed_lists */
  async followList(listId: string) {
    const v = this.validate(XListIdInputSchema, { listId }, "followList");
    const me = await this.getAuthenticatedUserId();
    return this.call("followList", XActionResultSchema, (sdk) => sdk.users.followList(me, { listId: v.listId }));
  }

  /** DELETE /2/users/:id/followed_lists/:list_id */
  async unfollowList(listId: string) {
    const v = this.validate(XListIdInputSchema, { listId }, "unfollowList");
    const me = await this.getAuthenticatedUserId();
    return this.call("unfollowList", XActionResultSchema, (sdk) => sdk.users.unfollowList(me, v.listId));
  }

  /** GET /2/users/:id/pinned_lists */
  async getPinnedLists(input: z.input<typeof XPinnedListsInputSchema> = {}) {
    const o = this.validate(XPinnedListsInputSchema, input, "getPinnedLists");
    const me = await this.getAuthenticatedUserId();
    return this.call("getPinnedLists", xList(XListSchema), (sdk) => sdk.users.getPinnedLists(me, o));
  }

  /** POST /2/users/:id/pinned_lists */
  async pinList(listId: string) {
    const v = this.validate(XListIdInputSchema, { listId }, "pinList");
    const me = await this.getAuthenticatedUserId();
    return this.call("pinList", XActionResultSchema, (sdk) => sdk.users.pinList(me, { listId: v.listId }));
  }

  /** DELETE /2/users/:id/pinned_lists/:list_id */
  async unpinList(listId: string) {
    const v = this.validate(XListIdInputSchema, { listId }, "unpinList");
    const me = await this.getAuthenticatedUserId();
    return this.call("unpinList", XActionResultSchema, (sdk) => sdk.users.unpinList(me, v.listId));
  }

  // ================= spaces (read-only in the API) =================

  /** GET /2/spaces/:id */
  async getSpace(input: XGetSpaceInput) {
    const { spaceId, ...o } = this.validate(XGetSpaceInputSchema, input, "getSpace");
    return this.call("getSpace", xSingle(XSpaceSchema), (sdk) => sdk.spaces.getById(spaceId, o));
  }

  /** GET /2/spaces?ids= */
  async getSpaces(input: XGetSpacesInput) {
    const { spaceIds, ...o } = this.validate(XGetSpacesInputSchema, input, "getSpaces");
    return this.call("getSpaces", xList(XSpaceSchema), (sdk) => sdk.spaces.getByIds(spaceIds, o));
  }

  /** GET /2/spaces/by/creator_ids */
  async getSpacesByCreators(input: XSpacesByCreatorsInput) {
    const { userIds, ...o } = this.validate(XSpacesByCreatorsInputSchema, input, "getSpacesByCreators");
    return this.call("getSpacesByCreators", xList(XSpaceSchema), (sdk) => sdk.spaces.getByCreatorIds(userIds, o));
  }

  /** GET /2/spaces/search */
  async searchSpaces(input: XSearchSpacesInput) {
    const { query, ...o } = this.validate(XSearchSpacesInputSchema, input, "searchSpaces");
    return this.call("searchSpaces", xList(XSpaceSchema), (sdk) => sdk.spaces.search(query, o));
  }

  /** GET /2/spaces/:id/tweets */
  async getSpacePosts(input: XSpacePostsInput) {
    const { spaceId, ...o } = this.validate(XSpacePostsInputSchema, input, "getSpacePosts");
    return this.call("getSpacePosts", xList(XPostSchema), (sdk) => sdk.spaces.getPosts(spaceId, o));
  }

  /** GET /2/spaces/:id/buyers (ticketed Spaces created by the user) */
  async getSpaceBuyers(input: XSpaceBuyersInput) {
    const { spaceId, ...o } = this.validate(XSpaceBuyersInputSchema, input, "getSpaceBuyers");
    return XProvider.page(await this.call("getSpaceBuyers", xList(XUserSchema), (sdk) => sdk.spaces.getBuyers(spaceId, o)));
  }

  // ================= direct messages (dm.read / dm.write) =================

  /** GET /2/dm_events */
  async getDmEvents(input: XDmEventsInput = {}) {
    const o = this.validate(XDmEventsInputSchema, input, "getDmEvents");
    return XProvider.page(await this.call("getDmEvents", xList(XDmEventSchema), (sdk) => sdk.directMessages.getEvents(o)));
  }

  /** GET /2/dm_events/:event_id */
  async getDmEvent(input: XDmEventInput) {
    const { eventId, ...o } = this.validate(XDmEventInputSchema, input, "getDmEvent");
    return this.call("getDmEvent", xSingle(XDmEventSchema), (sdk) => sdk.directMessages.getEventsById(eventId, o));
  }

  /** DELETE /2/dm_events/:event_id */
  async deleteDmEvent(eventId: string) {
    const id = this.validate(XIdSchema, eventId, "deleteDmEvent");
    return this.call("deleteDmEvent", XActionResultSchema, (sdk) => sdk.directMessages.deleteEvents(id));
  }

  /** GET /2/dm_conversations/:id/dm_events */
  async getDmConversationEvents(input: XDmConversationEventsInput) {
    const { conversationId, ...o } = this.validate(XDmConversationEventsInputSchema, input, "getDmConversationEvents");
    const res = await this.call("getDmConversationEvents", xList(XDmEventSchema), (sdk) =>
      sdk.directMessages.getEventsByConversationId(conversationId, o),
    );
    return XProvider.page(res);
  }

  /** GET /2/dm_conversations/with/:participant_id/dm_events */
  async getDmEventsWithParticipant(input: XDmParticipantEventsInput) {
    const { participantId, ...o } = this.validate(XDmParticipantEventsInputSchema, input, "getDmEventsWithParticipant");
    const res = await this.call("getDmEventsWithParticipant", xList(XDmEventSchema), (sdk) =>
      sdk.directMessages.getEventsByParticipantId(participantId, o),
    );
    return XProvider.page(res);
  }

  /** POST /2/dm_conversations/:dm_conversation_id/messages */
  async sendDmToConversation(input: XSendDmToConversationInput) {
    const v = this.validate(XSendDmToConversationInputSchema, input, "sendDmToConversation");
    return this.call("sendDmToConversation", XActionResultSchema, (sdk) =>
      sdk.directMessages.createByConversationId(v.conversationId, v.message),
    );
  }

  /** POST /2/dm_conversations/with/:participant_id/messages (1:1) */
  async sendDmToParticipant(input: XSendDmToParticipantInput) {
    const v = this.validate(XSendDmToParticipantInputSchema, input, "sendDmToParticipant");
    return this.call("sendDmToParticipant", XActionResultSchema, (sdk) =>
      sdk.directMessages.createByParticipantId(v.participantId, v.message),
    );
  }

  /** POST /2/dm_conversations (group conversation) */
  async createDmGroupConversation(input: XCreateDmGroupInput) {
    const v = this.validate(XCreateDmGroupInputSchema, input, "createDmGroupConversation");
    return this.call("createDmGroupConversation", XActionResultSchema, (sdk) =>
      sdk.directMessages.createConversation({ conversationType: "Group", participantIds: v.participantIds, message: v.message }),
    );
  }
}
