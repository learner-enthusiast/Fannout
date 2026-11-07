# Threads (Meta)

**Provider class:** `ThreadsProvider` (`packages/providers/threads`)
**Transport:** direct HTTP via the shared `HttpClient`. Meta publishes no official Threads SDK, and the npm packages are unofficial or reverse-engineered.
**Base URL:** `https://graph.threads.net/v1.0` (`graph.threads.com` also works; `.net` matches the OAuth adapter). The token is sent as `access_token`.
**Identity:** Threads **user** tokens and the Threads user id only. Facebook Page tokens are never used here.

```ts
const threads = new ThreadsProvider({ accessToken, userId });
await threads.publishText({ text: "Hello Threads", reply_control: "everyone" });
await threads.publishVideo({ video_url: "https://cdn.example.com/clip.mp4", text: "Clip" }); // waits for FINISHED
await threads.publishCarousel({ items: [{ media_type: "IMAGE", image_url }, { media_type: "VIDEO", video_url }] });
```

## Endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `getProfile()` | GET | `/{threads-user-id}` | HTTP | `GetProfileInputSchema` | `threads_basic` | IMPLEMENTED | profile of the configured (or given) user. |
| `getAuthenticatedAccount()` | helper | — | HTTP | — | `threads_basic` | IMPLEMENTED |  |
| `lookupProfile()` | GET | `/profile_lookup` | HTTP | `ProfileLookupInputSchema` | `threads_basic` `threads_profile_discovery` | RESTRICTED (standard access: official Meta accounts only) | public profile (≥100 followers). Needs threads_profile_discovery. |
| `getProfilePosts()` | GET | `/profile_posts` | HTTP | `ProfilePostsInputSchema` | `threads_basic` `threads_profile_discovery` | RESTRICTED (standard access: official Meta accounts only) | public posts of a profile. Needs threads_profile_discovery. |
| `listThreads()` | GET | `/{threads-user-id}/threads` | HTTP | `ListUserThreadsInputSchema` | `threads_basic` | IMPLEMENTED | the user's own posts. |
| `listUserReplies()` | GET | `/{threads-user-id}/replies` | HTTP | `ListUserRepliesInputSchema` | `threads_basic` `threads_read_replies` | IMPLEMENTED | replies the user created. Needs threads_read_replies. |
| `listMentions()` | GET | `/{threads-user-id}/mentions` | HTTP | `ListUserMediaInputSchema` | `threads_basic` `threads_manage_mentions` | RESTRICTED (advanced access for non-testers) | public posts mentioning the user. Needs threads_manage_mentions. |
| `listGhostPosts()` | GET | `/{threads-user-id}/ghost_posts` | HTTP | `ListUserMediaInputSchema` | `threads_basic` | IMPLEMENTED | the user's ghost posts. |
| `getPublishingLimit()` | GET | `/{threads-user-id}/threads_publishing_limit` | HTTP | `GetPublishingLimitInputSchema` | `threads_basic` | IMPLEMENTED | current 24h quota usage. |
| `createContainer()` | POST | `/{threads-user-id}/threads` | HTTP | `CreateContainerInputSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED | create a media container (TEXT, IMAGE, VIDEO or CAROUSEL). |
| `createCarouselItem()` | POST | `/{threads-user-id}/threads` | HTTP | `CreateCarouselItemInputSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED | with is_carousel_item=true. |
| `publishContainer()` | POST | `/{threads-user-id}/threads_publish` | HTTP | `PublishContainerInputSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED | publish a FINISHED container. Needs threads_content_publish. |
| `getContainerStatus()` | GET | `/{container-id}?fields=id,status,error_message` | HTTP | `ThreadsIdSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED | container processing status. |
| `waitForContainer()` | helper | Poll a container until FINISHED (Meta: once a minute, at most 5 minutes). Throws on ERROR / EXPIRED / timeout. | HTTP | `WaitForContainerOptionsSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `publishText()` | helper | Text post (also used for polls, link/GIF/text attachments, quotes and replies). | HTTP | `ThreadsTextContainerSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `publishImage()` | helper | Image post from a public image URL. | HTTP | `ThreadsImageContainerSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `publishVideo()` | helper | Video post from a public video URL; waits for processing before publishing. | HTTP | `ThreadsVideoContainerSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `publishCarousel()` | helper | Carousel (2–20 items): creates each child, waits for them, then creates and publishes the parent. | HTTP | `PublishCarouselInputSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `createReply()` | helper | Reply to a post or reply (text). Needs threads_manage_replies. | HTTP | `CreateReplyInputSchema` | `threads_basic` `threads_manage_replies` | IMPLEMENTED |  |
| `createQuotePost()` | helper | Quote a post (text). | HTTP | `CreateQuotePostInputSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED |  |
| `repost()` | POST | `/{threads-media-id}/repost.` | HTTP | `ThreadsIdSchema` | `threads_basic` `threads_content_publish` | IMPLEMENTED | Needs threads_content_publish. |
| `deletePost()` | DELETE | `/{threads-media-id}` | HTTP | `ThreadsIdSchema` | `threads_basic` `threads_delete` | IMPLEMENTED | own posts only (100/day). Needs threads_delete. |
| `getPost()` | GET | `/{threads-media-id}.` | HTTP | `GetMediaInputSchema` | `threads_basic` | IMPLEMENTED |  |
| `listReplies()` | GET | `/{threads-media-id}/replies` | HTTP | `ListRepliesInputSchema` | `threads_basic` `threads_read_replies` | IMPLEMENTED | top-level replies. Needs threads_read_replies. |
| `listConversation()` | GET | `/{threads-media-id}/conversation` | HTTP | `ListRepliesInputSchema` | `threads_basic` `threads_read_replies` | IMPLEMENTED | flattened replies at all depths. |
| `listPendingReplies()` | GET | `/{threads-media-id}/pending_replies` | HTTP | `ListPendingRepliesInputSchema` | `threads_basic` `threads_read_replies` | IMPLEMENTED | replies awaiting approval. |
| `manageReply()` | POST | `/{threads-reply-id}/manage_reply` | HTTP | `ManageReplyInputSchema` | `threads_basic` `threads_manage_replies` | IMPLEMENTED | hide (true) or unhide (false). Needs threads_manage_replies. |
| `hideReply()` | helper | — | HTTP | — | `threads_basic` `threads_manage_replies` | IMPLEMENTED |  |
| `unhideReply()` | helper | — | HTTP | — | `threads_basic` `threads_manage_replies` | IMPLEMENTED |  |
| `managePendingReply()` | POST | `/{threads-reply-id}/manage_pending_reply` | HTTP | `ManagePendingReplyInputSchema` | `threads_basic` `threads_manage_replies` | IMPLEMENTED | approve (true) or ignore (false). |
| `getMediaInsights()` | GET | `/{threads-media-id}/insights.` | HTTP | `GetMediaInsightsInputSchema` | `threads_basic` `threads_manage_insights` | IMPLEMENTED | Needs threads_manage_insights. |
| `getUserInsights()` | GET | `/{threads-user-id}/threads_insights.` | HTTP | `GetUserInsightsInputSchema` | `threads_basic` `threads_manage_insights` | IMPLEMENTED | Needs threads_manage_insights. |
| `keywordSearch()` | GET | `/keyword_search` | HTTP | `KeywordSearchInputSchema` | `threads_basic` `threads_keyword_search` | RESTRICTED (advanced access for non-testers) | public posts by keyword or tag (2,200 queries/24h). Needs threads_keyword_search. |
| `searchLocations()` | GET | `/location_search` | HTTP | `LocationSearchInputSchema` | `threads_basic` (location tagging) | IMPLEMENTED | locations to tag (500/24h). |
| `getLocation()` | GET | `/{location-id}.` | HTTP | `GetLocationInputSchema` | `threads_basic` (location tagging) | IMPLEMENTED |  |
| `getOEmbed()` | GET | `https://www.threads.com/oembed` | HTTP | `OEmbedInputSchema` | none (public endpoint; no token is sent) | IMPLEMENTED | embed HTML for a public post or profile (no token is sent to this host). |
| `verifyWebhookSubscription()` | helper | Answer Meta's GET verification: returns hub.challenge or null. | HTTP | — | app secret / verify token | IMPLEMENTED |  |
| `verifyWebhookSignature()` | helper | Check X-Hub-Signature-256 against the exact raw body. | HTTP | — | app secret / verify token | IMPLEMENTED |  |
| `parseWebhookEvent()` | helper | Parse a (signature-verified) notification body. | HTTP | — | app secret / verify token | IMPLEMENTED |  |

## Publishing model

1. `createContainer` (`POST /{user-id}/threads`): `TEXT`, `IMAGE`, `VIDEO` or `CAROUSEL`. Media must be on a **public URL**, because Meta downloads it.
   There is no byte-upload endpoint, so `MediaSource` byte/stream sources can't be used with Threads until object storage provides public URLs.
2. Poll `getContainerStatus` until `FINISHED`. Meta's guidance is once a minute for at most 5 minutes, which is the `waitForContainer` default.
   Statuses: `EXPIRED`, `ERROR` (with `error_message`), `FINISHED`, `IN_PROGRESS`, `PUBLISHED`.
3. `publishContainer` (`POST /{user-id}/threads_publish`). Text containers can skip this step with `auto_publish_text: true`.

Constraints enforced by the schemas: text ≤ 500 characters, alt text ≤ 1,000 characters, carousel 2–20 children, poll options 2–4 of 1–25 characters,
topic tag 1–50 characters with no `.` or `&`, ≤ 10 spoiler entities, `before`/`after` mutually exclusive, list `limit` ≤ 100,
`since` ≥ 1688540400 (insights ≥ 1712991600), and `followers_count`/`follower_demographics` without `since`/`until`.

## Limits (per profile, rolling 24 h)

250 posts · 1,000 replies · 100 deletes · 500 location searches · 2,200 keyword searches · 1,000 profile lookups.
Live usage comes from `getPublishingLimit()`. Meta's `x-app-usage` / `x-business-use-case-usage` headers are parsed into `ProviderError.rateLimit.usage`.

## Webhooks

`ThreadsProvider.verifyWebhookSubscription` answers the `hub.challenge`. `verifyWebhookSignature` checks `X-Hub-Signature-256` (HMAC-SHA256 with the app secret)
against the **raw** body. `parseWebhookEvent` validates `{ app_id, topic, target_id, time, subscription_id, values: { field, value } }`.
The fields are `replies` and `delete` (topic `moderate`) and `mentions` and `publish` (topic `interaction`). Webhooks need Advanced Access or Live Mode and business verification.

## Unsupported / not applicable

| Operation | Status | Reason |
|---|---|---|
| Follow / unfollow, follower lists | UNSUPPORTED | No Threads API. Only `followers_count` and `follower_demographics` insights exist. |
| Direct messages | UNSUPPORTED | No Threads API. |
| Edit a published post | UNSUPPORTED | No Threads API. |
| Undo a repost | UNSUPPORTED | Not documented. |
| Upload media bytes | UNSUPPORTED | Containers only accept public `image_url` / `video_url`. |
| Token debug (`/debug_token`) | NOT APPLICABLE | Handled by the OAuth layer, not the content API. |

## Reading the tables

- **Input schema** is the Zod schema in `model.ts` that the method validates before any request. It is the source of truth for
  required vs optional parameters, nullability, enums, defaults and numeric/string limits — those details are not repeated here.
- **Response schema**: every method parses the response with a loose Zod object (documented fields typed, unknown fields kept);
  the class method's return type names it.
- **helper** rows compose several documented endpoints (e.g. create container → wait → publish) and add no new API surface.
- Status values: IMPLEMENTED, RESTRICTED (implemented, but needs App Review / special access / a paid tier), UNSUPPORTED
  (the provider has no API for it), DEPRECATED, NOT APPLICABLE.
