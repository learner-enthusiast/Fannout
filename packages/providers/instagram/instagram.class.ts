import type { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { HttpClient, type QueryValue } from "../common/http-client";
import { GraphIdSchema, parseGraphError, toGraphForm, type GraphId } from "../common/meta-graph";
import type { BaseProviderConfig, ProviderAccount } from "../common/provider.types";
import { INSTAGRAM_API_BASE_URL, INSTAGRAM_API_VERSION } from "./constants";
import { InstagramEndpoints as E } from "./endpoints";
import {
  CreateCarouselContainerInputSchema,
  CreateCarouselItemInputSchema,
  CreateImageContainerInputSchema,
  CreateReelContainerInputSchema,
  InstagramAccountSchema,
  InstagramContainerStatusSchema,
  InstagramIdSchema,
  InstagramInsightsResponseSchema,
  InstagramMediaSchema,
  InstagramPublishingLimitSchema,
  InstagramRecentMediaSchema,
  type CreateCarouselContainerInput,
  type CreateCarouselItemInput,
  type CreateImageContainerInput,
  type CreateReelContainerInput,
  type InstagramAccount,
  type InstagramContainerStatus,
  type InstagramInsight,
  type InstagramMedia,
  type InstagramPublishingLimit,
} from "./model";

export interface InstagramProviderConfig extends BaseProviderConfig {
  /** Instagram professional account id (provider_account_id). NOT the system-user id from /me. */
  igUserId: string;
  /** Graph version path segment (default v27.0). */
  version?: string;
  baseUrl?: string;
}

/**
 * Instagram API with Unified Login: graph.facebook.com with a Bearer token
 * (never a query token, never graph.instagram.com). Meta downloads media from
 * public URLs; publishing is container → poll → media_publish.
 *
 * Not supported by the API (so not implemented): deleting or editing published
 * media, resumable (rupload) uploads, token refresh.
 */
export class InstagramProvider extends BaseProvider<InstagramProviderConfig> {
  readonly name = "INSTAGRAM" as const;
  readonly igUserId: string;
  readonly version: string;
  private readonly http: HttpClient;

  constructor(config: InstagramProviderConfig) {
    super(config);
    this.igUserId = this.validate(InstagramIdSchema, config.igUserId, "constructor.igUserId");
    this.version = config.version ?? INSTAGRAM_API_VERSION;
    this.http = new HttpClient({
      provider: "INSTAGRAM",
      baseUrl: `${(config.baseUrl ?? INSTAGRAM_API_BASE_URL).replace(/\/$/, "")}/${this.version}`,
      tokens: this.tokens,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      sleep: config.sleep,
      // Default authorize = `Authorization: Bearer <token>`.
      parseError: parseGraphError,
    });
  }

  private async get<S extends z.ZodType>(url: string, query: Record<string, QueryValue>, schema: S): Promise<z.output<S>> {
    return (await this.http.json({ method: "GET", url, query }, schema)).data;
  }

  private async post<S extends z.ZodType>(url: string, form: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    return (await this.http.json({ method: "POST", url, body: { kind: "form", value: toGraphForm(form) } }, schema)).data;
  }

  // ================= account =================

  /** GET /{ig-id}?fields=id,username — also the health check and publishing preflight. */
  async getHealth(): Promise<{ id: string; username?: string }> {
    return this.get(E.account(this.igUserId), { fields: ["id", "username"] }, InstagramAccountSchema);
  }

  /** Profile incl. follower_count source for analytics. */
  async getProfile(): Promise<InstagramAccount> {
    return this.get(
      E.account(this.igUserId),
      { fields: ["id", "username", "name", "profile_picture_url", "followers_count", "media_count"] },
      InstagramAccountSchema,
    );
  }

  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const me = await this.getProfile();
    return {
      provider: this.name,
      id: me.id,
      username: me.username ?? null,
      displayName: me.name ?? null,
      profilePictureUrl: me.profile_picture_url ?? null,
    };
  }

  /** GET /{ig-id}/content_publishing_limit — live quota (never hardcode it). */
  async getPublishingLimit(): Promise<InstagramPublishingLimit["data"][number] | null> {
    const res = await this.get(E.publishingLimit(this.igUserId), { fields: ["quota_usage", "config"] }, InstagramPublishingLimitSchema);
    return res.data[0] ?? null;
  }

  // ================= publishing =================

  /** POST /{ig-id}/media — Reel container (media_type=REELS). */
  async createReelContainer(input: CreateReelContainerInput): Promise<GraphId> {
    const v = this.validate(CreateReelContainerInputSchema, input, "createReelContainer");
    // cover_url wins over thumb_offset: never send both.
    const body = v.cover_url ? { ...v, thumb_offset: undefined } : v;
    return this.post(E.createContainer(this.igUserId), body, GraphIdSchema);
  }

  /** POST /{ig-id}/media — single image container. */
  async createImageContainer(input: CreateImageContainerInput): Promise<GraphId> {
    const v = this.validate(CreateImageContainerInputSchema, input, "createImageContainer");
    return this.post(E.createContainer(this.igUserId), v, GraphIdSchema);
  }

  /** POST /{ig-id}/media with is_carousel_item=true (no caption). */
  async createCarouselItem(input: CreateCarouselItemInput): Promise<GraphId> {
    const v = this.validate(CreateCarouselItemInputSchema, input, "createCarouselItem");
    return this.post(E.createContainer(this.igUserId), { ...v, is_carousel_item: true }, GraphIdSchema);
  }

  /** POST /{ig-id}/media — carousel parent (children must already be FINISHED). */
  async createCarouselContainer(input: CreateCarouselContainerInput): Promise<GraphId> {
    const v = this.validate(CreateCarouselContainerInputSchema, input, "createCarouselContainer");
    return this.post(E.createContainer(this.igUserId), { media_type: "CAROUSEL", children: v.children, caption: v.caption }, GraphIdSchema);
  }

  /** GET /{container-id}?fields=status_code. */
  async getContainerStatus(containerId: string): Promise<InstagramContainerStatus> {
    const id = this.validate(InstagramIdSchema, containerId, "getContainerStatus");
    return this.get(E.node(id), { fields: ["status_code"] }, InstagramContainerStatusSchema);
  }

  /** POST /{ig-id}/media_publish { creation_id } → { id }. Not idempotent: check the container status first. */
  async publishContainer(creationId: string): Promise<GraphId> {
    const id = this.validate(InstagramIdSchema, creationId, "publishContainer");
    return this.post(E.publish(this.igUserId), { creation_id: id }, GraphIdSchema);
  }

  /** GET /{media-id}?fields=id,permalink. Also the lazy "does it still exist" check. */
  async getMedia(mediaId: string): Promise<InstagramMedia> {
    const id = this.validate(InstagramIdSchema, mediaId, "getMedia");
    return this.get(E.node(id), { fields: ["id", "permalink"] }, InstagramMediaSchema);
  }

  /** GET /{ig-id}/media — newest media; used to recover the id when a media_publish response was lost. */
  async getRecentMedia(limit = 5): Promise<InstagramMedia[]> {
    const res = await this.get(E.recentMedia(this.igUserId), { fields: ["id", "permalink", "timestamp"], limit }, InstagramRecentMediaSchema);
    return res.data;
  }

  // ================= insights =================

  /** GET /{media-id}/insights?metric=… — metrics must match the media's type or the whole request fails. */
  async getMediaInsights(mediaId: string, metrics: readonly string[]): Promise<InstagramInsight[]> {
    const id = this.validate(InstagramIdSchema, mediaId, "getMediaInsights");
    return (await this.get(E.mediaInsights(id), { metric: [...metrics] }, InstagramInsightsResponseSchema)).data;
  }

  /** GET /{ig-id}/insights?metric=…&period=day&metric_type=total_value (total for since–until). */
  async getAccountInsights(metrics: readonly string[], range: { since: number; until: number }): Promise<InstagramInsight[]> {
    return (
      await this.get(
        E.accountInsights(this.igUserId),
        { metric: [...metrics], period: "day", metric_type: "total_value", since: range.since, until: range.until },
        InstagramInsightsResponseSchema,
      )
    ).data;
  }
}
