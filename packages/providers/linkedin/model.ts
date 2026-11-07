import { z } from "zod";
import { composeField, type ComposeCapabilities } from "../common/compose";
import { MediaSourceSchema } from "../common/media";
import {
  LINKEDIN_ALT_TEXT_MAX,
  LINKEDIN_MEDIA_FINDER_MAX_COUNT,
  LINKEDIN_MULTI_IMAGE,
  LINKEDIN_UGC_MAX_IMAGES,
  LINKEDIN_UGC_VIDEO_MAX_BYTES,
  LINKEDIN_POLL,
  LINKEDIN_POSTS_FINDER_MAX_COUNT,
  LINKEDIN_VIDEO_MAX_BYTES,
} from "./constants";

/*
 * Zod schemas for the LinkedIn APIs implemented in linkedin.class.ts.
 * Contracts follow Microsoft Learn (Marketing API, version 202610):
 * Posts, Images, Videos, Documents, Comments, Reactions, Social Metadata,
 * Organization Access Control, Organization Lookup, and OIDC UserInfo.
 * Response schemas are loose objects: documented fields are validated,
 * undocumented extra fields are preserved rather than rejected.
 */

// ---------- URNs ----------

export const PersonUrnSchema = z.string().regex(/^urn:li:person:[^:]+$/, "Expected urn:li:person:{id}");
export const OrganizationUrnSchema = z
  .string()
  .regex(/^urn:li:(organization|organizationBrand):\d+$/, "Expected urn:li:organization:{id}");
export const AuthorUrnSchema = z.union([PersonUrnSchema, OrganizationUrnSchema]);
export const PostUrnSchema = z.string().regex(/^urn:li:(share|ugcPost):\d+$/, "Expected a share or ugcPost URN");
export const ActivityUrnSchema = z.string().regex(/^urn:li:activity:\d+$/);
export const CommentUrnSchema = z.string().regex(/^urn:li:comment:\(.+\)$/, "Expected urn:li:comment:(...)");
export const ImageUrnSchema = z.string().regex(/^urn:li:image:[^:]+$/);
export const VideoUrnSchema = z.string().regex(/^urn:li:video:[^:]+$/);
export const DocumentUrnSchema = z.string().regex(/^urn:li:document:[^:]+$/);
export const SponsoredAccountUrnSchema = z.string().regex(/^urn:li:sponsoredAccount:\d+$/);
/** Thread a comment or reaction belongs to. */
export const SocialThreadUrnSchema = z.union([PostUrnSchema, ActivityUrnSchema]);
/** Target of socialActions/comments: a thread, or a comment (for nested replies). */
export const CommentTargetUrnSchema = z.union([PostUrnSchema, ActivityUrnSchema, CommentUrnSchema]);

// ---------- shared ----------

export const AuditStampSchema = z.looseObject({
  actor: z.string(),
  time: z.number(),
  impersonator: z.string().optional(),
});

export const PagingSchema = z.looseObject({
  start: z.number().int(),
  count: z.number().int(),
  total: z.number().int().optional(),
  links: z
    .array(z.looseObject({ rel: z.string(), href: z.string(), type: z.string().optional() }))
    .optional(),
});

const startCount = (maxCount: number) => ({
  start: z.number().int().min(0).optional(),
  count: z.number().int().min(1).max(maxCount).optional(),
});

export function collectionSchema<T extends z.ZodType>(element: T) {
  return z.looseObject({ elements: z.array(element), paging: PagingSchema.optional() });
}

export function batchSchema<T extends z.ZodType>(element: T) {
  return z.looseObject({
    results: z.record(z.string(), element),
    statuses: z.record(z.string(), z.number()).optional(),
    errors: z.record(z.string(), z.unknown()).optional(),
  });
}

export const MediaStatusSchema = z.enum(["PROCESSING", "PROCESSING_FAILED", "AVAILABLE", "WAITING_UPLOAD"]);
export const MediaLibraryStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const MediaLibraryMetadataInputSchema = z.object({
  associatedAccount: SponsoredAccountUrnSchema,
  assetName: z.string().min(1),
});

export const MediaLibraryMetadataSchema = z.looseObject({
  associatedAccount: z.string(),
  assetName: z.string(),
  mediaLibraryStatus: MediaLibraryStatusSchema.optional(),
});

// ---------- profile (OIDC UserInfo) ----------

export const LinkedInUserInfoSchema = z.looseObject({
  sub: z.string().min(1),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  locale: z.union([z.string(), z.looseObject({ country: z.string(), language: z.string() })]).optional(),
});
export type LinkedInUserInfo = z.infer<typeof LinkedInUserInfoSchema>;

// ---------- organizations ----------

export const OrganizationRoleSchema = z.enum([
  "ADMINISTRATOR",
  "DIRECT_SPONSORED_CONTENT_POSTER",
  "RECRUITING_POSTER",
  "LEAD_CAPTURE_ADMINISTRATOR",
  "LEAD_GEN_FORMS_MANAGER",
  "ANALYST",
  "CURATOR",
  "CONTENT_ADMINISTRATOR",
]);
export const OrganizationRoleStateSchema = z.enum(["APPROVED", "REJECTED", "REQUESTED", "REVOKED"]);

export const FindMemberOrganizationAclsInputSchema = z.object({
  role: OrganizationRoleSchema.optional(),
  state: OrganizationRoleStateSchema.optional(),
  ...startCount(LINKEDIN_MEDIA_FINDER_MAX_COUNT),
});
export type FindMemberOrganizationAclsInput = z.input<typeof FindMemberOrganizationAclsInputSchema>;

export const FindOrganizationAclsInputSchema = FindMemberOrganizationAclsInputSchema.extend({
  organization: OrganizationUrnSchema,
});
export type FindOrganizationAclsInput = z.input<typeof FindOrganizationAclsInputSchema>;

export const OrganizationAclSchema = z.looseObject({
  role: z.string(),
  state: z.string(),
  roleAssignee: z.string(),
  /** Returned as `organization` (roleAssignee finder) or `organizationTarget` (organization finder). */
  organization: z.string().optional(),
  organizationTarget: z.string().optional(),
});
export type OrganizationAcl = z.infer<typeof OrganizationAclSchema>;

const CroppedImageSchema = z.looseObject({
  cropped: z.string().optional(),
  original: z.string().optional(),
  cropInfo: z
    .looseObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
});
const MultiLocaleStringSchema = z.looseObject({
  localized: z.record(z.string(), z.string()),
  preferredLocale: z.looseObject({ country: z.string(), language: z.string() }).optional(),
});

export const OrganizationSchema = z.looseObject({
  id: z.number().int(),
  name: MultiLocaleStringSchema.optional(),
  localizedName: z.string().optional(),
  vanityName: z.string().optional(),
  localizedWebsite: z.string().optional(),
  localizedDescription: z.string().optional(),
  logoV2: CroppedImageSchema.optional(),
  coverPhotoV2: CroppedImageSchema.optional(),
  primaryOrganizationType: z.enum(["SCHOOL", "BRAND", "NONE"]).optional(),
  organizationType: z.string().optional(),
  staffCountRange: z.string().optional(),
  industries: z.array(z.string()).optional(),
  locations: z.array(z.looseObject({})).optional(),
});
export type LinkedInOrganization = z.infer<typeof OrganizationSchema>;

export const OrganizationIdSchema = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);
export const BatchGetOrganizationsInputSchema = z.object({
  ids: z.array(OrganizationIdSchema).min(1).max(100),
});
export type BatchGetOrganizationsInput = z.input<typeof BatchGetOrganizationsInputSchema>;

export const FindOrganizationByVanityNameInputSchema = z.object({ vanityName: z.string().min(1) });
export const FindOrganizationsByParentInputSchema = z.object({ parent: OrganizationUrnSchema });
export const NetworkSizeSchema = z.looseObject({ firstDegreeSize: z.number().int() });

// ---------- posts ----------

export const VisibilitySchema = z.enum(["PUBLIC", "CONNECTIONS", "LOGGED_IN", "CONTAINER"]);
export const FeedDistributionSchema = z.enum(["MAIN_FEED", "NONE"]);
export const LifecycleStateSchema = z.enum(["DRAFT", "PUBLISHED", "PUBLISH_REQUESTED", "PUBLISH_FAILED"]);
export const ViewContextSchema = z.enum(["READER", "AUTHOR"]);
export const ContentCallToActionLabelSchema = z.enum([
  "APPLY",
  "DOWNLOAD",
  "VIEW_QUOTE",
  "LEARN_MORE",
  "SIGN_UP",
  "SUBSCRIBE",
  "REGISTER",
  "JOIN",
  "ATTEND",
  "REQUEST_DEMO",
  "SEE_MORE",
  "BUY_NOW", // 202504+
  "SHOP_NOW", // 202504+
]);
export const StaffCountRangeSchema = z.enum([
  "SIZE_1",
  "SIZE_2_TO_10",
  "SIZE_11_TO_50",
  "SIZE_51_TO_200",
  "SIZE_201_TO_500",
  "SIZE_501_TO_1000",
  "SIZE_1001_TO_5000",
  "SIZE_5001_TO_10000",
  "SIZE_10001_OR_MORE",
]);

/** Targeting facets for organic organization posts (audience must exceed 300 members). */
export const TargetEntitiesSchema = z.object({
  degrees: z.array(z.string()).optional(),
  fieldsOfStudy: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  interfaceLocales: z.array(z.string()).optional(),
  jobFunctions: z.array(z.string()).optional(),
  /** Deprecated — use geoLocations. */
  locations: z.array(z.string()).optional(),
  geoLocations: z.array(z.string()).optional(),
  /** Deprecated — use organizations. */
  schools: z.array(z.string()).optional(),
  organizations: z.array(z.string()).optional(),
  seniorities: z.array(z.string()).optional(),
  staffCountRanges: z.array(StaffCountRangeSchema).optional(),
});

export const DistributionSchema = z.object({
  feedDistribution: FeedDistributionSchema,
  targetEntities: z.array(TargetEntitiesSchema).optional(),
  thirdPartyDistributionChannels: z.array(z.string()).optional(),
});

export const MediaContentSchema = z.object({
  id: z.union([ImageUrnSchema, VideoUrnSchema, DocumentUrnSchema]),
  /** Required by LinkedIn for documents. */
  title: z.string().optional(),
  altText: z.string().max(LINKEDIN_ALT_TEXT_MAX).optional(),
});

export const ArticleContentSchema = z.object({
  source: z.url(),
  /** Upload via Images API; LinkedIn does not scrape URLs. */
  thumbnail: ImageUrnSchema.optional(),
  thumbnailAltText: z.string().max(LINKEDIN_ALT_TEXT_MAX).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
});

export const MultiImageContentSchema = z.object({
  images: z
    .array(z.object({ id: ImageUrnSchema, altText: z.string().max(LINKEDIN_ALT_TEXT_MAX).optional() }))
    .min(LINKEDIN_MULTI_IMAGE.min)
    .max(LINKEDIN_MULTI_IMAGE.max),
  altText: z.string().max(LINKEDIN_ALT_TEXT_MAX).optional(),
});

export const PollDurationSchema = z.enum(["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"]);
export const PollContentSchema = z.object({
  question: z.string().min(1).max(LINKEDIN_POLL.questionMax),
  options: z
    .array(z.object({ text: z.string().min(1).max(LINKEDIN_POLL.optionMax) }))
    .min(LINKEDIN_POLL.minOptions)
    .max(LINKEDIN_POLL.maxOptions),
  settings: z.object({
    duration: PollDurationSchema,
    /** MULTIPLE_VOTE is documented as "to be supported later". */
    voteSelectionType: z.literal("SINGLE_VOTE").optional(),
    /** `false` is rejected with 400, so only `true` is accepted. */
    isVoterVisibleToAuthor: z.literal(true).optional(),
  }),
});

export const ReferenceContentSchema = z.object({ id: z.string().regex(/^urn:li:/) });

/** Exactly one content type per post (organic). Carousel is sponsored-only. */
export const PostContentSchema = z.union([
  z.object({ media: MediaContentSchema }).strict(),
  z.object({ article: ArticleContentSchema }).strict(),
  z.object({ multiImage: MultiImageContentSchema }).strict(),
  z.object({ poll: PollContentSchema }).strict(),
  z.object({ reference: ReferenceContentSchema }).strict(),
]);

const PostBaseSchema = z.object({
  author: AuthorUrnSchema,
  /** `little` text format; mentions as @[Name](urn), hashtags as #tag. */
  commentary: z.string(),
  visibility: VisibilitySchema,
  distribution: DistributionSchema,
  /** PUBLISHED is the only value accepted on create. */
  lifecycleState: z.literal("PUBLISHED"),
  isReshareDisabledByAuthor: z.boolean().optional(),
  container: z.string().regex(/^urn:li:/).optional(),
  contentLandingPage: z.url().optional(),
  contentCallToActionLabel: ContentCallToActionLabelSchema.optional(),
});

export const CreatePostInputSchema = PostBaseSchema.extend({
  content: PostContentSchema.optional(),
  reshareContext: z.object({ parent: PostUrnSchema }).optional(),
});
export type CreatePostInput = z.input<typeof CreatePostInputSchema>;

/** Convenience shapes for each post type; all go through POST /rest/posts. */
const PostCommonInputSchema = PostBaseSchema.partial({ lifecycleState: true });
export const CreateTextPostInputSchema = PostCommonInputSchema;
export const CreateImagePostInputSchema = PostCommonInputSchema.extend({
  image: z.object({ id: ImageUrnSchema, altText: z.string().max(LINKEDIN_ALT_TEXT_MAX).optional() }),
});
export const CreateVideoPostInputSchema = PostCommonInputSchema.extend({
  video: z.object({ id: VideoUrnSchema, title: z.string().optional() }),
});
export const CreateDocumentPostInputSchema = PostCommonInputSchema.extend({
  document: z.object({ id: DocumentUrnSchema, title: z.string().min(1) }),
});
export const CreateMultiImagePostInputSchema = PostCommonInputSchema.extend({
  multiImage: MultiImageContentSchema,
});
export const CreateArticlePostInputSchema = PostCommonInputSchema.extend({ article: ArticleContentSchema });
export const CreatePollPostInputSchema = PostCommonInputSchema.extend({ poll: PollContentSchema });
export const ResharePostInputSchema = PostCommonInputSchema.extend({ parent: PostUrnSchema });
export type CreateTextPostInput = z.input<typeof CreateTextPostInputSchema>;
export type CreateImagePostInput = z.input<typeof CreateImagePostInputSchema>;
export type CreateVideoPostInput = z.input<typeof CreateVideoPostInputSchema>;
export type CreateDocumentPostInput = z.input<typeof CreateDocumentPostInputSchema>;
export type CreateMultiImagePostInput = z.input<typeof CreateMultiImagePostInputSchema>;
export type CreateArticlePostInput = z.input<typeof CreateArticlePostInputSchema>;
export type CreatePollPostInput = z.input<typeof CreatePollPostInputSchema>;
export type ResharePostInput = z.input<typeof ResharePostInputSchema>;

export const CreatedEntitySchema = z.object({ id: z.string().min(1) });
export type CreatedEntity = z.infer<typeof CreatedEntitySchema>;

export const PostSchema = z.looseObject({
  id: z.string(),
  author: z.string(),
  commentary: z.string().optional(),
  visibility: z.string(),
  distribution: z.looseObject({ feedDistribution: z.string() }).optional(),
  content: z.looseObject({}).optional(),
  lifecycleState: LifecycleStateSchema,
  lifecycleStateInfo: z
    .looseObject({
      isEditedByAuthor: z.boolean().optional(),
      contentStatus: z.string().nullable().optional(),
      reviewStatus: z.string().nullable().optional(),
    })
    .optional(),
  isReshareDisabledByAuthor: z.boolean().optional(),
  reshareContext: z.looseObject({ parent: z.string(), root: z.string().optional() }).optional(),
  contentLandingPage: z.string().optional(),
  contentCallToActionLabel: z.string().optional(),
  createdAt: z.number().optional(),
  lastModifiedAt: z.number().optional(),
  publishedAt: z.number().optional(),
});
export type LinkedInPost = z.infer<typeof PostSchema>;

export const GetPostInputSchema = z.object({ postUrn: PostUrnSchema, viewContext: ViewContextSchema.optional() });
export const BatchGetPostsInputSchema = z.object({
  postUrns: z.array(PostUrnSchema).min(1).max(100),
  viewContext: ViewContextSchema.optional(),
});
export const FindPostsByAuthorInputSchema = z.object({
  author: AuthorUrnSchema,
  viewContext: ViewContextSchema.optional(),
  sortBy: z.enum(["LAST_MODIFIED", "CREATED"]).optional(),
  ...startCount(LINKEDIN_POSTS_FINDER_MAX_COUNT),
});
export type GetPostInput = z.input<typeof GetPostInputSchema>;
export type BatchGetPostsInput = z.input<typeof BatchGetPostsInputSchema>;
export type FindPostsByAuthorInput = z.input<typeof FindPostsByAuthorInputSchema>;

/** Only these fields are updatable through the Posts API. */
export const UpdatePostInputSchema = z
  .object({
    postUrn: PostUrnSchema,
    commentary: z.string().optional(),
    contentCallToActionLabel: ContentCallToActionLabelSchema.optional(),
    contentLandingPage: z.url().optional(),
    lifecycleState: LifecycleStateSchema.optional(),
  })
  .refine(
    (v) =>
      v.commentary !== undefined ||
      v.contentCallToActionLabel !== undefined ||
      v.contentLandingPage !== undefined ||
      v.lifecycleState !== undefined,
    { message: "Provide at least one field to update" },
  );
export type UpdatePostInput = z.input<typeof UpdatePostInputSchema>;
export const DeletePostInputSchema = z.object({ postUrn: PostUrnSchema });

// ---------- images / documents ----------

export const InitializeImageUploadInputSchema = z.object({
  owner: AuthorUrnSchema,
  mediaLibraryMetadata: MediaLibraryMetadataInputSchema.optional(),
});
export type InitializeImageUploadInput = z.input<typeof InitializeImageUploadInputSchema>;

export const InitializeImageUploadResponseSchema = z.looseObject({
  value: z.looseObject({ uploadUrl: z.string(), uploadUrlExpiresAt: z.number(), image: z.string() }),
});

export const ImageSchema = z.looseObject({
  id: z.string(),
  owner: z.string(),
  status: MediaStatusSchema.optional(),
  downloadUrl: z.string().optional(),
  downloadUrlExpiresAt: z.number().optional(),
  aspectRatioHeight: z.number().nullable().optional(),
  aspectRatioWidth: z.number().nullable().optional(),
  altText: z.string().optional(),
  mediaLibraryMetadata: MediaLibraryMetadataSchema.optional(),
});
export type LinkedInImage = z.infer<typeof ImageSchema>;

export const UploadImageInputSchema = z.object({
  owner: AuthorUrnSchema,
  /** JPG, GIF (≤250 frames) or PNG, under 36,152,320 pixels. */
  source: MediaSourceSchema,
  mediaLibraryMetadata: MediaLibraryMetadataInputSchema.optional(),
});
export type UploadImageInput = z.input<typeof UploadImageInputSchema>;

export const InitializeDocumentUploadInputSchema = z.object({ owner: AuthorUrnSchema });
export const InitializeDocumentUploadResponseSchema = z.looseObject({
  value: z.looseObject({ uploadUrl: z.string(), uploadUrlExpiresAt: z.number(), document: z.string() }),
});
export const DocumentSchema = z.looseObject({
  id: z.string(),
  owner: z.string(),
  status: MediaStatusSchema.optional(),
  downloadUrl: z.string().optional(),
  downloadUrlExpiresAt: z.number().optional(),
});
export type LinkedInDocument = z.infer<typeof DocumentSchema>;
export const UploadDocumentInputSchema = z.object({
  owner: AuthorUrnSchema,
  /** PPT, PPTX, DOC, DOCX or PDF; ≤100 MB and ≤300 pages. */
  source: MediaSourceSchema,
});
export type UploadDocumentInput = z.input<typeof UploadDocumentInputSchema>;

export const MediaUrnListInputSchema = <T extends z.ZodType>(urn: T) =>
  z.object({ urns: z.array(urn).min(1).max(100) });

// ---------- videos ----------

export const InitializeVideoUploadInputSchema = z.object({
  owner: AuthorUrnSchema,
  fileSizeBytes: z.number().int().positive().max(LINKEDIN_VIDEO_MAX_BYTES),
  uploadCaptions: z.boolean().optional(),
  uploadThumbnail: z.boolean().optional(),
  mediaLibraryMetadata: MediaLibraryMetadataInputSchema.optional(),
  /** API version 202602+. */
  linkbackContext: z.string().optional(),
  /** API version 202602+. */
  templateName: z.string().optional(),
});
export type InitializeVideoUploadInput = z.input<typeof InitializeVideoUploadInputSchema>;

export const VideoUploadInstructionSchema = z.looseObject({
  uploadUrl: z.string(),
  firstByte: z.number().int(),
  lastByte: z.number().int(),
});
export const InitializeVideoUploadResponseSchema = z.looseObject({
  value: z.looseObject({
    video: z.string(),
    uploadInstructions: z.array(VideoUploadInstructionSchema).min(1),
    uploadToken: z.string(),
    uploadUrlsExpireAt: z.number().optional(),
    captionsUploadUrl: z.string().optional(),
    thumbnailUploadUrl: z.string().optional(),
  }),
});
export type InitializeVideoUploadResponse = z.infer<typeof InitializeVideoUploadResponseSchema>["value"];

export const FinalizeVideoUploadInputSchema = z.object({
  video: VideoUrnSchema,
  uploadToken: z.string(),
  /** ETags of each uploaded part, in upload-instruction order. */
  uploadedPartIds: z.array(z.string().min(1)).min(1),
});
export type FinalizeVideoUploadInput = z.input<typeof FinalizeVideoUploadInputSchema>;

export const UploadVideoPartInputSchema = z.object({
  uploadUrl: z.url(),
  data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: "Expected bytes" }),
});

/** Multipart metadata for caption upload (example values from the Videos API docs). */
export const VideoCaptionsMetadataSchema = z.object({
  format: z.string().min(1),
  formattedForEasyReader: z.boolean().optional(),
  largeText: z.boolean().optional(),
  source: z.string().optional(),
  locale: z.object({ variant: z.string().optional(), country: z.string(), language: z.string() }).optional(),
  transcriptType: z.string().optional(),
});
export const UploadVideoCaptionsInputSchema = z.object({
  captionsUploadUrl: z.url(),
  metadata: VideoCaptionsMetadataSchema,
  /** SRT file; only English captions are supported. */
  source: MediaSourceSchema,
});
export const UploadVideoThumbnailInputSchema = z.object({ thumbnailUploadUrl: z.url(), source: MediaSourceSchema });

export const UploadVideoInputSchema = z.object({
  owner: AuthorUrnSchema,
  /** MP4, 3 s – 30 min, 75 KB – 500 MB (5 GB API maximum). */
  source: MediaSourceSchema,
  thumbnail: MediaSourceSchema.optional(),
  captions: z.object({ metadata: VideoCaptionsMetadataSchema, source: MediaSourceSchema }).optional(),
  mediaLibraryMetadata: MediaLibraryMetadataInputSchema.optional(),
});
export type UploadVideoInput = z.input<typeof UploadVideoInputSchema>;

export const VideoSchema = z.looseObject({
  id: z.string(),
  owner: z.string().optional(),
  status: MediaStatusSchema.optional(),
  duration: z.number().optional(),
  aspectRatioHeight: z.number().nullable().optional(),
  aspectRatioWidth: z.number().nullable().optional(),
  downloadUrl: z.string().optional(),
  downloadUrlExpiresAt: z.number().optional(),
  thumbnail: z.string().optional(),
  captions: z.string().optional(),
  processingFailureReason: z.string().optional(),
  mediaLibraryMetadata: MediaLibraryMetadataSchema.optional(),
});
export type LinkedInVideo = z.infer<typeof VideoSchema>;

// ---------- comments ----------

export const CommentAttributeSchema = z.object({
  start: z.number().int().min(0),
  length: z.number().int().min(1),
  value: z
    .union([
      z.object({ person: z.object({ person: PersonUrnSchema }) }),
      z.object({ organization: z.object({ organization: OrganizationUrnSchema }) }),
    ])
    .optional(),
});
export const CommentMessageSchema = z.object({
  text: z.string().min(1),
  attributes: z.array(CommentAttributeSchema).optional(),
});

export const CreateCommentInputSchema = z.object({
  /** Post/activity URN, or a comment URN when replying to a comment. */
  target: CommentTargetUrnSchema,
  actor: AuthorUrnSchema,
  object: SocialThreadUrnSchema,
  message: CommentMessageSchema,
  /** Inline image comments: `{ entity: { image } }`. `type` is read-only. */
  content: z.array(z.object({ entity: z.object({ image: ImageUrnSchema }) })).optional(),
  parentComment: CommentUrnSchema.optional(),
});
export type CreateCommentInput = z.input<typeof CreateCommentInputSchema>;

export const CommentSchema = z.looseObject({
  id: z.string(),
  actor: z.string(),
  agent: z.string().optional(),
  commentUrn: z.string().optional(),
  object: z.string(),
  parentComment: z.string().optional(),
  message: z.looseObject({ text: z.string(), attributes: z.array(z.looseObject({})).optional() }),
  content: z
    .array(z.looseObject({ type: z.string().optional(), entity: z.looseObject({}).optional() }))
    .optional(),
  created: AuditStampSchema.optional(),
  lastModified: AuditStampSchema.optional(),
  likesSummary: z
    .looseObject({
      aggregatedTotalLikes: z.number().optional(),
      totalLikes: z.number().optional(),
      likedByCurrentUser: z.boolean().optional(),
      selectedLikes: z.array(z.string()).optional(),
    })
    .optional(),
});
export type LinkedInComment = z.infer<typeof CommentSchema>;

export const GetCommentsInputSchema = z.object({
  target: CommentTargetUrnSchema,
  ...startCount(LINKEDIN_POSTS_FINDER_MAX_COUNT),
});
export const GetCommentInputSchema = z.object({ target: CommentTargetUrnSchema, commentId: z.string().min(1) });
export const BatchGetCommentsInputSchema = z.object({
  target: CommentTargetUrnSchema,
  commentIds: z.array(z.string().min(1)).min(1).max(100),
});
export const UpdateCommentInputSchema = z.object({
  target: SocialThreadUrnSchema,
  commentId: z.string().min(1),
  /** Required only when editing as an organization. */
  actor: OrganizationUrnSchema.optional(),
  /** Only message.text and message.attributes can be modified. */
  message: CommentMessageSchema,
});
export const DeleteCommentInputSchema = z.object({
  target: SocialThreadUrnSchema,
  commentId: z.string().min(1),
  actor: OrganizationUrnSchema.optional(),
});
export type GetCommentsInput = z.input<typeof GetCommentsInputSchema>;
export type GetCommentInput = z.input<typeof GetCommentInputSchema>;
export type BatchGetCommentsInput = z.input<typeof BatchGetCommentsInputSchema>;
export type UpdateCommentInput = z.input<typeof UpdateCommentInputSchema>;
export type DeleteCommentInput = z.input<typeof DeleteCommentInputSchema>;

// ---------- reactions ----------

/** MAYBE is deprecated since 202307 (rejected on create). */
export const ReactionTypeSchema = z.enum(["LIKE", "PRAISE", "EMPATHY", "INTEREST", "APPRECIATION", "ENTERTAINMENT"]);
const ReactionEntitySchema = z.union([PostUrnSchema, ActivityUrnSchema, CommentUrnSchema]);

export const CreateReactionInputSchema = z.object({
  actor: AuthorUrnSchema,
  root: ReactionEntitySchema,
  reactionType: ReactionTypeSchema,
});
export const ReactionKeyInputSchema = z.object({ actor: AuthorUrnSchema, entity: ReactionEntitySchema });
export const BatchGetReactionsInputSchema = z.object({ keys: z.array(ReactionKeyInputSchema).min(1).max(100) });
export const FindReactionsInputSchema = z.object({
  entity: ReactionEntitySchema,
  sort: z.enum(["CHRONOLOGICAL", "REVERSE_CHRONOLOGICAL", "RELEVANCE"]).optional(),
  ...startCount(LINKEDIN_POSTS_FINDER_MAX_COUNT),
});
export type CreateReactionInput = z.input<typeof CreateReactionInputSchema>;
export type ReactionKeyInput = z.input<typeof ReactionKeyInputSchema>;
export type BatchGetReactionsInput = z.input<typeof BatchGetReactionsInputSchema>;
export type FindReactionsInput = z.input<typeof FindReactionsInputSchema>;

export const ReactionSchema = z.looseObject({
  id: z.string(),
  /** String (not enum) so historic MAYBE reactions still parse. */
  reactionType: z.string(),
  root: z.string(),
  created: AuditStampSchema.optional(),
  lastModified: AuditStampSchema.optional(),
});
export type LinkedInReaction = z.infer<typeof ReactionSchema>;

// ---------- social metadata ----------

export const CommentsStateSchema = z.enum(["OPEN", "CLOSED", "PROCESSING", "DELETED"]);
export const SocialMetadataSchema = z.looseObject({
  entity: z.string(),
  commentsState: CommentsStateSchema.optional(),
  commentSummary: z.looseObject({ count: z.number(), topLevelCount: z.number() }).optional(),
  reactionSummaries: z
    .record(z.string(), z.looseObject({ reactionType: z.string(), count: z.number() }))
    .optional(),
});
export type LinkedInSocialMetadata = z.infer<typeof SocialMetadataSchema>;

export const GetSocialMetadataInputSchema = z.object({ entity: ReactionEntitySchema });
export const BatchGetSocialMetadataInputSchema = z.object({
  entities: z.array(ReactionEntitySchema).min(1).max(100),
});
export const SetCommentsStateInputSchema = z.object({
  /** Thread URN only (comment URNs are rejected). */
  entity: SocialThreadUrnSchema,
  actor: AuthorUrnSchema,
  /** CLOSED deletes all existing comments on the thread. */
  commentsState: z.enum(["OPEN", "CLOSED"]),
});
export type SetCommentsStateInput = z.input<typeof SetCommentsStateInputSchema>;

// ---------------------------------------------------------------------------
// Share on LinkedIn (UGC API, w_member_social) — member posts.
// https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin
// ---------------------------------------------------------------------------

export const DigitalMediaAssetUrnSchema = z.string().regex(/^urn:li:digitalmediaAsset:[^:]+$/, "Expected urn:li:digitalmediaAsset:{id}");
export const UgcPostUrnSchema = z.string().regex(/^urn:li:(share|ugcPost):\d+$/, "Expected urn:li:share/ugcPost");

export const UgcRecipeSchema = z.enum(["urn:li:digitalmediaRecipe:feedshare-image", "urn:li:digitalmediaRecipe:feedshare-video"]);

/** POST /v2/assets?action=registerUpload */
export const RegisterUploadInputSchema = z.object({
  owner: PersonUrnSchema,
  kind: z.enum(["image", "video"]),
});
export type RegisterUploadInput = z.input<typeof RegisterUploadInputSchema>;

export const RegisterUploadRequestSchema = z.object({
  registerUploadRequest: z.object({
    recipes: z.array(UgcRecipeSchema).length(1),
    owner: PersonUrnSchema,
    serviceRelationships: z.array(
      z.object({ relationshipType: z.literal("OWNER"), identifier: z.literal("urn:li:userGeneratedContent") }),
    ),
  }),
});

export const RegisterUploadResponseSchema = z.looseObject({
  value: z.looseObject({
    uploadMechanism: z.looseObject({
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": z.looseObject({
        uploadUrl: z.url(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    }),
    mediaArtifact: z.string().optional(),
    asset: DigitalMediaAssetUrnSchema,
  }),
});
export type RegisterUploadResponse = z.infer<typeof RegisterUploadResponseSchema>;

/** GET /v2/assets/{id} — processing state per recipe. */
export const UgcAssetStatusSchema = z.enum(["NEW", "PROCESSING", "AVAILABLE", "WAITING_UPLOAD", "CLIENT_ERROR", "PROCESSING_FAILED"]);
export const UgcAssetSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  recipes: z.array(z.looseObject({ recipe: z.string(), status: UgcAssetStatusSchema.or(z.string()) })).default([]),
});
export type UgcAsset = z.infer<typeof UgcAssetSchema>;

export const UgcVisibilitySchema = z.enum(["PUBLIC", "CONNECTIONS"]);
export const UgcShareMediaCategorySchema = z.enum(["NONE", "ARTICLE", "IMAGE", "VIDEO"]);

const UgcTextSchema = z.object({ text: z.string() });

export const UgcShareMediaSchema = z.object({
  status: z.literal("READY"),
  media: DigitalMediaAssetUrnSchema.optional(),
  originalUrl: z.url().optional(),
  title: UgcTextSchema.optional(),
  description: UgcTextSchema.optional(),
});

/** POST /v2/ugcPosts body (exact wire shape). */
export const UgcPostBodySchema = z.object({
  author: PersonUrnSchema,
  lifecycleState: z.literal("PUBLISHED"),
  specificContent: z.object({
    "com.linkedin.ugc.ShareContent": z.object({
      shareCommentary: UgcTextSchema,
      shareMediaCategory: UgcShareMediaCategorySchema,
      media: z.array(UgcShareMediaSchema).max(LINKEDIN_UGC_MAX_IMAGES).optional(),
    }),
  }),
  visibility: z.object({ "com.linkedin.ugc.MemberNetworkVisibility": UgcVisibilitySchema }),
});
export type UgcPostBody = z.infer<typeof UgcPostBodySchema>;

/** Friendly input for createUgcPost. */
export const CreateUgcPostInputSchema = z
  .object({
    author: PersonUrnSchema,
    commentary: z.string().max(3000),
    visibility: UgcVisibilitySchema.default("PUBLIC"),
    mediaCategory: UgcShareMediaCategorySchema,
    media: z
      .array(
        z.object({
          asset: DigitalMediaAssetUrnSchema.optional(),
          originalUrl: z.url().optional(),
          title: z.string().max(200).optional(),
          description: z.string().max(300).optional(),
        }),
      )
      .max(LINKEDIN_UGC_MAX_IMAGES)
      .optional(),
  })
  .refine((v) => (v.mediaCategory === "NONE") === !v.media?.length, {
    message: "media is required for ARTICLE/IMAGE/VIDEO and not allowed for NONE",
    path: ["media"],
  })
  .refine((v) => v.mediaCategory !== "VIDEO" || v.media?.length === 1, { message: "A video share has exactly one video", path: ["media"] });
export type CreateUgcPostInput = z.input<typeof CreateUgcPostInputSchema>;

// ---------------------------------------------------------------------------
// Compose (Fannout composer). Single source for the UI fields and validation.
// ---------------------------------------------------------------------------


export const LINKEDIN_COMMENTARY_MAX = 3000;

/**
 * Capabilities with the Share on LinkedIn (UGC) API — the default. It has no
 * custom video thumbnail, ≤9 images per post and single-request uploads.
 */
export const LINKEDIN_COMPOSE: ComposeCapabilities = {
  supportsVideo: true,
  supportsPhotos: true,
  maxPhotos: LINKEDIN_UGC_MAX_IMAGES,
  minCarousel: 1,
  supportsThumbnail: false,
  mediaRules: { maxVideoBytes: LINKEDIN_UGC_VIDEO_MAX_BYTES, minVideoSeconds: 3, maxVideoSeconds: 30 * 60 },
  // DELETE /v2/ugcPosts/{urn} (idempotent; no update) — https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api
  supportsDelete: true,
  deleteNote: "Deletes the post from your LinkedIn profile.",
  supportsEdit: false,
  editableFields: [],
  editNote: "Share on LinkedIn has no edit endpoint. Delete and repost instead.",
};

/** With LINKEDIN_USE_COMMUNITY_API=true (Community Management /rest/posts). */
export const LINKEDIN_COMMUNITY_COMPOSE: ComposeCapabilities = {
  supportsVideo: true,
  supportsPhotos: true,
  maxPhotos: LINKEDIN_MULTI_IMAGE.max,
  minCarousel: 1,
  supportsThumbnail: true,
  mediaRules: { maxVideoBytes: LINKEDIN_VIDEO_MAX_BYTES, minVideoSeconds: 3, maxVideoSeconds: 30 * 60 },
  supportsDelete: true,
  deleteNote: "Deletes the post from your LinkedIn profile.",
  supportsEdit: true,
  editableFields: ["commentary"],
  editNote: "Only the post text can be edited (Community Management API).",
};

export const LinkedInComposeInputSchema = z.object({
  commentary: composeField(z.string().max(LINKEDIN_COMMENTARY_MAX, `Posts can be at most ${LINKEDIN_COMMENTARY_MAX} characters`).optional(), {
    label: "Post text", description: "Post commentary (max 3,000 characters).",
    kind: "textarea",
    countMode: "chars",
    maxLength: LINKEDIN_COMMENTARY_MAX,
    ai: true,
  }),
  visibility: composeField(z.enum(["PUBLIC", "CONNECTIONS"]), {
    label: "Visibility", description: "PUBLIC = anyone; CONNECTIONS = connections only (member posts).",
    kind: "select",
    defaultValue: "PUBLIC",
    options: [
      { value: "PUBLIC", label: "Anyone" },
      { value: "CONNECTIONS", label: "Connections only" },
    ],
  }),
  videoTitle: composeField(z.string().max(200).optional(), {
    label: "Video title", description: "Title of the video (max 200 characters).",
    kind: "text",
    countMode: "chars",
    maxLength: 200,
    mediaType: "video",
  }),
  isReshareDisabledByAuthor: composeField(z.boolean().optional(), { label: "Disable resharing", description: "Stop others from resharing the post.", kind: "toggle" }),
});
export type LinkedInComposeInput = z.infer<typeof LinkedInComposeInputSchema>;
