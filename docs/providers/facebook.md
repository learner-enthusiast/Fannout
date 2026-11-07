# Facebook Pages (Meta)

**Provider class:** `FacebookProvider` (`packages/providers/facebook`)
**Transport:** direct HTTP via the shared `HttpClient`. See [sdk-comparison](sdk-comparison.md) for why the Meta Business SDK isn't used.
**Base URLs:** `https://graph.facebook.com/{version}`, plus `https://graph-video.facebook.com/{version}` for `/{page-id}/videos` uploads and the
`upload_url` (`rupload.facebook.com`) returned for Reels. The version defaults to `v23.0` and the factory passes `FACEBOOK_GRAPH_VERSION`.
**Auth:** the selected **Page access token** as `access_token`, plus `appsecret_proof` when `appSecret` is configured. The factory always sets it.
Tokens stay on the server, and the client-safe connection view strips them.
**Identity:** each connected Page is its own connection (`providerAccountId` = Page id) holding its own Page token. Pages are discovered after Facebook Login by the OAuth adapter (`/me/accounts`).

```ts
const facebook = new FacebookProvider({ accessToken: pageAccessToken, pageId, appSecret });
await facebook.createPost({ message: "Hello", link: "https://example.com" });
await facebook.uploadPhoto({ media: { type: "buffer", data, mimeType: "image/jpeg" }, caption: "Photo" });
await facebook.uploadVideo({ media: { type: "stream", stream, size, mimeType: "video/mp4" }, title: "Video" }); // chunked
await facebook.publishReel({ media: { type: "url", url }, video_state: "PUBLISHED", description: "#reel" });
```

## Endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `getPage()` | GET | `/{page-id}.` | HTTP | `GetPageInputSchema` | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED |  |
| `getAuthenticatedAccount()` | helper | — | HTTP | — | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED |  |
| `listFeed()` | GET | `/{page-id}/feed` | HTTP | `ListFeedInputSchema` | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED | posts by the Page incl. unpublished (max 100 per page). |
| `listTagged()` | GET | `/{page-id}/tagged` | HTTP | `ListFeedInputSchema` | Page token: `pages_read_user_content` `pages_show_list` | RESTRICTED (may need Page Public Content Access) | posts the Page is tagged/mentioned in. Needs pages_read_user_content. |
| `getPageInsights()` | GET | `/{page-id}/insights` | HTTP | `GetPageInsightsInputSchema` | Page token (ANALYZE): `read_insights` `pages_read_engagement` | IMPLEMENTED | needs read_insights + pages_read_engagement (ANALYZE task). |
| `getPostInsights()` | GET | `/{page-post-id}/insights.` | HTTP | `GetPostInsightsInputSchema` | Page token (ANALYZE): `read_insights` `pages_read_engagement` | IMPLEMENTED |  |
| `createPost()` | POST | `/{page-id}/feed` | HTTP | `CreatePostInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | text, link, scheduled or carousel-link posts. Needs pages_manage_posts. |
| `createTextPost()` | helper | Text-only Page post. | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED |  |
| `createLinkPost()` | helper | Link Page post (optionally with a message). | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED |  |
| `getPost()` | GET | `/{page-post-id}.` | HTTP | `GetPostInputSchema` | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED | Reels are not returned by this endpoint. |
| `updatePost()` | POST | `/{page-post-id}` | HTTP | `UpdatePostInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED (only posts created by this app) | only posts created by this app. |
| `publishUnpublishedPost()` | helper | Publish a post created with published=false. | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED (only posts created by this app) |  |
| `deletePost()` | DELETE | `/{page-post-id}` | HTTP | `PagePostIdSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | RESTRICTED (Meta: select developers only) | Meta restricts this to select developers. |
| `uploadPhoto()` | POST | `/{page-id}/photos` | HTTP | `UploadPhotoInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | `url` sources by URL, otherwise multipart `source`. |
| `listPhotos()` | GET | `/{page-id}/photos?type=uploaded\|profile\|tagged.` | HTTP | `ListPhotosInputSchema` | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED |  |
| `startVideoUpload()` | POST | `/{page-id}/videos` | HTTP | `StartVideoUploadInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=start. |
| `transferVideoChunk()` | POST | `/{page-id}/videos` | HTTP | `TransferVideoChunkInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=transfer — returns the next offsets (start === end when done). |
| `finishVideoUpload()` | POST | `/{page-id}/videos` | HTTP | `FinishVideoUploadInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=finish — sets metadata and publishes (unless published=false). |
| `cancelVideoUpload()` | POST | `/{page-id}/videos` | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=cancel. |
| `uploadVideo()` | helper | Upload and publish a Page video. URL sources use `file_url` (Meta fetches it); bytes/streams use the chunked start → transfer → finish protocol. | HTTP | `UploadVideoInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED |  |
| `getVideoStatus()` | GET | `/{video-id}?fields=status` | HTTP | `GraphNodeIdSchema` | Page token: `pages_show_list` `pages_read_engagement` | IMPLEMENTED | upload/processing/publishing phases. |
| `startReelUpload()` | POST | `/{page-id}/video_reels` | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=start → video_id + upload_url. |
| `uploadReel()` | POST | `{upload_url}` | HTTP | `UploadReelInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | (rupload.facebook.com) with the bytes, or a `file_url` header for hosted files. |
| `finishReel()` | POST | `/{page-id}/video_reels` | HTTP | `FinishReelInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | upload_phase=finish — publish, draft or schedule. |
| `publishReel()` | helper | Reel in one call (30 API-published reels per Page per 24h). | HTTP | `PublishReelInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED |  |
| `listComments()` | GET | `/{object-id}/comments.` | HTTP | `ListCommentsInputSchema` | Page token: `pages_read_engagement` (`pages_read_user_content` for user comments) | IMPLEMENTED |  |
| `getComment()` | GET | `/{comment-id}.` | HTTP | `GetCommentInputSchema` | Page token: `pages_read_engagement` (`pages_read_user_content` for user comments) | IMPLEMENTED |  |
| `createComment()` | POST | `/{object-id}/comments` | HTTP | `CreateCommentInputSchema` | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED | comment on a post, or reply when objectId is a comment. Needs pages_manage_engagement. |
| `replyToComment()` | helper | Reply to a comment. | HTTP | — | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED |  |
| `updateComment()` | POST | `/{comment-id}` | HTTP | `UpdateCommentInputSchema` | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED | edit, or hide/unhide (Page comments only). |
| `hideComment()` | helper | — | HTTP | — | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED |  |
| `unhideComment()` | helper | — | HTTP | — | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED |  |
| `deleteComment()` | DELETE | `/{comment-id}.` | HTTP | `GraphNodeIdSchema` | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED |  |
| `listReactions()` | GET | `/{object-id}/reactions.` | HTTP | `ListReactionsInputSchema` | Page token: `pages_read_engagement` (`pages_read_user_content` for user comments) | IMPLEMENTED | Only the Page's own reaction is visible per object. |
| `like()` | POST | `/{object-id}/likes` | HTTP | `GraphNodeIdSchema` | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED | like as the Page (creating other reaction types is not supported by the API). |
| `unlike()` | DELETE | `/{object-id}/likes` | HTTP | `GraphNodeIdSchema` | Page token (MODERATE): `pages_manage_engagement` | IMPLEMENTED | remove the Page's like. |
| `listSubscribedApps()` | GET | `/{page-id}/subscribed_apps.` | HTTP | — | Page token: `pages_manage_metadata` `pages_show_list` | IMPLEMENTED | Needs pages_manage_metadata. |
| `subscribeApp()` | POST | `/{page-id}/subscribed_apps` | HTTP | `SubscribeAppInputSchema` | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED | subscribe this app to Page webhook fields. |
| `unsubscribeApp()` | DELETE | `/{page-id}/subscribed_apps.` | HTTP | — | Page token (CREATE_CONTENT): `pages_manage_posts` `pages_read_engagement` `pages_show_list` | IMPLEMENTED |  |
| `verifyWebhookSubscription()` | helper | — | HTTP | — | Page token: `pages_manage_metadata` `pages_show_list` | IMPLEMENTED |  |
| `verifyWebhookSignature()` | helper | — | HTTP | — | app secret / verify token | IMPLEMENTED |  |
| `parseWebhookPayload()` | helper | Parse a (signature-verified) Page webhook body: { object: "page", entry: [{ id, time, changes }] }. | HTTP | — | app secret / verify token | IMPLEMENTED |  |

## Media workflows

- **Photos:** `url` sources are sent as `url`, and byte/stream sources as multipart `source`. Use `published: false` (plus `temporary: true` for scheduled posts)
  to upload without publishing.
- **Videos:** URL sources use a single `file_url` request. Byte/stream sources use the chunked `upload_phase` protocol (`start` → `transfer` → `finish`).
  The server sets each chunk's offsets, and the provider reads them sequentially, keeping at most one chunk in memory. A failed transfer sends `cancel`.
- **Reels:** `startReelUpload` → `uploadReel` (bytes with `offset` / `file_size` headers, or a `file_url` header for hosted files) → `finishReel`.
  `publishReel` runs all three. Limit: 30 API-published reels per Page per 24 h. Scheduling must be more than 10 minutes and less than 29 days ahead.
- **Unpublished posts:** create with `published: false`, then `publishUnpublishedPost(postId)`.
- **Scheduling:** feed posts need `published: false` plus `scheduled_publish_time` 10 minutes to 75 days ahead. Videos allow up to 6 months.

## Pagination

Cursor-based (`paging.cursors.after/before`). Methods return `Page<T>` with `nextCursor` only when `paging.next` exists. Feed `limit` is at most 100.

## Rate limits

Meta's Business Use Case and app limits come back in `x-app-usage` / `x-business-use-case-usage` and are parsed into `ProviderError.rateLimit.usage`.
Graph error codes are exposed as `ProviderError.providerCode` (`code` or `code:subcode`, e.g. `190:463` for an expired token).

## Webhooks

`subscribeApp({ subscribed_fields: ["feed", "mention"] })` subscribes the app on the Page. The fields must also be subscribed at app level.
`verifyWebhookSubscription`, `verifyWebhookSignature` (`X-Hub-Signature-256`, raw body) and `parseWebhookPayload`
(`{ object: "page", entry: [{ id, time, changes: [{ field, value }] }] }`) handle the receiving side.

## Unsupported / not applicable

| Operation | Status | Reason |
|---|---|---|
| Publishing to personal profiles | NOT APPLICABLE | The Graph API doesn't allow it. |
| Multi-photo posts (`attached_media`) | UNSUPPORTED (not implemented) | Not in Meta's current Page feed / Pages API docs, so it isn't implemented rather than guessed. |
| Creating reactions other than Like | UNSUPPORTED | The `/reactions` edge is read-only. Only `/likes` supports POST and DELETE. |
| Reading `/{page-id}/video_reels` | UNSUPPORTED | Meta documents the edge as not readable. |
| Resumable upload API (`/{app-id}/uploads`) | NOT APPLICABLE | Needs a *user* token and app id. Page-token chunked upload is used instead. |
| Updating / deleting reels | UNSUPPORTED | Not supported on `video_reels`. |
| Instagram | NOT APPLICABLE | Out of scope. |

## Reading the tables

- **Input schema** is the Zod schema in `model.ts` that the method validates before any request. It is the source of truth for
  required vs optional parameters, nullability, enums, defaults and numeric/string limits — those details are not repeated here.
- **Response schema**: every method parses the response with a loose Zod object (documented fields typed, unknown fields kept);
  the class method's return type names it.
- **helper** rows compose several documented endpoints (e.g. create container → wait → publish) and add no new API surface.
- Status values: IMPLEMENTED, RESTRICTED (implemented, but needs App Review / special access / a paid tier), UNSUPPORTED
  (the provider has no API for it), DEPRECATED, NOT APPLICABLE.
