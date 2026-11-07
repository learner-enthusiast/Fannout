import { z } from "zod";
import { BaseProvider } from "../common/base-provider.class";
import { HttpClient, type HttpRequest } from "../common/http-client";
import { mediaSize, openMediaStream, readAll, readChunks, toBlob, type MediaSource } from "../common/media";
import { nextOffsetCursor, type Page } from "../common/pagination";
import { ProviderError } from "../common/provider-error";
import type { BaseProviderConfig, ProviderAccount } from "../common/provider.types";
import {
  LINKEDIN_API_BASE_URL,
  LINKEDIN_DEFAULT_VERSION,
  LINKEDIN_DOCUMENT_MAX_BYTES,
  LINKEDIN_RESTLI_PROTOCOL_VERSION,
} from "./constants";
import { LinkedInEndpoints as E, restliList } from "./endpoints";
import {
  BatchGetCommentsInputSchema,
  BatchGetOrganizationsInputSchema,
  BatchGetPostsInputSchema,
  BatchGetReactionsInputSchema,
  BatchGetSocialMetadataInputSchema,
  CommentSchema,
  CreateArticlePostInputSchema,
  CreateCommentInputSchema,
  CreateDocumentPostInputSchema,
  CreateImagePostInputSchema,
  CreateMultiImagePostInputSchema,
  CreatePollPostInputSchema,
  CreatePostInputSchema,
  CreateReactionInputSchema,
  CreateTextPostInputSchema,
  CreateVideoPostInputSchema,
  DeleteCommentInputSchema,
  DeletePostInputSchema,
  DocumentSchema,
  DocumentUrnSchema,
  FinalizeVideoUploadInputSchema,
  FindMemberOrganizationAclsInputSchema,
  FindOrganizationAclsInputSchema,
  FindOrganizationByVanityNameInputSchema,
  FindOrganizationsByParentInputSchema,
  FindPostsByAuthorInputSchema,
  FindReactionsInputSchema,
  GetCommentInputSchema,
  GetCommentsInputSchema,
  GetPostInputSchema,
  GetSocialMetadataInputSchema,
  ImageSchema,
  ImageUrnSchema,
  InitializeDocumentUploadInputSchema,
  InitializeDocumentUploadResponseSchema,
  InitializeImageUploadInputSchema,
  InitializeImageUploadResponseSchema,
  InitializeVideoUploadInputSchema,
  InitializeVideoUploadResponseSchema,
  LinkedInUserInfoSchema,
  MediaUrnListInputSchema,
  NetworkSizeSchema,
  OrganizationAclSchema,
  OrganizationIdSchema,
  OrganizationSchema,
  OrganizationUrnSchema,
  PostSchema,
  ReactionKeyInputSchema,
  ReactionSchema,
  ResharePostInputSchema,
  SetCommentsStateInputSchema,
  SocialMetadataSchema,
  UpdateCommentInputSchema,
  UpdatePostInputSchema,
  UploadDocumentInputSchema,
  UploadImageInputSchema,
  UploadVideoCaptionsInputSchema,
  UploadVideoInputSchema,
  UploadVideoPartInputSchema,
  UploadVideoThumbnailInputSchema,
  VideoSchema,
  VideoUrnSchema,
  batchSchema,
  collectionSchema,
  type BatchGetCommentsInput,
  type BatchGetOrganizationsInput,
  type BatchGetPostsInput,
  type BatchGetReactionsInput,
  type CreateArticlePostInput,
  type CreateCommentInput,
  type CreateDocumentPostInput,
  type CreateImagePostInput,
  type CreateMultiImagePostInput,
  type CreatePollPostInput,
  type CreatePostInput,
  type CreateReactionInput,
  type CreateTextPostInput,
  type CreateVideoPostInput,
  type CreatedEntity,
  type DeleteCommentInput,
  type FinalizeVideoUploadInput,
  type FindMemberOrganizationAclsInput,
  type FindOrganizationAclsInput,
  type FindPostsByAuthorInput,
  type FindReactionsInput,
  type GetCommentInput,
  type GetCommentsInput,
  type GetPostInput,
  type InitializeImageUploadInput,
  type InitializeVideoUploadInput,
  type InitializeVideoUploadResponse,
  type LinkedInComment,
  type LinkedInDocument,
  type LinkedInImage,
  type LinkedInOrganization,
  type LinkedInPost,
  type LinkedInReaction,
  type LinkedInSocialMetadata,
  type LinkedInUserInfo,
  type LinkedInVideo,
  type OrganizationAcl,
  type ReactionKeyInput,
  type ResharePostInput,
  type SetCommentsStateInput,
  type UpdateCommentInput,
  type UpdatePostInput,
  type UploadDocumentInput,
  type UploadImageInput,
  type UploadVideoInput,
} from "./model";

export interface LinkedInProviderConfig extends BaseProviderConfig {
  /** `LinkedIn-Version` header, YYYYMM. */
  version?: string;
  baseUrl?: string;
}

type Batch<T> = { results: Record<string, T>; statuses?: Record<string, number>; errors?: Record<string, unknown> };

/**
 * LinkedIn Community Management / Marketing REST APIs (`/rest`, Rest.li 2.0).
 * Direct HTTP: LinkedIn's official JS client (`linkedin-api-client`) is an
 * unmaintained beta with generic Rest.li methods only — see docs/providers/linkedin.md.
 */
export class LinkedInProvider extends BaseProvider<LinkedInProviderConfig> {
  readonly name = "LINKEDIN" as const;
  readonly version: string;
  private readonly http: HttpClient;

  constructor(config: LinkedInProviderConfig) {
    super(config);
    this.version = config.version ?? LINKEDIN_DEFAULT_VERSION;
    this.http = new HttpClient({
      provider: "LINKEDIN",
      baseUrl: config.baseUrl ?? LINKEDIN_API_BASE_URL,
      tokens: this.tokens,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
      sleep: config.sleep,
      defaultHeaders: {
        "linkedin-version": this.version,
        "x-restli-protocol-version": LINKEDIN_RESTLI_PROTOCOL_VERSION,
      },
      parseError: (_status, body) => {
        const b = (body ?? {}) as { message?: unknown; serviceErrorCode?: unknown; code?: unknown };
        return {
          message: typeof b.message === "string" ? b.message : undefined,
          providerCode:
            b.serviceErrorCode != null ? String(b.serviceErrorCode) : typeof b.code === "string" ? b.code : null,
        };
      },
    });
  }

  private async get<S extends z.ZodType>(req: Omit<HttpRequest, "method">, schema: S) {
    return (await this.http.json({ ...req, method: "GET" }, schema)).data;
  }

  private async createdId(req: HttpRequest): Promise<CreatedEntity> {
    const response = await this.http.send(req);
    const id =
      response.headers.get("x-restli-id") ??
      (response.data && typeof response.data === "object" && "id" in response.data
        ? String((response.data as { id: unknown }).id)
        : null);
    if (!id) {
      throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "Missing x-restli-id" });
    }
    return { id };
  }

  private toPage<T>(data: { elements: T[]; paging?: { start: number; count: number; total?: number } }): Page<T> {
    const start = data.paging?.start ?? 0;
    const count = data.paging?.count ?? data.elements.length;
    return {
      items: data.elements,
      nextCursor: nextOffsetCursor(start, count, data.elements.length, data.paging?.total),
      total: data.paging?.total ?? null,
    };
  }

  // ================= profile =================

  /** GET /v2/userinfo — OIDC claims of the authenticated member (scope `openid profile email`). */
  async getUserInfo(): Promise<LinkedInUserInfo> {
    return this.get({ url: E.userInfo }, LinkedInUserInfoSchema);
  }

  async getAuthenticatedAccount(): Promise<ProviderAccount> {
    const me = await this.getUserInfo();
    return {
      provider: this.name,
      id: me.sub,
      username: null,
      displayName: me.name ?? null,
      profilePictureUrl: me.picture ?? null,
    };
  }

  /** The person URN for the token's member, derived from the OIDC subject. */
  async getAuthenticatedPersonUrn(): Promise<string> {
    return `urn:li:person:${(await this.getUserInfo()).sub}`;
  }

  // ================= organizations =================

  /** GET /rest/organizationAcls?q=roleAssignee — organizations the member has roles on. */
  async findMemberOrganizationAcls(input: FindMemberOrganizationAclsInput = {}): Promise<Page<OrganizationAcl>> {
    const v = this.validate(FindMemberOrganizationAclsInputSchema, input, "findMemberOrganizationAcls");
    const data = await this.get(
      { url: E.organizationAcls, query: { q: "roleAssignee", role: v.role, state: v.state, start: v.start, count: v.count } },
      collectionSchema(OrganizationAclSchema),
    );
    return this.toPage(data);
  }

  /** GET /rest/organizationAcls?q=organization — roles on one organization (e.g. its administrators). */
  async findOrganizationAcls(input: FindOrganizationAclsInput): Promise<Page<OrganizationAcl>> {
    const v = this.validate(FindOrganizationAclsInputSchema, input, "findOrganizationAcls");
    const data = await this.get(
      {
        url: E.organizationAcls,
        query: { q: "organization", organization: v.organization, role: v.role, state: v.state, start: v.start, count: v.count },
      },
      collectionSchema(OrganizationAclSchema),
    );
    return this.toPage(data);
  }

  /** GET /rest/organizations/{id} — administered organization (ADMINISTRATOR role required). */
  async getOrganization(id: number | string): Promise<LinkedInOrganization> {
    const orgId = this.validate(OrganizationIdSchema, id, "getOrganization");
    return this.get({ url: E.organization(orgId) }, OrganizationSchema);
  }

  /** GET /rest/organizations?ids=List(...) — administered organizations. */
  async batchGetOrganizations(input: BatchGetOrganizationsInput): Promise<Batch<LinkedInOrganization>> {
    const v = this.validate(BatchGetOrganizationsInputSchema, input, "batchGetOrganizations");
    return this.get({ url: E.organizations, rawQuery: `ids=${restliList(v.ids)}` }, batchSchema(OrganizationSchema));
  }

  /** GET /rest/organizationsLookup?ids=List(...) — non-admin fields of any organizations. */
  async batchLookupOrganizations(input: BatchGetOrganizationsInput): Promise<Batch<LinkedInOrganization>> {
    const v = this.validate(BatchGetOrganizationsInputSchema, input, "batchLookupOrganizations");
    return this.get(
      { url: E.organizationsLookup, rawQuery: `ids=${restliList(v.ids)}` },
      batchSchema(OrganizationSchema),
    );
  }

  /** GET /rest/organizations?q=vanityName — non-admin fields. */
  async findOrganizationByVanityName(vanityName: string): Promise<Page<LinkedInOrganization>> {
    const v = this.validate(FindOrganizationByVanityNameInputSchema, { vanityName }, "findOrganizationByVanityName");
    const data = await this.get(
      { url: E.organizations, query: { q: "vanityName", vanityName: v.vanityName } },
      collectionSchema(OrganizationSchema),
    );
    return this.toPage(data);
  }

  /** GET /rest/organizations?q=parentOrganization — administered brands of a parent organization. */
  async findOrganizationsByParent(parent: string): Promise<Page<LinkedInOrganization>> {
    const v = this.validate(FindOrganizationsByParentInputSchema, { parent }, "findOrganizationsByParent");
    const data = await this.get(
      { url: E.organizations, query: { q: "parentOrganization", parent: v.parent } },
      collectionSchema(OrganizationSchema),
    );
    return this.toPage(data);
  }

  /** GET /rest/networkSizes/{orgUrn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER — follower count. */
  async getOrganizationFollowerCount(organizationUrn: string): Promise<number> {
    const urn = this.validate(OrganizationUrnSchema, organizationUrn, "getOrganizationFollowerCount");
    const data = await this.get(
      { url: E.networkSize(urn), query: { edgeType: "COMPANY_FOLLOWED_BY_MEMBER" } },
      NetworkSizeSchema,
    );
    return data.firstDegreeSize;
  }

  // ================= posts =================

  /** POST /rest/posts — any organic post type. Returns the share/ugcPost URN (x-restli-id). */
  async createPost(input: CreatePostInput): Promise<CreatedEntity> {
    const body = this.validate(CreatePostInputSchema, input, "createPost");
    return this.createdId({ method: "POST", url: E.posts, body: { kind: "json", value: body } });
  }

  private postBase<T extends CreateTextPostInput>(v: T) {
    const { author, commentary, visibility, distribution, isReshareDisabledByAuthor, container, contentLandingPage, contentCallToActionLabel } = v;
    return {
      author, commentary, visibility, distribution, isReshareDisabledByAuthor, container, contentLandingPage, contentCallToActionLabel,
      lifecycleState: "PUBLISHED" as const,
    };
  }

  /** Text-only post. */
  async createTextPost(input: CreateTextPostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateTextPostInputSchema, input, "createTextPost");
    return this.createPost(this.postBase(v));
  }

  /** Single-image post (upload the image first with uploadImage). */
  async createImagePost(input: CreateImagePostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateImagePostInputSchema, input, "createImagePost");
    return this.createPost({ ...this.postBase(v), content: { media: v.image } });
  }

  /** Video post (upload with uploadVideo; the video should be AVAILABLE). */
  async createVideoPost(input: CreateVideoPostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateVideoPostInputSchema, input, "createVideoPost");
    return this.createPost({ ...this.postBase(v), content: { media: v.video } });
  }

  /** Document post; `title` is required for documents. */
  async createDocumentPost(input: CreateDocumentPostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateDocumentPostInputSchema, input, "createDocumentPost");
    return this.createPost({ ...this.postBase(v), content: { media: v.document } });
  }

  /** Organic MultiImage post (2–20 images). */
  async createMultiImagePost(input: CreateMultiImagePostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateMultiImagePostInputSchema, input, "createMultiImagePost");
    return this.createPost({ ...this.postBase(v), content: { multiImage: v.multiImage } });
  }

  /** Article post. LinkedIn does not scrape the URL — set title/description/thumbnail yourself. */
  async createArticlePost(input: CreateArticlePostInput): Promise<CreatedEntity> {
    const v = this.validate(CreateArticlePostInputSchema, input, "createArticlePost");
    return this.createPost({ ...this.postBase(v), content: { article: v.article } });
  }

  /** Organic poll post (2–4 options). */
  async createPollPost(input: CreatePollPostInput): Promise<CreatedEntity> {
    const v = this.validate(CreatePollPostInputSchema, input, "createPollPost");
    return this.createPost({ ...this.postBase(v), content: { poll: v.poll } });
  }

  /** Reshare an existing post (reshareContext.parent). */
  async resharePost(input: ResharePostInput): Promise<CreatedEntity> {
    const v = this.validate(ResharePostInputSchema, input, "resharePost");
    return this.createPost({ ...this.postBase(v), reshareContext: { parent: v.parent } });
  }

  /** GET /rest/posts/{urn} */
  async getPost(input: GetPostInput): Promise<LinkedInPost> {
    const v = this.validate(GetPostInputSchema, input, "getPost");
    return this.get({ url: E.post(v.postUrn), query: { viewContext: v.viewContext } }, PostSchema);
  }

  /** GET /rest/posts?ids=List(...) (X-RestLi-Method: BATCH_GET) */
  async batchGetPosts(input: BatchGetPostsInput): Promise<Batch<LinkedInPost>> {
    const v = this.validate(BatchGetPostsInputSchema, input, "batchGetPosts");
    return this.get(
      {
        url: E.posts,
        rawQuery: `ids=${restliList(v.postUrns)}`,
        query: { viewContext: v.viewContext },
        headers: { "x-restli-method": "BATCH_GET" },
      },
      batchSchema(PostSchema),
    );
  }

  /**
   * GET /rest/posts?q=author — posts by a member (r_member_social, restricted)
   * or organization (r_organization_social). Max count 100.
   */
  async findPostsByAuthor(input: FindPostsByAuthorInput): Promise<Page<LinkedInPost>> {
    const v = this.validate(FindPostsByAuthorInputSchema, input, "findPostsByAuthor");
    const data = await this.get(
      {
        url: E.posts,
        query: { q: "author", author: v.author, viewContext: v.viewContext, sortBy: v.sortBy, start: v.start, count: v.count },
        headers: { "x-restli-method": "FINDER" },
      },
      collectionSchema(PostSchema),
    );
    return this.toPage(data);
  }

  /** POST /rest/posts/{urn} (PARTIAL_UPDATE) — commentary, CTA label, landing page, lifecycleState. */
  async updatePost(input: UpdatePostInput): Promise<void> {
    const { postUrn, ...set } = this.validate(UpdatePostInputSchema, input, "updatePost");
    await this.http.send({
      method: "POST",
      url: E.post(postUrn),
      headers: { "x-restli-method": "PARTIAL_UPDATE" },
      body: { kind: "json", value: { patch: { $set: set } } },
    });
  }

  /** DELETE /rest/posts/{urn} — idempotent (204 even if already deleted). */
  async deletePost(postUrn: string): Promise<void> {
    const v = this.validate(DeletePostInputSchema, { postUrn }, "deletePost");
    await this.http.send({ method: "DELETE", url: E.post(v.postUrn), headers: { "x-restli-method": "DELETE" } });
  }

  // ================= images =================

  /** POST /rest/images?action=initializeUpload */
  async initializeImageUpload(input: InitializeImageUploadInput) {
    const v = this.validate(InitializeImageUploadInputSchema, input, "initializeImageUpload");
    const data = await this.http.json(
      { method: "POST", url: E.images, query: { action: "initializeUpload" }, body: { kind: "json", value: { initializeUploadRequest: v } } },
      InitializeImageUploadResponseSchema,
    );
    return data.data.value;
  }

  /** PUT the binary to an upload URL returned by initializeImageUpload / initializeDocumentUpload. */
  async uploadToUrl(uploadUrl: string, source: MediaSource): Promise<void> {
    const url = this.validate(z.url(), uploadUrl, "uploadToUrl");
    const stream = await openMediaStream(source, this.config.fetch);
    const bytes = await readAll(stream);
    await this.http.send({
      method: "PUT",
      url,
      body: { kind: "binary", value: bytes, contentType: stream.mimeType },
    });
  }

  /** initializeUpload + binary upload. Returns the image URN to use in posts/comments. */
  async uploadImage(input: UploadImageInput): Promise<{ image: string }> {
    const v = this.validate(UploadImageInputSchema, input, "uploadImage");
    const init = await this.initializeImageUpload({ owner: v.owner, mediaLibraryMetadata: v.mediaLibraryMetadata });
    await this.uploadToUrl(init.uploadUrl, v.source);
    return { image: init.image };
  }

  /** GET /rest/images/{urn} (needs read permission; w_member_social alone is write-only). */
  async getImage(imageUrn: string): Promise<LinkedInImage> {
    const urn = this.validate(ImageUrnSchema, imageUrn, "getImage");
    return this.get({ url: E.image(urn) }, ImageSchema);
  }

  /** GET /rest/images?ids=List(...) */
  async batchGetImages(imageUrns: string[]): Promise<Batch<LinkedInImage>> {
    const v = this.validate(MediaUrnListInputSchema(ImageUrnSchema), { urns: imageUrns }, "batchGetImages");
    return this.get({ url: E.images, rawQuery: `ids=${restliList(v.urns)}` }, batchSchema(ImageSchema));
  }

  // ================= documents =================

  /** POST /rest/documents?action=initializeUpload */
  async initializeDocumentUpload(owner: string) {
    const v = this.validate(InitializeDocumentUploadInputSchema, { owner }, "initializeDocumentUpload");
    const data = await this.http.json(
      { method: "POST", url: E.documents, query: { action: "initializeUpload" }, body: { kind: "json", value: { initializeUploadRequest: v } } },
      InitializeDocumentUploadResponseSchema,
    );
    return data.data.value;
  }

  /** initializeUpload + upload. Returns the document URN (title is set on the post). */
  async uploadDocument(input: UploadDocumentInput): Promise<{ document: string }> {
    const v = this.validate(UploadDocumentInputSchema, input, "uploadDocument");
    const size = mediaSize(v.source);
    if (size !== null && size > LINKEDIN_DOCUMENT_MAX_BYTES) {
      throw new ProviderError({ provider: this.name, code: "VALIDATION", message: "Documents must be at most 100 MB" });
    }
    const init = await this.initializeDocumentUpload(v.owner);
    await this.uploadToUrl(init.uploadUrl, v.source);
    return { document: init.document };
  }

  /** GET /rest/documents/{urn} */
  async getDocument(documentUrn: string): Promise<LinkedInDocument> {
    const urn = this.validate(DocumentUrnSchema, documentUrn, "getDocument");
    return this.get({ url: E.document(urn) }, DocumentSchema);
  }

  /** GET /rest/documents?ids=List(...) */
  async batchGetDocuments(documentUrns: string[]): Promise<Batch<LinkedInDocument>> {
    const v = this.validate(MediaUrnListInputSchema(DocumentUrnSchema), { urns: documentUrns }, "batchGetDocuments");
    return this.get({ url: E.documents, rawQuery: `ids=${restliList(v.urns)}` }, batchSchema(DocumentSchema));
  }

  // ================= videos =================

  /** POST /rest/videos?action=initializeUpload — returns per-part upload URLs. */
  async initializeVideoUpload(input: InitializeVideoUploadInput): Promise<InitializeVideoUploadResponse> {
    const v = this.validate(InitializeVideoUploadInputSchema, input, "initializeVideoUpload");
    const data = await this.http.json(
      { method: "POST", url: E.videos, query: { action: "initializeUpload" }, body: { kind: "json", value: { initializeUploadRequest: v } } },
      InitializeVideoUploadResponseSchema,
    );
    return data.data.value;
  }

  /** PUT one part; returns its ETag (needed for finalize). */
  async uploadVideoPart(uploadUrl: string, data: Uint8Array): Promise<string> {
    const v = this.validate(UploadVideoPartInputSchema, { uploadUrl, data }, "uploadVideoPart");
    const response = await this.http.send({
      method: "PUT",
      url: v.uploadUrl,
      auth: false,
      body: { kind: "binary", value: v.data, contentType: "application/octet-stream" },
    });
    const etag = response.headers.get("etag");
    if (!etag) throw new ProviderError({ provider: this.name, code: "INVALID_RESPONSE", message: "Video part upload returned no ETag" });
    return etag.replace(/^"|"$/g, "");
  }

  /** POST /rest/videos?action=finalizeUpload */
  async finalizeVideoUpload(input: FinalizeVideoUploadInput): Promise<void> {
    const v = this.validate(FinalizeVideoUploadInputSchema, input, "finalizeVideoUpload");
    await this.http.send({
      method: "POST",
      url: E.videos,
      query: { action: "finalizeUpload" },
      body: { kind: "json", value: { finalizeUploadRequest: v } },
    });
  }

  /** PUT a thumbnail image to `thumbnailUploadUrl` (header media-type-family: STILLIMAGE). */
  async uploadVideoThumbnail(thumbnailUploadUrl: string, source: MediaSource): Promise<void> {
    const v = this.validate(UploadVideoThumbnailInputSchema, { thumbnailUploadUrl, source }, "uploadVideoThumbnail");
    const bytes = await readAll(await openMediaStream(v.source, this.config.fetch));
    await this.http.send({
      method: "PUT",
      url: v.thumbnailUploadUrl,
      headers: { "media-type-family": "STILLIMAGE" },
      body: { kind: "binary", value: bytes, contentType: "application/octet-stream" },
    });
  }

  /** POST multipart (metadata JSON + SRT file) to `captionsUploadUrl`. */
  async uploadVideoCaptions(input: z.input<typeof UploadVideoCaptionsInputSchema>): Promise<void> {
    const v = this.validate(UploadVideoCaptionsInputSchema, input, "uploadVideoCaptions");
    const bytes = await readAll(await openMediaStream(v.source, this.config.fetch));
    const form = new FormData();
    form.set("metadata", JSON.stringify(v.metadata));
    form.set("file", toBlob(bytes, "text/plain"), "captions.srt");
    await this.http.send({ method: "POST", url: v.captionsUploadUrl, body: { kind: "multipart", value: form } });
  }

  /**
   * Full multipart video upload: initialize → PUT each 4 MiB part (collect
   * ETags) → optional thumbnail/captions → finalize. Streams the source; at
   * most one part is held in memory. Poll getVideo until status is AVAILABLE.
   */
  async uploadVideo(input: UploadVideoInput): Promise<{ video: string }> {
    const v = this.validate(UploadVideoInputSchema, input, "uploadVideo");
    const source = await openMediaStream(v.source, this.config.fetch);
    const init = await this.initializeVideoUpload({
      owner: v.owner,
      fileSizeBytes: source.type === "buffer" ? source.data.byteLength : source.size,
      uploadThumbnail: Boolean(v.thumbnail),
      uploadCaptions: Boolean(v.captions),
      mediaLibraryMetadata: v.mediaLibraryMetadata,
    });
    const instructions = [...init.uploadInstructions].sort((a, b) => a.firstByte - b.firstByte);
    const partSize = instructions[0]!.lastByte - instructions[0]!.firstByte + 1;
    const etags: string[] = [];
    let i = 0;
    for await (const chunk of readChunks(source, partSize)) {
      const instruction = instructions[i++];
      if (!instruction || chunk.offset !== instruction.firstByte || chunk.offset + chunk.data.byteLength - 1 !== instruction.lastByte) {
        throw new ProviderError({ provider: this.name, code: "VALIDATION", message: "Video size does not match the upload instructions" });
      }
      etags.push(await this.uploadVideoPart(instruction.uploadUrl, chunk.data));
    }
    if (etags.length !== instructions.length) {
      throw new ProviderError({ provider: this.name, code: "VALIDATION", message: "Video ended before all parts were uploaded" });
    }
    if (v.thumbnail && init.thumbnailUploadUrl) await this.uploadVideoThumbnail(init.thumbnailUploadUrl, v.thumbnail);
    if (v.captions && init.captionsUploadUrl) {
      await this.uploadVideoCaptions({ captionsUploadUrl: init.captionsUploadUrl, ...v.captions });
    }
    await this.finalizeVideoUpload({ video: init.video, uploadToken: init.uploadToken, uploadedPartIds: etags });
    return { video: init.video };
  }

  /** GET /rest/videos/{urn} */
  async getVideo(videoUrn: string): Promise<LinkedInVideo> {
    const urn = this.validate(VideoUrnSchema, videoUrn, "getVideo");
    return this.get({ url: E.video(urn) }, VideoSchema);
  }

  /** GET /rest/videos?ids=List(...) */
  async batchGetVideos(videoUrns: string[]): Promise<Batch<LinkedInVideo>> {
    const v = this.validate(MediaUrnListInputSchema(VideoUrnSchema), { urns: videoUrns }, "batchGetVideos");
    return this.get({ url: E.videos, rawQuery: `ids=${restliList(v.urns)}` }, batchSchema(VideoSchema));
  }

  // ================= comments =================

  /** POST /rest/socialActions/{target}/comments — top-level or nested (parentComment). */
  async createComment(input: CreateCommentInput): Promise<LinkedInComment> {
    const { target, ...body } = this.validate(CreateCommentInputSchema, input, "createComment");
    return (
      await this.http.json({ method: "POST", url: E.comments(target), body: { kind: "json", value: body } }, CommentSchema)
    ).data;
  }

  /** GET /rest/socialActions/{target}/comments — comments on a post, or replies to a comment. */
  async getComments(input: GetCommentsInput): Promise<Page<LinkedInComment>> {
    const v = this.validate(GetCommentsInputSchema, input, "getComments");
    const data = await this.get(
      { url: E.comments(v.target), query: { start: v.start, count: v.count } },
      collectionSchema(CommentSchema),
    );
    return this.toPage(data);
  }

  /** GET /rest/socialActions/{target}/comments/{commentId} */
  async getComment(input: GetCommentInput): Promise<LinkedInComment> {
    const v = this.validate(GetCommentInputSchema, input, "getComment");
    return this.get({ url: E.comment(v.target, v.commentId) }, CommentSchema);
  }

  /** GET /rest/socialActions/{target}/comments?ids=List(...) */
  async batchGetComments(input: BatchGetCommentsInput): Promise<Batch<LinkedInComment>> {
    const v = this.validate(BatchGetCommentsInputSchema, input, "batchGetComments");
    return this.get({ url: E.comments(v.target), rawQuery: `ids=${restliList(v.commentIds)}` }, batchSchema(CommentSchema));
  }

  /** POST /rest/socialActions/{target}/comments/{id} (PARTIAL_UPDATE) — only message text/attributes. */
  async updateComment(input: UpdateCommentInput): Promise<LinkedInComment> {
    const v = this.validate(UpdateCommentInputSchema, input, "updateComment");
    return (
      await this.http.json(
        {
          method: "POST",
          url: E.comment(v.target, v.commentId),
          query: { actor: v.actor },
          headers: { "x-restli-method": "PARTIAL_UPDATE" },
          body: { kind: "json", value: { patch: { message: { $set: v.message } } } },
        },
        CommentSchema,
      )
    ).data;
  }

  /** DELETE /rest/socialActions/{target}/comments/{id} (`actor` when deleting as an organization). */
  async deleteComment(input: DeleteCommentInput): Promise<void> {
    const v = this.validate(DeleteCommentInputSchema, input, "deleteComment");
    await this.http.send({ method: "DELETE", url: E.comment(v.target, v.commentId), query: { actor: v.actor } });
  }

  // ================= reactions =================

  /** POST /rest/reactions?actor={urn} — react to a post or comment. */
  async createReaction(input: CreateReactionInput): Promise<LinkedInReaction> {
    const v = this.validate(CreateReactionInputSchema, input, "createReaction");
    return (
      await this.http.json(
        {
          method: "POST",
          url: E.reactions,
          query: { actor: v.actor },
          body: { kind: "json", value: { root: v.root, reactionType: v.reactionType } },
        },
        ReactionSchema,
      )
    ).data;
  }

  /** GET /rest/reactions/(actor:…,entity:…) */
  async getReaction(input: ReactionKeyInput): Promise<LinkedInReaction> {
    const v = this.validate(ReactionKeyInputSchema, input, "getReaction");
    return this.get({ url: E.reaction(v.actor, v.entity) }, ReactionSchema);
  }

  /** GET /rest/reactions?ids=List((actor:…,entity:…),…) */
  async batchGetReactions(input: BatchGetReactionsInput): Promise<Batch<LinkedInReaction>> {
    const v = this.validate(BatchGetReactionsInputSchema, input, "batchGetReactions");
    const keys = v.keys.map((k) => E.reactionKey(k.actor, k.entity)).join(",");
    return this.get({ url: E.reactions, rawQuery: `ids=List(${keys})` }, batchSchema(ReactionSchema));
  }

  /** GET /rest/reactions/(entity:{urn})?q=entity — reactions on a post or comment. */
  async findReactions(input: FindReactionsInput): Promise<Page<LinkedInReaction>> {
    const v = this.validate(FindReactionsInputSchema, input, "findReactions");
    // Rest.li record syntax; enum values need no escaping.
    const sort = v.sort ? `sort=(value:${v.sort})` : "";
    const data = await this.get(
      { url: E.reactionsByEntity(v.entity), query: { q: "entity", start: v.start, count: v.count }, rawQuery: sort || undefined },
      collectionSchema(ReactionSchema),
    );
    return this.toPage(data);
  }

  /** DELETE /rest/reactions/(actor:…,entity:…) */
  async deleteReaction(input: ReactionKeyInput): Promise<void> {
    const v = this.validate(ReactionKeyInputSchema, input, "deleteReaction");
    await this.http.send({ method: "DELETE", url: E.reaction(v.actor, v.entity) });
  }

  // ================= social metadata =================

  /** GET /rest/socialMetadata/{urn} — reaction & comment summaries, comments state. */
  async getSocialMetadata(entity: string): Promise<LinkedInSocialMetadata> {
    const v = this.validate(GetSocialMetadataInputSchema, { entity }, "getSocialMetadata");
    return this.get({ url: E.socialMetadata(v.entity) }, SocialMetadataSchema);
  }

  /** GET /rest/socialMetadata?ids=List(...) */
  async batchGetSocialMetadata(entities: string[]): Promise<Batch<LinkedInSocialMetadata>> {
    const v = this.validate(BatchGetSocialMetadataInputSchema, { entities }, "batchGetSocialMetadata");
    return this.get(
      { url: E.socialMetadataBatch, rawQuery: `ids=${restliList(v.entities)}` },
      batchSchema(SocialMetadataSchema),
    );
  }

  /** POST /rest/socialMetadata/{thread}?actor= — open/close comments (CLOSED deletes existing comments). */
  async setCommentsState(input: SetCommentsStateInput): Promise<void> {
    const v = this.validate(SetCommentsStateInputSchema, input, "setCommentsState");
    await this.http.send({
      method: "POST",
      url: E.socialMetadata(v.entity),
      query: { actor: v.actor },
      body: { kind: "json", value: { patch: { $set: { commentsState: v.commentsState } } } },
    });
  }
}
