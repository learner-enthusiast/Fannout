# LinkedIn

**Provider class:** `LinkedInProvider` (`packages/providers/linkedin`)
**Transport:** direct HTTP through the shared `HttpClient` (no official maintained Node SDK — see [sdk-comparison](sdk-comparison.md)).
**Base URL:** `https://api.linkedin.com/rest` (Rest.li 2.0). OIDC UserInfo uses `https://api.linkedin.com/v2/userinfo`.
**Versioning:** every request sends `LinkedIn-Version: YYYYMM` (default `202610`, override with `version`) and
`X-RestLi-Protocol-Version: 2.0.0`. Each version is supported for about 12 months.

```ts
const linkedin = new LinkedInProvider({ accessToken });
const me = await linkedin.getAuthenticatedPersonUrn();
await linkedin.createTextPost({ author: me, commentary: "Hello", visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED" } });
```

## Endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `getUserInfo()` | GET | `/v2/userinfo` | HTTP | — | `openid profile` (+`email`) | IMPLEMENTED | OIDC claims of the authenticated member (scope `openid profile email`). |
| `getAuthenticatedAccount()` | helper | — | HTTP | — | `openid profile` (+`email`) | IMPLEMENTED |  |
| `getAuthenticatedPersonUrn()` | helper | The person URN for the token's member, derived from the OIDC subject. | HTTP | — | `openid profile` (+`email`) | IMPLEMENTED |  |
| `findMemberOrganizationAcls()` | GET | `/rest/organizationAcls?q=roleAssignee` | HTTP | `FindMemberOrganizationAclsInputSchema` | `r_organization_admin` / `rw_organization_admin` | IMPLEMENTED | organizations the member has roles on. |
| `findOrganizationAcls()` | GET | `/rest/organizationAcls?q=organization` | HTTP | `FindOrganizationAclsInputSchema` | `r_organization_admin` / `rw_organization_admin` | IMPLEMENTED | roles on one organization (e.g. its administrators). |
| `getOrganization()` | GET | `/rest/organizations/{id}` | HTTP | `OrganizationIdSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | administered organization (ADMINISTRATOR role required). |
| `batchGetOrganizations()` | GET | `/rest/organizations?ids=List(...)` | HTTP | `BatchGetOrganizationsInputSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | administered organizations. |
| `batchLookupOrganizations()` | GET | `/rest/organizationsLookup?ids=List(...)` | HTTP | `BatchGetOrganizationsInputSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | non-admin fields of any organizations. |
| `findOrganizationByVanityName()` | GET | `/rest/organizations?q=vanityName` | HTTP | `FindOrganizationByVanityNameInputSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | non-admin fields. |
| `findOrganizationsByParent()` | GET | `/rest/organizations?q=parentOrganization` | HTTP | `FindOrganizationsByParentInputSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | administered brands of a parent organization. |
| `getOrganizationFollowerCount()` | GET | `/rest/networkSizes/{orgUrn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER` | HTTP | `OrganizationUrnSchema` | `r_organization_admin` (admin fields); lookup: any member token | IMPLEMENTED | follower count. |
| `createPost()` | POST | `/rest/posts` | HTTP | `CreatePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | any organic post type. Returns the share/ugcPost URN (x-restli-id). |
| `createTextPost()` | helper | Text-only post. | HTTP | `CreateTextPostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createImagePost()` | helper | Single-image post (upload the image first with uploadImage). | HTTP | `CreateImagePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createVideoPost()` | helper | Video post (upload with uploadVideo; the video should be AVAILABLE). | HTTP | `CreateVideoPostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createDocumentPost()` | helper | Document post; `title` is required for documents. | HTTP | `CreateDocumentPostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createMultiImagePost()` | helper | Organic MultiImage post (2–20 images). | HTTP | `CreateMultiImagePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createArticlePost()` | helper | Article post. LinkedIn does not scrape the URL — set title/description/thumbnail yourself. | HTTP | `CreateArticlePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `createPollPost()` | helper | Organic poll post (2–4 options). | HTTP | `CreatePollPostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `resharePost()` | helper | Reshare an existing post (reshareContext.parent). | HTTP | `ResharePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `getPost()` | GET | `/rest/posts/{urn}` | HTTP | `GetPostInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `batchGetPosts()` | GET | `/rest/posts?ids=List(...)` | HTTP | `BatchGetPostsInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) | (X-RestLi-Method: BATCH_GET) |
| `findPostsByAuthor()` | GET | `/rest/posts?q=author` | HTTP | `FindPostsByAuthorInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) | posts by a member (r_member_social, restricted) or organization (r_organization_social). Max count 100. |
| `updatePost()` | POST | `/rest/posts/{urn}` | HTTP | `UpdatePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | (PARTIAL_UPDATE) — commentary, CTA label, landing page, lifecycleState. |
| `deletePost()` | DELETE | `/rest/posts/{urn}` | HTTP | `DeletePostInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | idempotent (204 even if already deleted). |
| `initializeImageUpload()` | POST | `/rest/images?action=initializeUpload` | HTTP | `InitializeImageUploadInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `uploadToUrl()` | PUT | `the` | HTTP | `z` | `w_member_social` / `w_organization_social` | IMPLEMENTED | binary to an upload URL returned by initializeImageUpload / initializeDocumentUpload. |
| `uploadImage()` | helper | initializeUpload + binary upload. Returns the image URN to use in posts/comments. | HTTP | `UploadImageInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `getImage()` | GET | `/rest/images/{urn}` | HTTP | `ImageUrnSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) | (needs read permission; w_member_social alone is write-only). |
| `batchGetImages()` | GET | `/rest/images?ids=List(...)` | HTTP | `MediaUrnListInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `initializeDocumentUpload()` | POST | `/rest/documents?action=initializeUpload` | HTTP | `InitializeDocumentUploadInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `uploadDocument()` | helper | initializeUpload + upload. Returns the document URN (title is set on the post). | HTTP | `UploadDocumentInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `getDocument()` | GET | `/rest/documents/{urn}` | HTTP | `DocumentUrnSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `batchGetDocuments()` | GET | `/rest/documents?ids=List(...)` | HTTP | `MediaUrnListInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `initializeVideoUpload()` | POST | `/rest/videos?action=initializeUpload` | HTTP | `InitializeVideoUploadInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | returns per-part upload URLs. |
| `uploadVideoPart()` | PUT | `one` | HTTP | `UploadVideoPartInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | part; returns its ETag (needed for finalize). |
| `finalizeVideoUpload()` | POST | `/rest/videos?action=finalizeUpload` | HTTP | `FinalizeVideoUploadInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `uploadVideoThumbnail()` | PUT | `a` | HTTP | `UploadVideoThumbnailInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | thumbnail image to `thumbnailUploadUrl` (header media-type-family: STILLIMAGE). |
| `uploadVideoCaptions()` | POST | `multipart` | HTTP | `UploadVideoCaptionsInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED | (metadata JSON + SRT file) to `captionsUploadUrl`. |
| `uploadVideo()` | helper | Full multipart video upload: initialize → PUT each 4 MiB part (collect ETags) → optional thumbnail/captions → finalize. Streams the source; at most one part is held in memory. Poll getVideo until status is AVAILABLE. | HTTP | `UploadVideoInputSchema` | `w_member_social` / `w_organization_social` | IMPLEMENTED |  |
| `getVideo()` | GET | `/rest/videos/{urn}` | HTTP | `VideoUrnSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `batchGetVideos()` | GET | `/rest/videos?ids=List(...)` | HTTP | `MediaUrnListInputSchema` | `r_member_social` (restricted) or `r_organization_social` | RESTRICTED (member reads need r_member_social) |  |
| `createComment()` | POST | `/rest/socialActions/{target}/comments` | HTTP | `CreateCommentInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED | top-level or nested (parentComment). |
| `getComments()` | GET | `/rest/socialActions/{target}/comments` | HTTP | `GetCommentsInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED | comments on a post, or replies to a comment. |
| `getComment()` | GET | `/rest/socialActions/{target}/comments/{commentId}` | HTTP | `GetCommentInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED |  |
| `batchGetComments()` | GET | `/rest/socialActions/{target}/comments?ids=List(...)` | HTTP | `BatchGetCommentsInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED |  |
| `updateComment()` | POST | `/rest/socialActions/{target}/comments/{id}` | HTTP | `UpdateCommentInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED | (PARTIAL_UPDATE) — only message text/attributes. |
| `deleteComment()` | DELETE | `/rest/socialActions/{target}/comments/{id}` | HTTP | `DeleteCommentInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED | (`actor` when deleting as an organization). |
| `createReaction()` | POST | `/rest/reactions?actor={urn}` | HTTP | `CreateReactionInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED | react to a post or comment. |
| `getReaction()` | GET | `/rest/reactions/(actor:…,entity:…)` | HTTP | `ReactionKeyInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED |  |
| `batchGetReactions()` | GET | `/rest/reactions?ids=List((actor:…,entity:…),…)` | HTTP | `BatchGetReactionsInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED |  |
| `findReactions()` | GET | `/rest/reactions/(entity:{urn})?q=entity` | HTTP | `FindReactionsInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED | reactions on a post or comment. |
| `deleteReaction()` | DELETE | `/rest/reactions/(actor:…,entity:…)` | HTTP | `ReactionKeyInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED |  |
| `getSocialMetadata()` | GET | `/rest/socialMetadata/{urn}` | HTTP | `GetSocialMetadataInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED | reaction & comment summaries, comments state. |
| `batchGetSocialMetadata()` | GET | `/rest/socialMetadata?ids=List(...)` | HTTP | `BatchGetSocialMetadataInputSchema` | `r_member_social_feed` / `r_organization_social_feed` | IMPLEMENTED |  |
| `setCommentsState()` | POST | `/rest/socialMetadata/{thread}?actor=` | HTTP | `SetCommentsStateInputSchema` | `w_member_social_feed` / `w_organization_social_feed` | IMPLEMENTED | open/close comments (CLOSED deletes existing comments). |

## Permissions and product access

- `w_member_social` (Share on LinkedIn) is self-serve; member **reads** (`r_member_social`, `r_member_social_feed`) are restricted to approved partners.
- Organization APIs need the Community Management API product and a member with the right Page role
  (ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER, RECRUITING_POSTER, …).
- The default OAuth scopes in `.env` (`openid profile email`) only allow identity calls. Add `w_member_social` to publish.

## Pagination

Rest.li `start`/`count`. Methods return `Page<T>` with `nextCursor` (the next `start`) derived from `paging`. Posts finder max `count` is 100.

## Rate limits

Per-application and per-member daily limits, shown in the Developer Portal (not in headers). A 429 is retried with backoff and `Retry-After` is honoured.

## Unsupported / not applicable

| Operation | Status | Reason |
|---|---|---|
| Edit post media after publishing | UNSUPPORTED | `PARTIAL_UPDATE` only covers commentary, CTA, landing page and lifecycle. |
| Legacy `ugcPosts` / `shares` APIs | DEPRECATED | Replaced by `/rest/posts`. |
| Member profile beyond OIDC claims | RESTRICTED | Full profile (`r_liteprofile` / `r_basicprofile`) is retired or partner-only. |

## Reading the tables

- **Input schema** is the Zod schema in `model.ts` that the method validates before any request. It is the source of truth for
  required vs optional parameters, nullability, enums, defaults and numeric/string limits — those details are not repeated here.
- **Response schema**: every method parses the response with a loose Zod object (documented fields typed, unknown fields kept);
  the class method's return type names it.
- **helper** rows compose several documented endpoints (e.g. create container → wait → publish) and add no new API surface.
- Status values: IMPLEMENTED, RESTRICTED (implemented, but needs App Review / special access / a paid tier), UNSUPPORTED
  (the provider has no API for it), DEPRECATED, NOT APPLICABLE.
