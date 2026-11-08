import { youtube, type MethodOptions, type youtube_v3 } from "@googleapis/youtube";
import type { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { googleErrorStatus, normalizeGoogleError, toGoogleMedia } from "../common/google";
import type { MediaSource } from "../common/media";
import { ProviderError } from "../common/provider-error";
import { DEFAULT_RETRY, DEFAULT_TIMEOUT_MS, type BaseProviderConfig, type ProviderAccount } from "../common/provider.types";
import { computeRetryDelayMs } from "../common/rate-limit";
import { sendUploadRequest, uploadResponseError } from "../common/upload-request";
import { YouTubeEndpoints } from "./endpoints";
import * as M from "./model";

export interface YouTubeProviderConfig extends BaseProviderConfig {
  /** The connected YouTube channel (provider_account_id). */
  channelId?: string;
  /** Google account subject that granted access — distinct from the channel. */
  googleSubject?: string;
  /** Inject a preconfigured googleapis client (tests). */
  sdk?: youtube_v3.Youtube;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * YouTube Data API v3 (including Live Streaming resources) through the
 * official googleapis client. One method per SDK endpoint, generated from the
 * SDK typings; inputs are validated with the generated Zod schemas and
 * responses parsed before returning.
 */
export class YouTubeProvider extends BaseProvider<YouTubeProviderConfig> {
  readonly name = "YOUTUBE" as const;
  readonly sdk: youtube_v3.Youtube;
  readonly channelId: string | undefined;
  readonly googleSubject: string | undefined;

  constructor(config: YouTubeProviderConfig) {
    super(config);
    this.channelId = config.channelId;
    this.googleSubject = config.googleSubject;
    this.sdk =
      config.sdk ??
      youtube({
        version: "v3",
        timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        retry: false, // retries are handled in call() so 401 refresh and backoff are consistent
        ...(config.fetch ? { fetchImplementation: config.fetch as typeof fetch } : {}),
      });
  }

  private methodFor(id: string): string {
    return Object.values(YouTubeEndpoints).find((e) => e.sdk === id)?.http.split(" ")[0] ?? "POST";
  }

  /** Runs an SDK call with a fresh bearer token, 401 refresh, retries and response validation. */
  private async call<S extends z.ZodType | null>(
    id: string,
    schema: S,
    run: (sdk: youtube_v3.Youtube, options: MethodOptions) => Promise<{ data: unknown }>,
  ): Promise<S extends z.ZodType ? z.output<S> : void> {
    const retry = { ...DEFAULT_RETRY, ...this.config.retry };
    const sleep = this.config.sleep ?? sleepDefault;
    const idempotent = ["GET", "PUT", "DELETE"].includes(this.methodFor(id));
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getAccessToken();
      try {
        const res = await run(this.sdk, { headers: { Authorization: `Bearer ${token}` } });
        return (schema ? this.parseResponse(schema, res.data, id) : undefined) as never;
      } catch (error) {
        const status = googleErrorStatus(error);
        if (status === 401 && !refreshed && this.tokens.canRefresh) {
          refreshed = true;
          if (await this.tokens.refresh()) {
            attempt -= 1;
            continue;
          }
        }
        const err = normalizeGoogleError(this.name, error);
        if ((status === 429 || (idempotent && err.retryable)) && attempt < retry.maxRetries) {
          await sleep(computeRetryDelayMs(attempt, err.rateLimit, retry));
          continue;
        }
        throw err;
      }
    }
  }

  private mediaBody(source: MediaSource) {
    return toGoogleMedia(source, this.config.fetch);
  }

  /** The connected channel (channels.list mine=true, or by channelId). */
  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const res = await this.listChannels(
      this.channelId ? { part: ["snippet"], id: [this.channelId] } : { part: ["snippet"], mine: true },
    );
    const channel = res.items?.[0];
    if (!channel?.id) throw new ProviderError({ provider: this.name, code: "NOT_FOUND", message: "No YouTube channel found" });
    const thumbs = channel.snippet?.thumbnails;
    return {
      provider: this.name,
      id: channel.id,
      username: channel.snippet?.customUrl ?? null,
      displayName: channel.snippet?.title ?? null,
      profilePictureUrl: thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url ?? null,
    };
  }

  /** GET /youtube/v3/captions/{id} — downloads a caption track's bytes (SDK `captions.download`). */
  async downloadCaption(input: M.YouTubeDownloadCaptionInput): Promise<Uint8Array> {
    const params = this.validate(M.YouTubeDownloadCaptionInputSchema, input, "captions.download");
    const token = await this.tokens.getAccessToken();
    try {
      const res = await this.sdk.captions.download(params, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "arraybuffer",
      });
      return new Uint8Array(res.data as unknown as ArrayBuffer);
    } catch (error) {
      throw normalizeGoogleError(this.name, error);
    }
  }

  // <generated-methods>
  // Generated by scripts/generate-google.mjs — do not edit between the markers.

  /** POST /youtube/v3/abuseReports — SDK `abuseReports.insert`. Required: part. */
  async insertAbuseReport(input: M.YouTubeAbuseReportsInsertInput): Promise<M.YouTubeAbuseReport> {
    const params = this.validate(M.YouTubeAbuseReportsInsertInputSchema, input, "abuseReports.insert");
    return this.call("abuseReports.insert", M.YouTubeAbuseReportSchema, (sdk, options) => sdk.abuseReports.insert(params, options));
  }

  /** GET /youtube/v3/activities — SDK `activities.list`. Required: part. */
  async listActivities(input: M.YouTubeActivitiesListInput): Promise<M.YouTubeActivityListResponse> {
    const params = this.validate(M.YouTubeActivitiesListInputSchema, input, "activities.list");
    return this.call("activities.list", M.YouTubeActivityListResponseSchema, (sdk, options) => sdk.activities.list(params, options));
  }

  /** DELETE /youtube/v3/captions — SDK `captions.delete`. Required: id. */
  async deleteCaption(input: M.YouTubeCaptionsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeCaptionsDeleteInputSchema, input, "captions.delete");
    return this.call("captions.delete", null, (sdk, options) => sdk.captions.delete(params, options));
  }

  /** POST /youtube/v3/captions — SDK `captions.insert`. Required: part. Upload: POST /upload/youtube/v3/captions. */
  async insertCaption(input: M.YouTubeCaptionsInsertInput): Promise<M.YouTubeCaption> {
    const { media, ...params } = this.validate(M.YouTubeCaptionsInsertInputSchema, input, "captions.insert");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("captions.insert", M.YouTubeCaptionSchema, (sdk, options) => sdk.captions.insert({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** GET /youtube/v3/captions — SDK `captions.list`. Required: part, videoId. */
  async listCaption(input: M.YouTubeCaptionsListInput): Promise<M.YouTubeCaptionListResponse> {
    const params = this.validate(M.YouTubeCaptionsListInputSchema, input, "captions.list");
    return this.call("captions.list", M.YouTubeCaptionListResponseSchema, (sdk, options) => sdk.captions.list(params, options));
  }

  /** PUT /youtube/v3/captions — SDK `captions.update`. Required: part. Upload: POST /upload/youtube/v3/captions. */
  async updateCaption(input: M.YouTubeCaptionsUpdateInput): Promise<M.YouTubeCaption> {
    const { media, ...params } = this.validate(M.YouTubeCaptionsUpdateInputSchema, input, "captions.update");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("captions.update", M.YouTubeCaptionSchema, (sdk, options) => sdk.captions.update({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** POST /youtube/v3/channelBanners/insert — SDK `channelBanners.insert`. Upload: POST /upload/youtube/v3/channelBanners/insert. */
  async insertChannelBanner(input: M.YouTubeChannelBannersInsertInput): Promise<M.YouTubeChannelBannerResource> {
    const { media, ...params } = this.validate(M.YouTubeChannelBannersInsertInputSchema, input, "channelBanners.insert");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("channelBanners.insert", M.YouTubeChannelBannerResourceSchema, (sdk, options) => sdk.channelBanners.insert({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** GET /youtube/v3/channels — SDK `channels.list`. Required: part. */
  async listChannels(input: M.YouTubeChannelsListInput): Promise<M.YouTubeChannelListResponse> {
    const params = this.validate(M.YouTubeChannelsListInputSchema, input, "channels.list");
    return this.call("channels.list", M.YouTubeChannelListResponseSchema, (sdk, options) => sdk.channels.list(params, options));
  }

  /** PUT /youtube/v3/channels — SDK `channels.update`. Required: part. */
  async updateChannels(input: M.YouTubeChannelsUpdateInput): Promise<M.YouTubeChannel> {
    const params = this.validate(M.YouTubeChannelsUpdateInputSchema, input, "channels.update");
    return this.call("channels.update", M.YouTubeChannelSchema, (sdk, options) => sdk.channels.update(params, options));
  }

  /** DELETE /youtube/v3/channelSections — SDK `channelSections.delete`. Required: id. */
  async deleteChannelSection(input: M.YouTubeChannelSectionsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeChannelSectionsDeleteInputSchema, input, "channelSections.delete");
    return this.call("channelSections.delete", null, (sdk, options) => sdk.channelSections.delete(params, options));
  }

  /** POST /youtube/v3/channelSections — SDK `channelSections.insert`. Required: part. */
  async insertChannelSection(input: M.YouTubeChannelSectionsInsertInput): Promise<M.YouTubeChannelSection> {
    const params = this.validate(M.YouTubeChannelSectionsInsertInputSchema, input, "channelSections.insert");
    return this.call("channelSections.insert", M.YouTubeChannelSectionSchema, (sdk, options) => sdk.channelSections.insert(params, options));
  }

  /** GET /youtube/v3/channelSections — SDK `channelSections.list`. Required: part. */
  async listChannelSection(input: M.YouTubeChannelSectionsListInput): Promise<M.YouTubeChannelSectionListResponse> {
    const params = this.validate(M.YouTubeChannelSectionsListInputSchema, input, "channelSections.list");
    return this.call("channelSections.list", M.YouTubeChannelSectionListResponseSchema, (sdk, options) => sdk.channelSections.list(params, options));
  }

  /** PUT /youtube/v3/channelSections — SDK `channelSections.update`. Required: part. */
  async updateChannelSection(input: M.YouTubeChannelSectionsUpdateInput): Promise<M.YouTubeChannelSection> {
    const params = this.validate(M.YouTubeChannelSectionsUpdateInputSchema, input, "channelSections.update");
    return this.call("channelSections.update", M.YouTubeChannelSectionSchema, (sdk, options) => sdk.channelSections.update(params, options));
  }

  /** DELETE /youtube/v3/comments — SDK `comments.delete`. Required: id. */
  async deleteComment(input: M.YouTubeCommentsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeCommentsDeleteInputSchema, input, "comments.delete");
    return this.call("comments.delete", null, (sdk, options) => sdk.comments.delete(params, options));
  }

  /** POST /youtube/v3/comments — SDK `comments.insert`. Required: part. */
  async insertComment(input: M.YouTubeCommentsInsertInput): Promise<M.YouTubeComment> {
    const params = this.validate(M.YouTubeCommentsInsertInputSchema, input, "comments.insert");
    return this.call("comments.insert", M.YouTubeCommentSchema, (sdk, options) => sdk.comments.insert(params, options));
  }

  /** GET /youtube/v3/comments — SDK `comments.list`. Required: part. */
  async listComment(input: M.YouTubeCommentsListInput): Promise<M.YouTubeCommentListResponse> {
    const params = this.validate(M.YouTubeCommentsListInputSchema, input, "comments.list");
    return this.call("comments.list", M.YouTubeCommentListResponseSchema, (sdk, options) => sdk.comments.list(params, options));
  }

  /** POST /youtube/v3/comments/markAsSpam — SDK `comments.markAsSpam`. Required: id. */
  async markAsSpamComment(input: M.YouTubeCommentsMarkAsSpamInput): Promise<void> {
    const params = this.validate(M.YouTubeCommentsMarkAsSpamInputSchema, input, "comments.markAsSpam");
    return this.call("comments.markAsSpam", null, (sdk, options) => sdk.comments.markAsSpam(params, options));
  }

  /** POST /youtube/v3/comments/setModerationStatus — SDK `comments.setModerationStatus`. Required: id, moderationStatus. */
  async setModerationStatusComment(input: M.YouTubeCommentsSetModerationStatusInput): Promise<void> {
    const params = this.validate(M.YouTubeCommentsSetModerationStatusInputSchema, input, "comments.setModerationStatus");
    return this.call("comments.setModerationStatus", null, (sdk, options) => sdk.comments.setModerationStatus(params, options));
  }

  /** PUT /youtube/v3/comments — SDK `comments.update`. Required: part. */
  async updateComment(input: M.YouTubeCommentsUpdateInput): Promise<M.YouTubeComment> {
    const params = this.validate(M.YouTubeCommentsUpdateInputSchema, input, "comments.update");
    return this.call("comments.update", M.YouTubeCommentSchema, (sdk, options) => sdk.comments.update(params, options));
  }

  /** POST /youtube/v3/commentThreads — SDK `commentThreads.insert`. Required: part. */
  async insertCommentThread(input: M.YouTubeCommentThreadsInsertInput): Promise<M.YouTubeCommentThread> {
    const params = this.validate(M.YouTubeCommentThreadsInsertInputSchema, input, "commentThreads.insert");
    return this.call("commentThreads.insert", M.YouTubeCommentThreadSchema, (sdk, options) => sdk.commentThreads.insert(params, options));
  }

  /** GET /youtube/v3/commentThreads — SDK `commentThreads.list`. Required: part. */
  async listCommentThread(input: M.YouTubeCommentThreadsListInput): Promise<M.YouTubeCommentThreadListResponse> {
    const params = this.validate(M.YouTubeCommentThreadsListInputSchema, input, "commentThreads.list");
    return this.call("commentThreads.list", M.YouTubeCommentThreadListResponseSchema, (sdk, options) => sdk.commentThreads.list(params, options));
  }

  /** GET /youtube/v3/i18nLanguages — SDK `i18nLanguages.list`. Required: part. */
  async listI18nLanguages(input: M.YouTubeI18nLanguagesListInput): Promise<M.YouTubeI18nLanguageListResponse> {
    const params = this.validate(M.YouTubeI18nLanguagesListInputSchema, input, "i18nLanguages.list");
    return this.call("i18nLanguages.list", M.YouTubeI18nLanguageListResponseSchema, (sdk, options) => sdk.i18nLanguages.list(params, options));
  }

  /** GET /youtube/v3/i18nRegions — SDK `i18nRegions.list`. Required: part. */
  async listI18nRegions(input: M.YouTubeI18nRegionsListInput): Promise<M.YouTubeI18nRegionListResponse> {
    const params = this.validate(M.YouTubeI18nRegionsListInputSchema, input, "i18nRegions.list");
    return this.call("i18nRegions.list", M.YouTubeI18nRegionListResponseSchema, (sdk, options) => sdk.i18nRegions.list(params, options));
  }

  /** POST /youtube/v3/liveBroadcasts/bind — SDK `liveBroadcasts.bind`. Required: id, part. */
  async bindLiveBroadcast(input: M.YouTubeLiveBroadcastsBindInput): Promise<M.YouTubeLiveBroadcast> {
    const params = this.validate(M.YouTubeLiveBroadcastsBindInputSchema, input, "liveBroadcasts.bind");
    return this.call("liveBroadcasts.bind", M.YouTubeLiveBroadcastSchema, (sdk, options) => sdk.liveBroadcasts.bind(params, options));
  }

  /** DELETE /youtube/v3/liveBroadcasts — SDK `liveBroadcasts.delete`. Required: id. */
  async deleteLiveBroadcast(input: M.YouTubeLiveBroadcastsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeLiveBroadcastsDeleteInputSchema, input, "liveBroadcasts.delete");
    return this.call("liveBroadcasts.delete", null, (sdk, options) => sdk.liveBroadcasts.delete(params, options));
  }

  /** POST /youtube/v3/liveBroadcasts — SDK `liveBroadcasts.insert`. Required: part. */
  async insertLiveBroadcast(input: M.YouTubeLiveBroadcastsInsertInput): Promise<M.YouTubeLiveBroadcast> {
    const params = this.validate(M.YouTubeLiveBroadcastsInsertInputSchema, input, "liveBroadcasts.insert");
    return this.call("liveBroadcasts.insert", M.YouTubeLiveBroadcastSchema, (sdk, options) => sdk.liveBroadcasts.insert(params, options));
  }

  /** POST /youtube/v3/liveBroadcasts/cuepoint — SDK `liveBroadcasts.insertCuepoint`. */
  async insertCuepointLiveBroadcast(input: M.YouTubeLiveBroadcastsInsertCuepointInput): Promise<M.YouTubeCuepoint> {
    const params = this.validate(M.YouTubeLiveBroadcastsInsertCuepointInputSchema, input, "liveBroadcasts.insertCuepoint");
    return this.call("liveBroadcasts.insertCuepoint", M.YouTubeCuepointSchema, (sdk, options) => sdk.liveBroadcasts.insertCuepoint(params, options));
  }

  /** GET /youtube/v3/liveBroadcasts — SDK `liveBroadcasts.list`. Required: part. */
  async listLiveBroadcast(input: M.YouTubeLiveBroadcastsListInput): Promise<M.YouTubeLiveBroadcastListResponse> {
    const params = this.validate(M.YouTubeLiveBroadcastsListInputSchema, input, "liveBroadcasts.list");
    return this.call("liveBroadcasts.list", M.YouTubeLiveBroadcastListResponseSchema, (sdk, options) => sdk.liveBroadcasts.list(params, options));
  }

  /** POST /youtube/v3/liveBroadcasts/transition — SDK `liveBroadcasts.transition`. Required: broadcastStatus, id, part. */
  async transitionLiveBroadcast(input: M.YouTubeLiveBroadcastsTransitionInput): Promise<M.YouTubeLiveBroadcast> {
    const params = this.validate(M.YouTubeLiveBroadcastsTransitionInputSchema, input, "liveBroadcasts.transition");
    return this.call("liveBroadcasts.transition", M.YouTubeLiveBroadcastSchema, (sdk, options) => sdk.liveBroadcasts.transition(params, options));
  }

  /** PUT /youtube/v3/liveBroadcasts — SDK `liveBroadcasts.update`. Required: part. */
  async updateLiveBroadcast(input: M.YouTubeLiveBroadcastsUpdateInput): Promise<M.YouTubeLiveBroadcast> {
    const params = this.validate(M.YouTubeLiveBroadcastsUpdateInputSchema, input, "liveBroadcasts.update");
    return this.call("liveBroadcasts.update", M.YouTubeLiveBroadcastSchema, (sdk, options) => sdk.liveBroadcasts.update(params, options));
  }

  /** DELETE /youtube/v3/liveChat/bans — SDK `liveChatBans.delete`. Required: id. */
  async deleteLiveChatBan(input: M.YouTubeLiveChatBansDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeLiveChatBansDeleteInputSchema, input, "liveChatBans.delete");
    return this.call("liveChatBans.delete", null, (sdk, options) => sdk.liveChatBans.delete(params, options));
  }

  /** POST /youtube/v3/liveChat/bans — SDK `liveChatBans.insert`. Required: part. */
  async insertLiveChatBan(input: M.YouTubeLiveChatBansInsertInput): Promise<M.YouTubeLiveChatBan> {
    const params = this.validate(M.YouTubeLiveChatBansInsertInputSchema, input, "liveChatBans.insert");
    return this.call("liveChatBans.insert", M.YouTubeLiveChatBanSchema, (sdk, options) => sdk.liveChatBans.insert(params, options));
  }

  /** DELETE /youtube/v3/liveChat/messages — SDK `liveChatMessages.delete`. Required: id. */
  async deleteLiveChatMessage(input: M.YouTubeLiveChatMessagesDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeLiveChatMessagesDeleteInputSchema, input, "liveChatMessages.delete");
    return this.call("liveChatMessages.delete", null, (sdk, options) => sdk.liveChatMessages.delete(params, options));
  }

  /** POST /youtube/v3/liveChat/messages — SDK `liveChatMessages.insert`. Required: part. */
  async insertLiveChatMessage(input: M.YouTubeLiveChatMessagesInsertInput): Promise<M.YouTubeLiveChatMessage> {
    const params = this.validate(M.YouTubeLiveChatMessagesInsertInputSchema, input, "liveChatMessages.insert");
    return this.call("liveChatMessages.insert", M.YouTubeLiveChatMessageSchema, (sdk, options) => sdk.liveChatMessages.insert(params, options));
  }

  /** GET /youtube/v3/liveChat/messages — SDK `liveChatMessages.list`. Required: liveChatId, part. */
  async listLiveChatMessage(input: M.YouTubeLiveChatMessagesListInput): Promise<M.YouTubeLiveChatMessageListResponse> {
    const params = this.validate(M.YouTubeLiveChatMessagesListInputSchema, input, "liveChatMessages.list");
    return this.call("liveChatMessages.list", M.YouTubeLiveChatMessageListResponseSchema, (sdk, options) => sdk.liveChatMessages.list(params, options));
  }

  /** POST /youtube/v3/liveChat/messages/transition — SDK `liveChatMessages.transition`. */
  async transitionLiveChatMessage(input: M.YouTubeLiveChatMessagesTransitionInput): Promise<M.YouTubeLiveChatMessage> {
    const params = this.validate(M.YouTubeLiveChatMessagesTransitionInputSchema, input, "liveChatMessages.transition");
    return this.call("liveChatMessages.transition", M.YouTubeLiveChatMessageSchema, (sdk, options) => sdk.liveChatMessages.transition(params, options));
  }

  /** DELETE /youtube/v3/liveChat/moderators — SDK `liveChatModerators.delete`. Required: id. */
  async deleteLiveChatModerator(input: M.YouTubeLiveChatModeratorsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeLiveChatModeratorsDeleteInputSchema, input, "liveChatModerators.delete");
    return this.call("liveChatModerators.delete", null, (sdk, options) => sdk.liveChatModerators.delete(params, options));
  }

  /** POST /youtube/v3/liveChat/moderators — SDK `liveChatModerators.insert`. Required: part. */
  async insertLiveChatModerator(input: M.YouTubeLiveChatModeratorsInsertInput): Promise<M.YouTubeLiveChatModerator> {
    const params = this.validate(M.YouTubeLiveChatModeratorsInsertInputSchema, input, "liveChatModerators.insert");
    return this.call("liveChatModerators.insert", M.YouTubeLiveChatModeratorSchema, (sdk, options) => sdk.liveChatModerators.insert(params, options));
  }

  /** GET /youtube/v3/liveChat/moderators — SDK `liveChatModerators.list`. Required: liveChatId, part. */
  async listLiveChatModerator(input: M.YouTubeLiveChatModeratorsListInput): Promise<M.YouTubeLiveChatModeratorListResponse> {
    const params = this.validate(M.YouTubeLiveChatModeratorsListInputSchema, input, "liveChatModerators.list");
    return this.call("liveChatModerators.list", M.YouTubeLiveChatModeratorListResponseSchema, (sdk, options) => sdk.liveChatModerators.list(params, options));
  }

  /** DELETE /youtube/v3/liveStreams — SDK `liveStreams.delete`. Required: id. */
  async deleteLiveStream(input: M.YouTubeLiveStreamsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeLiveStreamsDeleteInputSchema, input, "liveStreams.delete");
    return this.call("liveStreams.delete", null, (sdk, options) => sdk.liveStreams.delete(params, options));
  }

  /** POST /youtube/v3/liveStreams — SDK `liveStreams.insert`. Required: part. */
  async insertLiveStream(input: M.YouTubeLiveStreamsInsertInput): Promise<M.YouTubeLiveStream> {
    const params = this.validate(M.YouTubeLiveStreamsInsertInputSchema, input, "liveStreams.insert");
    return this.call("liveStreams.insert", M.YouTubeLiveStreamSchema, (sdk, options) => sdk.liveStreams.insert(params, options));
  }

  /** GET /youtube/v3/liveStreams — SDK `liveStreams.list`. Required: part. */
  async listLiveStream(input: M.YouTubeLiveStreamsListInput): Promise<M.YouTubeLiveStreamListResponse> {
    const params = this.validate(M.YouTubeLiveStreamsListInputSchema, input, "liveStreams.list");
    return this.call("liveStreams.list", M.YouTubeLiveStreamListResponseSchema, (sdk, options) => sdk.liveStreams.list(params, options));
  }

  /** PUT /youtube/v3/liveStreams — SDK `liveStreams.update`. Required: part. */
  async updateLiveStream(input: M.YouTubeLiveStreamsUpdateInput): Promise<M.YouTubeLiveStream> {
    const params = this.validate(M.YouTubeLiveStreamsUpdateInputSchema, input, "liveStreams.update");
    return this.call("liveStreams.update", M.YouTubeLiveStreamSchema, (sdk, options) => sdk.liveStreams.update(params, options));
  }

  /** GET /youtube/v3/members — SDK `members.list`. Required: part. */
  async listMembers(input: M.YouTubeMembersListInput): Promise<M.YouTubeMemberListResponse> {
    const params = this.validate(M.YouTubeMembersListInputSchema, input, "members.list");
    return this.call("members.list", M.YouTubeMemberListResponseSchema, (sdk, options) => sdk.members.list(params, options));
  }

  /** GET /youtube/v3/membershipsLevels — SDK `membershipsLevels.list`. Required: part. */
  async listMembershipsLevels(input: M.YouTubeMembershipsLevelsListInput): Promise<M.YouTubeMembershipsLevelListResponse> {
    const params = this.validate(M.YouTubeMembershipsLevelsListInputSchema, input, "membershipsLevels.list");
    return this.call("membershipsLevels.list", M.YouTubeMembershipsLevelListResponseSchema, (sdk, options) => sdk.membershipsLevels.list(params, options));
  }

  /** DELETE /youtube/v3/playlistImages — SDK `playlistImages.delete`. */
  async deletePlaylistImage(input: M.YouTubePlaylistImagesDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubePlaylistImagesDeleteInputSchema, input, "playlistImages.delete");
    return this.call("playlistImages.delete", null, (sdk, options) => sdk.playlistImages.delete(params, options));
  }

  /** POST /youtube/v3/playlistImages — SDK `playlistImages.insert`. Upload: POST /upload/youtube/v3/playlistImages. */
  async insertPlaylistImage(input: M.YouTubePlaylistImagesInsertInput): Promise<M.YouTubePlaylistImage> {
    const { media, ...params } = this.validate(M.YouTubePlaylistImagesInsertInputSchema, input, "playlistImages.insert");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("playlistImages.insert", M.YouTubePlaylistImageSchema, (sdk, options) => sdk.playlistImages.insert({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** GET /youtube/v3/playlistImages — SDK `playlistImages.list`. */
  async listPlaylistImage(input: M.YouTubePlaylistImagesListInput): Promise<M.YouTubePlaylistImageListResponse> {
    const params = this.validate(M.YouTubePlaylistImagesListInputSchema, input, "playlistImages.list");
    return this.call("playlistImages.list", M.YouTubePlaylistImageListResponseSchema, (sdk, options) => sdk.playlistImages.list(params, options));
  }

  /** PUT /youtube/v3/playlistImages — SDK `playlistImages.update`. Upload: POST /upload/youtube/v3/playlistImages. */
  async updatePlaylistImage(input: M.YouTubePlaylistImagesUpdateInput): Promise<M.YouTubePlaylistImage> {
    const { media, ...params } = this.validate(M.YouTubePlaylistImagesUpdateInputSchema, input, "playlistImages.update");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("playlistImages.update", M.YouTubePlaylistImageSchema, (sdk, options) => sdk.playlistImages.update({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** DELETE /youtube/v3/playlistItems — SDK `playlistItems.delete`. Required: id. */
  async deletePlaylistItem(input: M.YouTubePlaylistItemsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubePlaylistItemsDeleteInputSchema, input, "playlistItems.delete");
    return this.call("playlistItems.delete", null, (sdk, options) => sdk.playlistItems.delete(params, options));
  }

  /** POST /youtube/v3/playlistItems — SDK `playlistItems.insert`. Required: part. */
  async insertPlaylistItem(input: M.YouTubePlaylistItemsInsertInput): Promise<M.YouTubePlaylistItem> {
    const params = this.validate(M.YouTubePlaylistItemsInsertInputSchema, input, "playlistItems.insert");
    return this.call("playlistItems.insert", M.YouTubePlaylistItemSchema, (sdk, options) => sdk.playlistItems.insert(params, options));
  }

  /** GET /youtube/v3/playlistItems — SDK `playlistItems.list`. Required: part. */
  async listPlaylistItem(input: M.YouTubePlaylistItemsListInput): Promise<M.YouTubePlaylistItemListResponse> {
    const params = this.validate(M.YouTubePlaylistItemsListInputSchema, input, "playlistItems.list");
    return this.call("playlistItems.list", M.YouTubePlaylistItemListResponseSchema, (sdk, options) => sdk.playlistItems.list(params, options));
  }

  /** PUT /youtube/v3/playlistItems — SDK `playlistItems.update`. Required: part. */
  async updatePlaylistItem(input: M.YouTubePlaylistItemsUpdateInput): Promise<M.YouTubePlaylistItem> {
    const params = this.validate(M.YouTubePlaylistItemsUpdateInputSchema, input, "playlistItems.update");
    return this.call("playlistItems.update", M.YouTubePlaylistItemSchema, (sdk, options) => sdk.playlistItems.update(params, options));
  }

  /** DELETE /youtube/v3/playlists — SDK `playlists.delete`. Required: id. */
  async deletePlaylist(input: M.YouTubePlaylistsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubePlaylistsDeleteInputSchema, input, "playlists.delete");
    return this.call("playlists.delete", null, (sdk, options) => sdk.playlists.delete(params, options));
  }

  /** POST /youtube/v3/playlists — SDK `playlists.insert`. Required: part. */
  async insertPlaylist(input: M.YouTubePlaylistsInsertInput): Promise<M.YouTubePlaylist> {
    const params = this.validate(M.YouTubePlaylistsInsertInputSchema, input, "playlists.insert");
    return this.call("playlists.insert", M.YouTubePlaylistSchema, (sdk, options) => sdk.playlists.insert(params, options));
  }

  /** GET /youtube/v3/playlists — SDK `playlists.list`. Required: part. */
  async listPlaylist(input: M.YouTubePlaylistsListInput): Promise<M.YouTubePlaylistListResponse> {
    const params = this.validate(M.YouTubePlaylistsListInputSchema, input, "playlists.list");
    return this.call("playlists.list", M.YouTubePlaylistListResponseSchema, (sdk, options) => sdk.playlists.list(params, options));
  }

  /** PUT /youtube/v3/playlists — SDK `playlists.update`. Required: part. */
  async updatePlaylist(input: M.YouTubePlaylistsUpdateInput): Promise<M.YouTubePlaylist> {
    const params = this.validate(M.YouTubePlaylistsUpdateInputSchema, input, "playlists.update");
    return this.call("playlists.update", M.YouTubePlaylistSchema, (sdk, options) => sdk.playlists.update(params, options));
  }

  /** GET /youtube/v3/search — SDK `search.list`. Required: part. */
  async listSearch(input: M.YouTubeSearchListInput): Promise<M.YouTubeSearchListResponse> {
    const params = this.validate(M.YouTubeSearchListInputSchema, input, "search.list");
    return this.call("search.list", M.YouTubeSearchListResponseSchema, (sdk, options) => sdk.search.list(params, options));
  }

  /** DELETE /youtube/v3/subscriptions — SDK `subscriptions.delete`. Required: id. */
  async deleteSubscription(input: M.YouTubeSubscriptionsDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeSubscriptionsDeleteInputSchema, input, "subscriptions.delete");
    return this.call("subscriptions.delete", null, (sdk, options) => sdk.subscriptions.delete(params, options));
  }

  /** POST /youtube/v3/subscriptions — SDK `subscriptions.insert`. Required: part. */
  async insertSubscription(input: M.YouTubeSubscriptionsInsertInput): Promise<M.YouTubeSubscription> {
    const params = this.validate(M.YouTubeSubscriptionsInsertInputSchema, input, "subscriptions.insert");
    return this.call("subscriptions.insert", M.YouTubeSubscriptionSchema, (sdk, options) => sdk.subscriptions.insert(params, options));
  }

  /** GET /youtube/v3/subscriptions — SDK `subscriptions.list`. Required: part. */
  async listSubscription(input: M.YouTubeSubscriptionsListInput): Promise<M.YouTubeSubscriptionListResponse> {
    const params = this.validate(M.YouTubeSubscriptionsListInputSchema, input, "subscriptions.list");
    return this.call("subscriptions.list", M.YouTubeSubscriptionListResponseSchema, (sdk, options) => sdk.subscriptions.list(params, options));
  }

  /** GET /youtube/v3/superChatEvents — SDK `superChatEvents.list`. Required: part. */
  async listSuperChatEvents(input: M.YouTubeSuperChatEventsListInput): Promise<M.YouTubeSuperChatEventListResponse> {
    const params = this.validate(M.YouTubeSuperChatEventsListInputSchema, input, "superChatEvents.list");
    return this.call("superChatEvents.list", M.YouTubeSuperChatEventListResponseSchema, (sdk, options) => sdk.superChatEvents.list(params, options));
  }

  /** DELETE /youtube/v3/thirdPartyLinks — SDK `thirdPartyLinks.delete`. Required: linkingToken, type. */
  async deleteThirdPartyLink(input: M.YouTubeThirdPartyLinksDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeThirdPartyLinksDeleteInputSchema, input, "thirdPartyLinks.delete");
    return this.call("thirdPartyLinks.delete", null, (sdk, options) => sdk.thirdPartyLinks.delete(params, options));
  }

  /** POST /youtube/v3/thirdPartyLinks — SDK `thirdPartyLinks.insert`. Required: part. */
  async insertThirdPartyLink(input: M.YouTubeThirdPartyLinksInsertInput): Promise<M.YouTubeThirdPartyLink> {
    const params = this.validate(M.YouTubeThirdPartyLinksInsertInputSchema, input, "thirdPartyLinks.insert");
    return this.call("thirdPartyLinks.insert", M.YouTubeThirdPartyLinkSchema, (sdk, options) => sdk.thirdPartyLinks.insert(params, options));
  }

  /** GET /youtube/v3/thirdPartyLinks — SDK `thirdPartyLinks.list`. Required: part. */
  async listThirdPartyLink(input: M.YouTubeThirdPartyLinksListInput): Promise<M.YouTubeThirdPartyLinkListResponse> {
    const params = this.validate(M.YouTubeThirdPartyLinksListInputSchema, input, "thirdPartyLinks.list");
    return this.call("thirdPartyLinks.list", M.YouTubeThirdPartyLinkListResponseSchema, (sdk, options) => sdk.thirdPartyLinks.list(params, options));
  }

  /** PUT /youtube/v3/thirdPartyLinks — SDK `thirdPartyLinks.update`. Required: part. */
  async updateThirdPartyLink(input: M.YouTubeThirdPartyLinksUpdateInput): Promise<M.YouTubeThirdPartyLink> {
    const params = this.validate(M.YouTubeThirdPartyLinksUpdateInputSchema, input, "thirdPartyLinks.update");
    return this.call("thirdPartyLinks.update", M.YouTubeThirdPartyLinkSchema, (sdk, options) => sdk.thirdPartyLinks.update(params, options));
  }

  /** POST /youtube/v3/thumbnails/set — SDK `thumbnails.set`. Required: videoId. Upload: POST /upload/youtube/v3/thumbnails/set. */
  async setThumbnail(input: M.YouTubeThumbnailsSetInput): Promise<M.YouTubeThumbnailSetResponse> {
    const { media, ...params } = this.validate(M.YouTubeThumbnailsSetInputSchema, input, "thumbnails.set");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("thumbnails.set", M.YouTubeThumbnailSetResponseSchema, (sdk, options) => sdk.thumbnails.set({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** GET /youtube/v3/videoAbuseReportReasons — SDK `videoAbuseReportReasons.list`. Required: part. */
  async listVideoAbuseReportReasons(input: M.YouTubeVideoAbuseReportReasonsListInput): Promise<M.YouTubeVideoAbuseReportReasonListResponse> {
    const params = this.validate(M.YouTubeVideoAbuseReportReasonsListInputSchema, input, "videoAbuseReportReasons.list");
    return this.call("videoAbuseReportReasons.list", M.YouTubeVideoAbuseReportReasonListResponseSchema, (sdk, options) => sdk.videoAbuseReportReasons.list(params, options));
  }

  /** GET /youtube/v3/videoCategories — SDK `videoCategories.list`. Required: part. */
  async listVideoCategories(input: M.YouTubeVideoCategoriesListInput): Promise<M.YouTubeVideoCategoryListResponse> {
    const params = this.validate(M.YouTubeVideoCategoriesListInputSchema, input, "videoCategories.list");
    return this.call("videoCategories.list", M.YouTubeVideoCategoryListResponseSchema, (sdk, options) => sdk.videoCategories.list(params, options));
  }

  /** GET /youtube/v3/videos:batchGetStats — SDK `videos.batchGetStats`. */
  async batchGetStatsVideo(input: M.YouTubeVideosBatchGetStatsInput): Promise<M.YouTubeBatchGetStatsResponse> {
    const params = this.validate(M.YouTubeVideosBatchGetStatsInputSchema, input, "videos.batchGetStats");
    return this.call("videos.batchGetStats", M.YouTubeBatchGetStatsResponseSchema, (sdk, options) => sdk.videos.batchGetStats(params, options));
  }

  /** DELETE /youtube/v3/videos — SDK `videos.delete`. Required: id. */
  async deleteVideo(input: M.YouTubeVideosDeleteInput): Promise<void> {
    const params = this.validate(M.YouTubeVideosDeleteInputSchema, input, "videos.delete");
    return this.call("videos.delete", null, (sdk, options) => sdk.videos.delete(params, options));
  }

  /** GET /youtube/v3/videos/getRating — SDK `videos.getRating`. Required: id. */
  async getRatingVideo(input: M.YouTubeVideosGetRatingInput): Promise<M.YouTubeVideoGetRatingResponse> {
    const params = this.validate(M.YouTubeVideosGetRatingInputSchema, input, "videos.getRating");
    return this.call("videos.getRating", M.YouTubeVideoGetRatingResponseSchema, (sdk, options) => sdk.videos.getRating(params, options));
  }

  /** POST /youtube/v3/videos — SDK `videos.insert`. Required: part. Upload: POST /upload/youtube/v3/videos. */
  async insertVideo(input: M.YouTubeVideosInsertInput): Promise<M.YouTubeVideo> {
    const { media, ...params } = this.validate(M.YouTubeVideosInsertInputSchema, input, "videos.insert");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("videos.insert", M.YouTubeVideoSchema, (sdk, options) => sdk.videos.insert({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** GET /youtube/v3/videos — SDK `videos.list`. Required: part. */
  async listVideo(input: M.YouTubeVideosListInput): Promise<M.YouTubeVideoListResponse> {
    const params = this.validate(M.YouTubeVideosListInputSchema, input, "videos.list");
    return this.call("videos.list", M.YouTubeVideoListResponseSchema, (sdk, options) => sdk.videos.list(params, options));
  }

  /** POST /youtube/v3/videos/rate — SDK `videos.rate`. Required: id, rating. */
  async rateVideo(input: M.YouTubeVideosRateInput): Promise<void> {
    const params = this.validate(M.YouTubeVideosRateInputSchema, input, "videos.rate");
    return this.call("videos.rate", null, (sdk, options) => sdk.videos.rate(params, options));
  }

  /** POST /youtube/v3/videos/reportAbuse — SDK `videos.reportAbuse`. */
  async reportAbuseVideo(input: M.YouTubeVideosReportAbuseInput): Promise<void> {
    const params = this.validate(M.YouTubeVideosReportAbuseInputSchema, input, "videos.reportAbuse");
    return this.call("videos.reportAbuse", null, (sdk, options) => sdk.videos.reportAbuse(params, options));
  }

  /** PUT /youtube/v3/videos — SDK `videos.update`. Required: part. */
  async updateVideo(input: M.YouTubeVideosUpdateInput): Promise<M.YouTubeVideo> {
    const params = this.validate(M.YouTubeVideosUpdateInputSchema, input, "videos.update");
    return this.call("videos.update", M.YouTubeVideoSchema, (sdk, options) => sdk.videos.update(params, options));
  }

  /** GET /youtube/v3/videoTrainability — SDK `videoTrainability.get`. */
  async getVideoTrainability(input: M.YouTubeVideoTrainabilityGetInput): Promise<M.YouTubeVideoTrainability> {
    const params = this.validate(M.YouTubeVideoTrainabilityGetInputSchema, input, "videoTrainability.get");
    return this.call("videoTrainability.get", M.YouTubeVideoTrainabilitySchema, (sdk, options) => sdk.videoTrainability.get(params, options));
  }

  /** POST /youtube/v3/watermarks/set — SDK `watermarks.set`. Required: channelId. Upload: POST /upload/youtube/v3/watermarks/set. */
  async setWatermark(input: M.YouTubeWatermarksSetInput): Promise<void> {
    const { media, ...params } = this.validate(M.YouTubeWatermarksSetInputSchema, input, "watermarks.set");
    const body = media ? await this.mediaBody(media) : undefined;
    return this.call("watermarks.set", null, (sdk, options) => sdk.watermarks.set({ ...params, ...(body ? { media: body } : {}) }, options));
  }

  /** POST /youtube/v3/watermarks/unset — SDK `watermarks.unset`. Required: channelId. */
  async unsetWatermark(input: M.YouTubeWatermarksUnsetInput): Promise<void> {
    const params = this.validate(M.YouTubeWatermarksUnsetInputSchema, input, "watermarks.unset");
    return this.call("watermarks.unset", null, (sdk, options) => sdk.watermarks.unset(params, options));
  }

  // </generated-methods>

  // ================= resumable upload (hand-written) =================
  // https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
  // googleapis' videos.insert sends uploadType=multipart in ONE request (bounded by
  // timeoutMs), so big files were cut and every retry created a new video.

  /**
   * POST /upload/youtube/v3/videos?uploadType=resumable — opens a session and
   * returns its URI (Location). No bytes are sent; no video exists yet.
   */
  async createResumableUpload(input: {
    part: string[];
    notifySubscribers?: boolean;
    requestBody: M.YouTubeVideo;
    totalBytes: number;
    mimeType: string;
  }): Promise<{ sessionUrl: string }> {
    const query = new URLSearchParams({
      uploadType: "resumable",
      part: input.part.join(","),
      ...(input.notifySubscribers === undefined ? {} : { notifySubscribers: String(input.notifySubscribers) }),
    });
    const response = await sendUploadRequest({
      provider: this.name,
      method: "POST",
      url: `https://www.googleapis.com/upload/youtube/v3/videos?${query}`,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(input.totalBytes),
        "x-upload-content-type": input.mimeType.startsWith("video/") ? input.mimeType : "application/octet-stream",
      },
      body: JSON.stringify(input.requestBody),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      tokens: this.tokens,
      fetch: this.config.fetch,
    });
    if (!response.ok) throw await uploadResponseError(this.name, response, "YouTube upload session");
    await response.body?.cancel();
    const sessionUrl = response.headers.get("location");
    if (!sessionUrl) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "YouTube returned no upload session" });
    return { sessionUrl };
  }

  /** Ask the session how many bytes it holds (PUT, Content-Range: bytes *\/total). */
  async queryResumableUpload(sessionUrl: string, totalBytes: number): Promise<YouTubeResumableState> {
    const response = await sendUploadRequest({
      provider: this.name,
      method: "PUT",
      url: sessionUrl,
      // No body: fetch sends Content-Length: 0 itself for a body-less PUT.
      headers: { "content-range": `bytes */${totalBytes}` },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      tokens: this.tokens,
      fetch: this.config.fetch,
    });
    return this.resumableState(response);
  }

  /** PUT bytes [start, start+data.length) of the file to the session. */
  async uploadResumableChunk(sessionUrl: string, input: { start: number; data: Uint8Array; totalBytes: number; timeoutMs?: number }): Promise<YouTubeResumableState> {
    const end = input.start + input.data.byteLength - 1;
    const response = await sendUploadRequest({
      provider: this.name,
      method: "PUT",
      url: sessionUrl,
      // Content-Length is computed by fetch from the byte body.
      headers: { "content-range": `bytes ${input.start}-${end}/${input.totalBytes}` },
      body: input.data as Uint8Array<ArrayBuffer>,
      timeoutMs: input.timeoutMs,
      tokens: this.tokens,
      fetch: this.config.fetch,
    });
    return this.resumableState(response);
  }

  /** 308 → bytes confirmed (from Range, trusted over our math); 200/201 → video; 404/410 → session gone. */
  private async resumableState(response: Response): Promise<YouTubeResumableState> {
    if (response.status === 308) {
      await response.body?.cancel();
      const range = response.headers.get("range");
      const match = range ? /bytes=0-(\d+)/.exec(range) : null;
      return { state: "incomplete", confirmedBytes: match ? Number(match[1]) + 1 : 0 };
    }
    if (response.status === 200 || response.status === 201) {
      const video = this.parseResponse(M.YouTubeVideoSchema, await response.json(), "videos.insert(resumable)");
      if (!video.id) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "YouTube did not return a video id" });
      return { state: "complete", video: { ...video, id: video.id } };
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return { state: "expired" };
    }
    throw await uploadResponseError(this.name, response, "YouTube upload");
  }
}

export type YouTubeResumableState =
  | { state: "incomplete"; confirmedBytes: number }
  | { state: "complete"; video: M.YouTubeVideo & { id: string } }
  | { state: "expired" };
