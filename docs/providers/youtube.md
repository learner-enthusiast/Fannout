# YouTube (Google)

**Provider classes:** `YouTubeProvider` (`packages/providers/youtube`) and `YouTubeAnalyticsProvider` (`packages/providers/youtube-analytics`)
**Transport:** the official Google clients `@googleapis/youtube` (Data API v3, including Live Streaming) and `@googleapis/youtubeanalytics` (v2).
Their auth is replaced per request with the connection's bearer token, so 401 refresh and retries match the other providers. SDK retries are turned off.
**Generated code:** the Zod schemas, `endpoints.ts` and one method per SDK endpoint are generated from the SDK's own typings by
`scripts/generate-google.mjs`. Re-run it after upgrading the SDK (`node scripts/generate-google.mjs`).

**Identity:** a connection is a **channel** (`providerAccountId` = channel id). `config.google.sub` records the Google account that granted access.
The factory passes both as `channelId` and `googleSubject`.

```ts
const youtube = new YouTubeProvider({ accessToken, channelId });
await youtube.insertVideo({ part: ["snippet", "status"], requestBody: { snippet: { title: "Demo" }, status: { privacyStatus: "private" } },
  media: { type: "stream", stream, size, mimeType: "video/mp4" } });
```

## Data API v3 endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `insertAbuseReport()` | POST | `/youtube/v3/abuseReports` | `abuseReports.insert` | `YouTubeAbuseReportsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$AbuseReport` |
| `listActivities()` | GET | `/youtube/v3/activities` | `activities.list` | `YouTubeActivitiesListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$ActivityListResponse` |
| `deleteCaption()` | DELETE | `/youtube/v3/captions` | `captions.delete` | `YouTubeCaptionsDeleteInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertCaption()` | POST | `/youtube/v3/captions` | `captions.insert` | `YouTubeCaptionsInsertInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: part; upload: `/upload/youtube/v3/captions`; response `Schema$Caption` |
| `listCaption()` | GET | `/youtube/v3/captions` | `captions.list` | `YouTubeCaptionsListInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: part, videoId; response `Schema$CaptionListResponse` |
| `updateCaption()` | PUT | `/youtube/v3/captions` | `captions.update` | `YouTubeCaptionsUpdateInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: part; upload: `/upload/youtube/v3/captions`; response `Schema$Caption` |
| `insertChannelBanner()` | POST | `/youtube/v3/channelBanners/insert` | `channelBanners.insert` | `YouTubeChannelBannersInsertInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: —; upload: `/upload/youtube/v3/channelBanners/insert`; response `Schema$ChannelBannerResource` |
| `listChannels()` | GET | `/youtube/v3/channels` | `channels.list` | `YouTubeChannelsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$ChannelListResponse` |
| `updateChannels()` | PUT | `/youtube/v3/channels` | `channels.update` | `YouTubeChannelsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Channel` |
| `deleteChannelSection()` | DELETE | `/youtube/v3/channelSections` | `channelSections.delete` | `YouTubeChannelSectionsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertChannelSection()` | POST | `/youtube/v3/channelSections` | `channelSections.insert` | `YouTubeChannelSectionsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$ChannelSection` |
| `listChannelSection()` | GET | `/youtube/v3/channelSections` | `channelSections.list` | `YouTubeChannelSectionsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$ChannelSectionListResponse` |
| `updateChannelSection()` | PUT | `/youtube/v3/channelSections` | `channelSections.update` | `YouTubeChannelSectionsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$ChannelSection` |
| `deleteComment()` | DELETE | `/youtube/v3/comments` | `comments.delete` | `YouTubeCommentsDeleteInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertComment()` | POST | `/youtube/v3/comments` | `comments.insert` | `YouTubeCommentsInsertInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Comment` |
| `listComment()` | GET | `/youtube/v3/comments` | `comments.list` | `YouTubeCommentsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$CommentListResponse` |
| `markAsSpamComment()` | POST | `/youtube/v3/comments/markAsSpam` | `comments.markAsSpam` | `YouTubeCommentsMarkAsSpamInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `setModerationStatusComment()` | POST | `/youtube/v3/comments/setModerationStatus` | `comments.setModerationStatus` | `YouTubeCommentsSetModerationStatusInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: id, moderationStatus; response `void` |
| `updateComment()` | PUT | `/youtube/v3/comments` | `comments.update` | `YouTubeCommentsUpdateInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Comment` |
| `insertCommentThread()` | POST | `/youtube/v3/commentThreads` | `commentThreads.insert` | `YouTubeCommentThreadsInsertInputSchema` | `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$CommentThread` |
| `listCommentThread()` | GET | `/youtube/v3/commentThreads` | `commentThreads.list` | `YouTubeCommentThreadsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$CommentThreadListResponse` |
| `listI18nLanguages()` | GET | `/youtube/v3/i18nLanguages` | `i18nLanguages.list` | `YouTubeI18nLanguagesListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$I18nLanguageListResponse` |
| `listI18nRegions()` | GET | `/youtube/v3/i18nRegions` | `i18nRegions.list` | `YouTubeI18nRegionsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$I18nRegionListResponse` |
| `bindLiveBroadcast()` | POST | `/youtube/v3/liveBroadcasts/bind` | `liveBroadcasts.bind` | `YouTubeLiveBroadcastsBindInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id, part; response `Schema$LiveBroadcast` |
| `deleteLiveBroadcast()` | DELETE | `/youtube/v3/liveBroadcasts` | `liveBroadcasts.delete` | `YouTubeLiveBroadcastsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertLiveBroadcast()` | POST | `/youtube/v3/liveBroadcasts` | `liveBroadcasts.insert` | `YouTubeLiveBroadcastsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$LiveBroadcast` |
| `insertCuepointLiveBroadcast()` | POST | `/youtube/v3/liveBroadcasts/cuepoint` | `liveBroadcasts.insertCuepoint` | `YouTubeLiveBroadcastsInsertCuepointInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: —; response `Schema$Cuepoint` |
| `listLiveBroadcast()` | GET | `/youtube/v3/liveBroadcasts` | `liveBroadcasts.list` | `YouTubeLiveBroadcastsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$LiveBroadcastListResponse` |
| `transitionLiveBroadcast()` | POST | `/youtube/v3/liveBroadcasts/transition` | `liveBroadcasts.transition` | `YouTubeLiveBroadcastsTransitionInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: broadcastStatus, id, part; response `Schema$LiveBroadcast` |
| `updateLiveBroadcast()` | PUT | `/youtube/v3/liveBroadcasts` | `liveBroadcasts.update` | `YouTubeLiveBroadcastsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$LiveBroadcast` |
| `deleteLiveChatBan()` | DELETE | `/youtube/v3/liveChat/bans` | `liveChatBans.delete` | `YouTubeLiveChatBansDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: id; response `void` |
| `insertLiveChatBan()` | POST | `/youtube/v3/liveChat/bans` | `liveChatBans.insert` | `YouTubeLiveChatBansInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: part; response `Schema$LiveChatBan` |
| `deleteLiveChatMessage()` | DELETE | `/youtube/v3/liveChat/messages` | `liveChatMessages.delete` | `YouTubeLiveChatMessagesDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: id; response `void` |
| `insertLiveChatMessage()` | POST | `/youtube/v3/liveChat/messages` | `liveChatMessages.insert` | `YouTubeLiveChatMessagesInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: part; response `Schema$LiveChatMessage` |
| `listLiveChatMessage()` | GET | `/youtube/v3/liveChat/messages` | `liveChatMessages.list` | `YouTubeLiveChatMessagesListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED (live) | required: liveChatId, part; response `Schema$LiveChatMessageListResponse` |
| `transitionLiveChatMessage()` | POST | `/youtube/v3/liveChat/messages/transition` | `liveChatMessages.transition` | `YouTubeLiveChatMessagesTransitionInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: —; response `Schema$LiveChatMessage` |
| `deleteLiveChatModerator()` | DELETE | `/youtube/v3/liveChat/moderators` | `liveChatModerators.delete` | `YouTubeLiveChatModeratorsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: id; response `void` |
| `insertLiveChatModerator()` | POST | `/youtube/v3/liveChat/moderators` | `liveChatModerators.insert` | `YouTubeLiveChatModeratorsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED (live) | required: part; response `Schema$LiveChatModerator` |
| `listLiveChatModerator()` | GET | `/youtube/v3/liveChat/moderators` | `liveChatModerators.list` | `YouTubeLiveChatModeratorsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED (live) | required: liveChatId, part; response `Schema$LiveChatModeratorListResponse` |
| `deleteLiveStream()` | DELETE | `/youtube/v3/liveStreams` | `liveStreams.delete` | `YouTubeLiveStreamsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertLiveStream()` | POST | `/youtube/v3/liveStreams` | `liveStreams.insert` | `YouTubeLiveStreamsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$LiveStream` |
| `listLiveStream()` | GET | `/youtube/v3/liveStreams` | `liveStreams.list` | `YouTubeLiveStreamsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$LiveStreamListResponse` |
| `updateLiveStream()` | PUT | `/youtube/v3/liveStreams` | `liveStreams.update` | `YouTubeLiveStreamsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$LiveStream` |
| `listMembers()` | GET | `/youtube/v3/members` | `members.list` | `YouTubeMembersListInputSchema` | `youtube.channel-memberships.creator` | RESTRICTED (memberships-enabled channels) | required: part; response `Schema$MemberListResponse` |
| `listMembershipsLevels()` | GET | `/youtube/v3/membershipsLevels` | `membershipsLevels.list` | `YouTubeMembershipsLevelsListInputSchema` | `youtube.channel-memberships.creator` | RESTRICTED (memberships-enabled channels) | required: part; response `Schema$MembershipsLevelListResponse` |
| `deletePlaylistImage()` | DELETE | `/youtube/v3/playlistImages` | `playlistImages.delete` | `YouTubePlaylistImagesDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: —; response `void` |
| `insertPlaylistImage()` | POST | `/youtube/v3/playlistImages` | `playlistImages.insert` | `YouTubePlaylistImagesInsertInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: —; upload: `/upload/youtube/v3/playlistImages`; response `Schema$PlaylistImage` |
| `listPlaylistImage()` | GET | `/youtube/v3/playlistImages` | `playlistImages.list` | `YouTubePlaylistImagesListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: —; response `Schema$PlaylistImageListResponse` |
| `updatePlaylistImage()` | PUT | `/youtube/v3/playlistImages` | `playlistImages.update` | `YouTubePlaylistImagesUpdateInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: —; upload: `/upload/youtube/v3/playlistImages`; response `Schema$PlaylistImage` |
| `deletePlaylistItem()` | DELETE | `/youtube/v3/playlistItems` | `playlistItems.delete` | `YouTubePlaylistItemsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertPlaylistItem()` | POST | `/youtube/v3/playlistItems` | `playlistItems.insert` | `YouTubePlaylistItemsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$PlaylistItem` |
| `listPlaylistItem()` | GET | `/youtube/v3/playlistItems` | `playlistItems.list` | `YouTubePlaylistItemsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$PlaylistItemListResponse` |
| `updatePlaylistItem()` | PUT | `/youtube/v3/playlistItems` | `playlistItems.update` | `YouTubePlaylistItemsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$PlaylistItem` |
| `deletePlaylist()` | DELETE | `/youtube/v3/playlists` | `playlists.delete` | `YouTubePlaylistsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertPlaylist()` | POST | `/youtube/v3/playlists` | `playlists.insert` | `YouTubePlaylistsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Playlist` |
| `listPlaylist()` | GET | `/youtube/v3/playlists` | `playlists.list` | `YouTubePlaylistsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$PlaylistListResponse` |
| `updatePlaylist()` | PUT | `/youtube/v3/playlists` | `playlists.update` | `YouTubePlaylistsUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Playlist` |
| `listSearch()` | GET | `/youtube/v3/search` | `search.list` | `YouTubeSearchListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$SearchListResponse` |
| `deleteSubscription()` | DELETE | `/youtube/v3/subscriptions` | `subscriptions.delete` | `YouTubeSubscriptionsDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `insertSubscription()` | POST | `/youtube/v3/subscriptions` | `subscriptions.insert` | `YouTubeSubscriptionsInsertInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Subscription` |
| `listSubscription()` | GET | `/youtube/v3/subscriptions` | `subscriptions.list` | `YouTubeSubscriptionsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$SubscriptionListResponse` |
| `listSuperChatEvents()` | GET | `/youtube/v3/superChatEvents` | `superChatEvents.list` | `YouTubeSuperChatEventsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED (live) | required: part; response `Schema$SuperChatEventListResponse` |
| `deleteThirdPartyLink()` | DELETE | `/youtube/v3/thirdPartyLinks` | `thirdPartyLinks.delete` | `YouTubeThirdPartyLinksDeleteInputSchema` | `youtube` or `youtube.force-ssl` | RESTRICTED (partner) | required: linkingToken, type; response `void` |
| `insertThirdPartyLink()` | POST | `/youtube/v3/thirdPartyLinks` | `thirdPartyLinks.insert` | `YouTubeThirdPartyLinksInsertInputSchema` | `youtube` or `youtube.force-ssl` | RESTRICTED (partner) | required: part; response `Schema$ThirdPartyLink` |
| `listThirdPartyLink()` | GET | `/youtube/v3/thirdPartyLinks` | `thirdPartyLinks.list` | `YouTubeThirdPartyLinksListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | RESTRICTED (partner) | required: part; response `Schema$ThirdPartyLinkListResponse` |
| `updateThirdPartyLink()` | PUT | `/youtube/v3/thirdPartyLinks` | `thirdPartyLinks.update` | `YouTubeThirdPartyLinksUpdateInputSchema` | `youtube` or `youtube.force-ssl` | RESTRICTED (partner) | required: part; response `Schema$ThirdPartyLink` |
| `setThumbnail()` | POST | `/youtube/v3/thumbnails/set` | `thumbnails.set` | `YouTubeThumbnailsSetInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: videoId; upload: `/upload/youtube/v3/thumbnails/set`; response `Schema$ThumbnailSetResponse` |
| `listVideoAbuseReportReasons()` | GET | `/youtube/v3/videoAbuseReportReasons` | `videoAbuseReportReasons.list` | `YouTubeVideoAbuseReportReasonsListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$VideoAbuseReportReasonListResponse` |
| `listVideoCategories()` | GET | `/youtube/v3/videoCategories` | `videoCategories.list` | `YouTubeVideoCategoriesListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$VideoCategoryListResponse` |
| `batchGetStatsVideo()` | GET | `/youtube/v3/videos:batchGetStats` | `videos.batchGetStats` | `YouTubeVideosBatchGetStatsInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: —; response `Schema$BatchGetStatsResponse` |
| `deleteVideo()` | DELETE | `/youtube/v3/videos` | `videos.delete` | `YouTubeVideosDeleteInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id; response `void` |
| `getRatingVideo()` | GET | `/youtube/v3/videos/getRating` | `videos.getRating` | `YouTubeVideosGetRatingInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: id; response `Schema$VideoGetRatingResponse` |
| `insertVideo()` | POST | `/youtube/v3/videos` | `videos.insert` | `YouTubeVideosInsertInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: part; upload: `/upload/youtube/v3/videos`; response `Schema$Video` |
| `listVideo()` | GET | `/youtube/v3/videos` | `videos.list` | `YouTubeVideosListInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: part; response `Schema$VideoListResponse` |
| `rateVideo()` | POST | `/youtube/v3/videos/rate` | `videos.rate` | `YouTubeVideosRateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: id, rating; response `void` |
| `reportAbuseVideo()` | POST | `/youtube/v3/videos/reportAbuse` | `videos.reportAbuse` | `YouTubeVideosReportAbuseInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: —; response `void` |
| `updateVideo()` | PUT | `/youtube/v3/videos` | `videos.update` | `YouTubeVideosUpdateInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: part; response `Schema$Video` |
| `getVideoTrainability()` | GET | `/youtube/v3/videoTrainability` | `videoTrainability.get` | `YouTubeVideoTrainabilityGetInputSchema` | `youtube.readonly` (or `youtube` / `youtube.force-ssl`) | IMPLEMENTED | required: —; response `Schema$VideoTrainability` |
| `setWatermark()` | POST | `/youtube/v3/watermarks/set` | `watermarks.set` | `YouTubeWatermarksSetInputSchema` | `youtube.upload` or `youtube` | IMPLEMENTED | required: channelId; upload: `/upload/youtube/v3/watermarks/set`; response `void` |
| `unsetWatermark()` | POST | `/youtube/v3/watermarks/unset` | `watermarks.unset` | `YouTubeWatermarksUnsetInputSchema` | `youtube` or `youtube.force-ssl` | IMPLEMENTED | required: channelId; response `void` |

Also implemented by hand: `downloadCaption()` (`GET /youtube/v3/captions/{id}`, SDK `captions.download`, input `YouTubeDownloadCaptionInputSchema`,
scope `youtube.force-ssl`), which returns the caption bytes instead of JSON. `tests.insert` (Google's internal test endpoint) is skipped on purpose.

## YouTube Analytics v2 endpoints

| Class method | HTTP | Endpoint | SDK method | Input schema | Scopes / permissions | Status | Notes |
|---|---|---|---|---|---|---|---|
| `deleteGroupItem()` | DELETE | `/v2/groupItems` | `groupItems.delete` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$EmptyResponse` |
| `insertGroupItem()` | POST | `/v2/groupItems` | `groupItems.insert` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$GroupItem` |
| `listGroupItem()` | GET | `/v2/groupItems` | `groupItems.list` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$ListGroupItemsResponse` |
| `deleteGroup()` | DELETE | `/v2/groups` | `groups.delete` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$EmptyResponse` |
| `insertGroup()` | POST | `/v2/groups` | `groups.insert` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$Group` |
| `listGroup()` | GET | `/v2/groups` | `groups.list` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$ListGroupsResponse` |
| `updateGroup()` | PUT | `/v2/groups` | `groups.update` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$Group` |
| `queryReports()` | GET | `/v2/reports` | `reports.query` | — | `yt-analytics.readonly` (`yt-analytics-monetary.readonly` for revenue) | IMPLEMENTED | response `Schema$QueryResponse` |

## Quota

The default is 10,000 units per day per Google Cloud project. Reads cost 1, `search.list` costs 100, `videos.insert` costs 100, most writes cost 50,
and caption insert/download cost 400/200 (`YOUTUBE_QUOTA_COST`). A `quotaExceeded` 403 is surfaced as `ProviderError` and not retried.

## Pagination

Use `pageToken` → `nextPageToken` on list methods (SDK-native; not re-wrapped).

## Not applicable / deprecated

| Operation | Status | Reason |
|---|---|---|
| `guideCategories.list` | DEPRECATED | Removed from the API and absent from the official SDK. |
| `activities.insert`, bulletins | DEPRECATED | Removed by Google. |
| Uploads > quota | RESTRICTED | Unverified projects' uploads are locked private until the project passes an audit. |

## Reading the tables

- **Input schema** is the Zod schema in `model.ts` that the method validates before any request. It is the source of truth for
  required vs optional parameters, nullability, enums, defaults and numeric/string limits — those details are not repeated here.
- **Response schema**: every method parses the response with a loose Zod object (documented fields typed, unknown fields kept);
  the class method's return type names it.
- **helper** rows compose several documented endpoints (e.g. create container → wait → publish) and add no new API surface.
- Status values: IMPLEMENTED, RESTRICTED (implemented, but needs App Review / special access / a paid tier), UNSUPPORTED
  (the provider has no API for it), DEPRECATED, NOT APPLICABLE.
