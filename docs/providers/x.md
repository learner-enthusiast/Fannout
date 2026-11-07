# X (Twitter)

**Provider class:** `XProvider` (`packages/providers/x`)
**Transport:** the official TypeScript XDK (`@xdevplatform/xdk`). The provider swaps the XDK transport for its own adapter,
which adds lazy token injection, 401 refresh, retries, timeouts and an injectable `fetch`. Inputs and outputs use the XDK's camelCase names.
**Base URL:** `https://api.x.com`. Auth is OAuth 2.0 user context (Bearer) from the existing `oauth4webapi` flow.

```ts
const x = new XProvider({ accessToken });
const post = await x.createPost({ text: "Hello" });
const media = await x.uploadMediaChunked({ source: { type: "stream", stream, size, mimeType: "video/mp4" }, mediaType: "video/mp4", mediaCategory: "tweet_video" });
```

## Endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `getAuthenticatedUserId()` | helper | Authenticated user's id (from config, else GET /2/users/me, cached). | HTTP | — | see composed calls | IMPLEMENTED |  |
| `getMe()` | GET | `/2/users/me` | `users.getMe` | `XUserLookupOptionsSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getAuthenticatedAccount()` | helper | — | HTTP | — | see composed calls | IMPLEMENTED |  |
| `getUserById()` | GET | `/2/users/:id` | `users.getById` | `XGetUserByIdInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getUserByUsername()` | GET | `/2/users/by/username/:username` | `users.getByUsername` | `XGetUserByUsernameInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getUsersByUsernames()` | GET | `/2/users/by?usernames=` | `users.getByUsernames` | `XGetUsersByUsernamesInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (≤100) |
| `getUsersByIds()` | GET | `/2/users?ids=` | `users.getByIds` | `XGetUsersByIdsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (≤100) |
| `searchUsers()` | GET | `/2/users/search` | `users.search` | `XSearchUsersInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getFollowers()` | GET | `/2/users/:id/followers` | `users.getFollowers` | `XUserConnectionsInputSchema` | `follows.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getFollowing()` | GET | `/2/users/:id/following` | `users.getFollowing` | `XUserConnectionsInputSchema` | `follows.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `followUser()` | POST | `/2/users/:id/following` | `users.followUser` | `XTargetUserInputSchema` | `follows.write` `tweet.read` `users.read` | IMPLEMENTED | (follows.write) |
| `unfollowUser()` | DELETE | `/2/users/:source_user_id/following/:target_user_id` | `users.unfollowUser` | `XTargetUserInputSchema` | `follows.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getBlockedUsers()` | GET | `/2/users/:id/blocking` | `users.getBlocking` | `XBlockMuteListInputSchema` | `block.read` `tweet.read` `users.read` | IMPLEMENTED | (block.read). Blocking/unblocking writes are not in the v2 API. |
| `getMutedUsers()` | GET | `/2/users/:id/muting` | `users.getMuting` | `XBlockMuteListInputSchema` | `mute.read` `tweet.read` `users.read` | IMPLEMENTED | (mute.read) |
| `muteUser()` | POST | `/2/users/:id/muting` | `users.muteUser` | `XTargetUserInputSchema` | `mute.write` `tweet.read` `users.read` | IMPLEMENTED | (mute.write) |
| `unmuteUser()` | DELETE | `/2/users/:source_user_id/muting/:target_user_id` | `users.unmuteUser` | `XTargetUserInputSchema` | `mute.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `createPost()` | POST | `/2/tweets` | `posts.create` | `XCreatePostInputSchema` | `tweet.write` `tweet.read` `users.read` | IMPLEMENTED | text, media, poll, reply, quote, edit… |
| `replyToPost()` | helper | Reply to a post (POST /2/tweets with reply.inReplyToTweetId). | HTTP | `XReplyInputSchema` | see composed calls | IMPLEMENTED |  |
| `quotePost()` | helper | Quote a post (POST /2/tweets with quoteTweetId). | HTTP | `XQuoteInputSchema` | see composed calls | IMPLEMENTED |  |
| `deletePost()` | DELETE | `/2/tweets/:id` | `posts.delete` | `XPostIdInputSchema` | `tweet.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getPost()` | GET | `/2/tweets/:id` | `posts.getById` | `XGetPostInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getPosts()` | GET | `/2/tweets?ids=` | `posts.getByIds` | `XGetPostsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (≤100) |
| `getQuotePosts()` | GET | `/2/tweets/:id/quote_tweets` | `posts.getQuoted` | `XQuotePostsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getRepostedBy()` | GET | `/2/tweets/:id/retweeted_by` | `posts.getRepostedBy` | `XPostUsersInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getLikingUsers()` | GET | `/2/tweets/:id/liking_users` | `posts.getLikingUsers` | `XPostUsersInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `hideReply()` | PUT | `/2/tweets/:id/hidden` | `posts.hideReply` | `XHideReplyInputSchema` | `tweet.moderate.write` `tweet.read` `users.read` | IMPLEMENTED | hide/unhide a reply to the user's own conversation. |
| `searchRecentPosts()` | GET | `/2/tweets/search/recent` | `posts.searchRecent` | `XSearchRecentInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (last 7 days) |
| `searchAllPosts()` | GET | `/2/tweets/search/all` | `posts.searchAll` | `XSearchAllInputSchema` | `tweet.read` `users.read` | RESTRICTED (Pro / Enterprise) | (full archive — Pro/Enterprise only) |
| `getRecentPostCounts()` | GET | `/2/tweets/counts/recent` | `posts.getCountsRecent` | `XRecentCountsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getConversation()` | helper | Conversation thread via recent search `conversation_id:{id}` (last 7 days only). | HTTP | `XConversationInputSchema` | see composed calls | IMPLEMENTED |  |
| `repost()` | POST | `/2/users/:id/retweets` | `users.repostPost` | `XPostIdInputSchema` | `tweet.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `undoRepost()` | DELETE | `/2/users/:id/retweets/:source_tweet_id` | `users.unrepostPost` | `XPostIdInputSchema` | `tweet.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `likePost()` | POST | `/2/users/:id/likes` | `users.likePost` | `XPostIdInputSchema` | `like.write` `tweet.read` `users.read` | IMPLEMENTED | (like.write) |
| `unlikePost()` | DELETE | `/2/users/:id/likes/:tweet_id` | `users.unlikePost` | `XPostIdInputSchema` | `like.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getLikedPosts()` | GET | `/2/users/:id/liked_tweets` | `users.getLikedPosts` | `XLikedPostsInputSchema` | `like.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getBookmarks()` | GET | `/2/users/:id/bookmarks` | `users.getBookmarks` | `XBookmarksInputSchema` | `bookmark.read` `tweet.read` `users.read` | IMPLEMENTED | (authenticated user only) |
| `bookmarkPost()` | POST | `/2/users/:id/bookmarks` | `users.createBookmark` | `XBookmarkPostInputSchema` | `bookmark.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `removeBookmark()` | DELETE | `/2/users/:id/bookmarks/:tweet_id` | `users.deleteBookmark` | `XPostIdInputSchema` | `bookmark.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getUserPosts()` | GET | `/2/users/:id/tweets` | `users.getPosts` | `XUserPostsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (user timeline) |
| `getUserMentions()` | GET | `/2/users/:id/mentions` | `users.getMentions` | `XMentionsInputSchema` | `tweet.read` `users.read` | IMPLEMENTED |  |
| `getHomeTimeline()` | GET | `/2/users/:id/timelines/reverse_chronological` | `users.getTimeline` | `XHomeTimelineInputSchema` | `tweet.read` `users.read` | IMPLEMENTED | (authenticated user's home timeline) |
| `uploadMedia()` | POST | `/2/media/upload` | `media.upload` | `XUploadMediaInputSchema` | `media.write` | IMPLEMENTED | single request (images/GIFs; small media). |
| `initializeMediaUpload()` | POST | `/2/media/upload/initialize` | `media.initializeUpload` | `XInitializeMediaUploadInputSchema` | `media.write` | IMPLEMENTED | (chunked upload, step 1) |
| `appendMediaUpload()` | POST | `/2/media/upload/:id/append` | `media.appendUpload` | `XAppendMediaUploadInputSchema` | `media.write` | IMPLEMENTED | (chunked upload, step 2; one segment) |
| `finalizeMediaUpload()` | POST | `/2/media/upload/:id/finalize` | `media.finalizeUpload` | `XIdSchema` | `media.write` | IMPLEMENTED | (chunked upload, step 3) |
| `getMediaUploadStatus()` | GET | `/2/media/upload?command=STATUS&media_id=` | `media.getUploadStatus` | `XIdSchema` | `media.write` | IMPLEMENTED | (async processing state) |
| `setMediaAltText()` | POST | `/2/media/metadata` | `media.createMetadata` | `XMediaAltTextInputSchema` | `media.write` | IMPLEMENTED | alt text for uploaded media. |
| `uploadMediaChunked()` | helper | Chunked upload (videos, GIFs, large images): INIT → APPEND segments (streamed, one chunk in memory) → FINALIZE → poll STATUS until `succeeded`. Returns the media id for createPost({ media: { mediaIds } }). | HTTP | `XUploadMediaChunkedInputSchema` | see composed calls | IMPLEMENTED |  |
| `createList()` | POST | `/2/lists` | `lists.create` | `XCreateListInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `updateList()` | PUT | `/2/lists/:id` | `lists.update` | `XUpdateListInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `deleteList()` | DELETE | `/2/lists/:id` | `lists.delete` | `XListIdInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getList()` | GET | `/2/lists/:id` | `lists.getById` | `XGetListInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getListMembers()` | GET | `/2/lists/:id/members` | `lists.getMembers` | `XListMembersInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `addListMember()` | POST | `/2/lists/:id/members` | `lists.addMember` | `XListMemberInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `removeListMember()` | DELETE | `/2/lists/:id/members/:user_id` | `lists.removeMemberByUserId` | `XListMemberInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getListPosts()` | GET | `/2/lists/:id/tweets` | `lists.getPosts` | `XListPostsInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getListFollowers()` | GET | `/2/lists/:id/followers` | `lists.getFollowers` | `XListMembersInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getOwnedLists()` | GET | `/2/users/:id/owned_lists` | `users.getOwnedLists` | `XUserListsInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getFollowedLists()` | GET | `/2/users/:id/followed_lists` | `users.getFollowedLists` | `XUserListsInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getListMemberships()` | GET | `/2/users/:id/list_memberships` | `users.getListMemberships` | `XUserListsInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `followList()` | POST | `/2/users/:id/followed_lists` | `users.followList` | `XListIdInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `unfollowList()` | DELETE | `/2/users/:id/followed_lists/:list_id` | `users.unfollowList` | `XListIdInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getPinnedLists()` | GET | `/2/users/:id/pinned_lists` | `users.getPinnedLists` | `XPinnedListsInputSchema` | `list.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `pinList()` | POST | `/2/users/:id/pinned_lists` | `users.pinList` | `XListIdInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `unpinList()` | DELETE | `/2/users/:id/pinned_lists/:list_id` | `users.unpinList` | `XListIdInputSchema` | `list.write` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getSpace()` | GET | `/2/spaces/:id` | `spaces.getById` | `XGetSpaceInputSchema` | `space.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getSpaces()` | GET | `/2/spaces?ids=` | `spaces.getByIds` | `XGetSpacesInputSchema` | `space.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getSpacesByCreators()` | GET | `/2/spaces/by/creator_ids` | `spaces.getByCreatorIds` | `XSpacesByCreatorsInputSchema` | `space.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `searchSpaces()` | GET | `/2/spaces/search` | `spaces.search` | `XSearchSpacesInputSchema` | `space.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getSpacePosts()` | GET | `/2/spaces/:id/tweets` | `spaces.getPosts` | `XSpacePostsInputSchema` | `space.read` `tweet.read` `users.read` | IMPLEMENTED |  |
| `getSpaceBuyers()` | GET | `/2/spaces/:id/buyers` | `spaces.getBuyers` | `XSpaceBuyersInputSchema` | `space.read` `tweet.read` `users.read` | RESTRICTED (ticketed Spaces creator) | (ticketed Spaces created by the user) |
| `getDmEvents()` | GET | `/2/dm_events` | `directMessages.getEvents` | `XDmEventsInputSchema` | `dm.read` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `getDmEvent()` | GET | `/2/dm_events/:event_id` | `directMessages.getEventsById` | `XDmEventInputSchema` | `dm.read` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `deleteDmEvent()` | DELETE | `/2/dm_events/:event_id` | `directMessages.deleteEvents` | `XIdSchema` | `dm.write` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `getDmConversationEvents()` | GET | `/2/dm_conversations/:id/dm_events` | `directMessages.getEventsByConversationId` | `XDmConversationEventsInputSchema` | `dm.read` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `getDmEventsWithParticipant()` | GET | `/2/dm_conversations/with/:participant_id/dm_events` | `directMessages.getEventsByParticipantId` | `XDmParticipantEventsInputSchema` | `dm.read` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `sendDmToConversation()` | POST | `/2/dm_conversations/:dm_conversation_id/messages` | `directMessages.createByConversationId` | `XSendDmToConversationInputSchema` | `dm.write` `tweet.read` `users.read` | RESTRICTED (tier-dependent) |  |
| `sendDmToParticipant()` | POST | `/2/dm_conversations/with/:participant_id/messages` | `directMessages.createByParticipantId` | `XSendDmToParticipantInputSchema` | `dm.write` `tweet.read` `users.read` | RESTRICTED (tier-dependent) | (1:1) |
| `createDmGroupConversation()` | POST | `/2/dm_conversations` | `directMessages.createConversation` | `XCreateDmGroupInputSchema` | `dm.write` `tweet.read` `users.read` | RESTRICTED (tier-dependent) | (group conversation) |

## Access tiers

Endpoint availability and monthly caps depend on the X API plan (Free / Basic / Pro / Enterprise). Full-archive search is Pro or Enterprise only.
Free tier cannot read most endpoints. Every write also needs `offline.access` if you want refresh tokens. The default `.env` scopes are
`tweet.read users.read offline.access`, so publishing needs `tweet.write` (and `media.write` for uploads).

## Pagination

Token-based (`paginationToken` → `meta.nextToken`), returned as `Page.nextCursor`.

## Rate limits

`x-rate-limit-limit`, `-remaining` and `-reset` are parsed into `ProviderError.rateLimit`. 429 responses are retried until the reset time, up to `retry.maxRetries`.

## Unsupported / not applicable

| Operation | Status | Reason |
|---|---|---|
| Block / unblock writes | UNSUPPORTED | Not in X API v2; only `GET /2/users/:id/blocking` exists. |
| Full conversation tree beyond 7 days | RESTRICTED | Needs full-archive search (Pro/Enterprise); `getConversation` uses recent search. |
| Edit posts | RESTRICTED | Only via `createPost` `editOptions` within X's edit window, for eligible accounts. |

## Reading the tables

- **Input schema** is the Zod schema in `model.ts` that the method validates before any request. It is the source of truth for
  required vs optional parameters, nullability, enums, defaults and numeric/string limits — those details are not repeated here.
- **Response schema**: every method parses the response with a loose Zod object (documented fields typed, unknown fields kept);
  the class method's return type names it.
- **helper** rows compose several documented endpoints (e.g. create container → wait → publish) and add no new API surface.
- Status values: IMPLEMENTED, RESTRICTED (implemented, but needs App Review / special access / a paid tier), UNSUPPORTED
  (the provider has no API for it), DEPRECATED, NOT APPLICABLE.
