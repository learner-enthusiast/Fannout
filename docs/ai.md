# Fannout API agent guide

Fannout lets a person prepare media once and fan it out to connected social platforms.
Use this guide when acting through the HTTP API with a scoped personal API key.
This document is the contract. Follow it exactly.

Generated from code at ede26d7 on 2026-11-07. Do not edit generated sections by hand.

## Authentication

Set `API_PUBLIC_URL` to the public origin of the API (for example, `https://api.example.com`). The base URL is `{API_PUBLIC_URL}/api`.

Send `Authorization: Bearer fn_live_…`. Create keys in **Settings → API keys**. Never log, echo, commit, or return an API key to a human. Give each key only the scopes it needs.

## Scopes

| Scope | Operations |
| --- | --- |
| `posts:read` | GET /notifications<br>GET /notifications/unread-count<br>GET /posts/batches<br>GET /posts/batches/{batchId}<br>GET /posts/{postId} |
| `posts:write` | PATCH /posts/{postId}<br>POST /notifications/read<br>POST /notifications/read-all<br>POST /posts/batches<br>POST /posts/validate<br>POST /posts/{postId}/cancel-schedule<br>POST /posts/{postId}/publish-now<br>POST /posts/{postId}/repost<br>POST /posts/{postId}/reschedule<br>POST /posts/{postId}/retry |
| `posts:delete` | DELETE /posts/{postId}<br>POST /posts/batches/{batchId}/delete |
| `media:read` | GET /folders<br>GET /folders/{folderId}<br>GET /folders/{folderId}/items<br>GET /media<br>GET /media/{mediaId}<br>GET /search |
| `media:write` | DELETE /folders/{folderId}<br>DELETE /folders/{folderId}/items/{mediaId}<br>DELETE /media/{mediaId}<br>PATCH /folders/{folderId}<br>PATCH /folders/{folderId}/items/{mediaId}<br>PATCH /media/{mediaId}<br>POST /folders<br>POST /folders/from-suggestion<br>POST /folders/{folderId}/items<br>POST /media/uploads<br>POST /media/{mediaId}/complete<br>POST /media/{mediaId}/fail<br>PUT /folders/{folderId}/order |
| `connections:read` | GET /platforms/youtube/{socialConnectionId}/categories<br>GET /platforms/youtube/{socialConnectionId}/playlists<br>GET /social-connections<br>GET /social-connections/providers |
| `ai:generate` | GET /ai/generations/{generationId}<br>POST /ai/generations |

## Rate limits

| Bucket | Free API-key limit |
| --- | --- |
| `ai` | 20 requests / 3600 seconds |
| `api` | 60 requests / 60 seconds |
| `authFail` | 10 requests / 60 seconds; block 900 seconds |
| `delete` | 30 requests / 3600 seconds |
| `edit` | 30 requests / 3600 seconds |
| `publish` | 10 requests / 60 seconds<br>100 requests / 86400 seconds |

Every API-key response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (Unix seconds). A `429` also includes `Retry-After`; wait that many seconds before retrying and never hammer the endpoint.

## Conventions

- Send JSON request bodies only. GET input is sent as query parameters.
- List endpoints use cursor pagination: `limit` is at most 10, and keep following `nextCursor` until it is `null`.
- Use a UUID `idempotencyKey` for each intended publish. Reuse the same value only when retrying that exact publish.
- Timestamps are ISO-8601 UTC values. Limits labelled `chars`, `UTF-8 bytes`, and `weighted` use different counts; weighted fields count URLs as 23 characters.

## Errors

The tRPC/OpenAPI error envelope is `{ "error": { "message": string, "code": string, "data": { "appCode"?: string, "details"?: unknown } } }`. Plain Express errors use `{ "error": { "code": string, "message": string } }`.

| Code | Meaning | Agent action |
| --- | --- | --- |
| `UNAUTHORIZED` | Missing, invalid, revoked, expired, or temporarily blocked key | Stop and ask the human for a valid key. |
| `FORBIDDEN` | The key lacks the required scope | Stop and ask the human to create a key with the listed scope. |
| `VALIDATION` / `BAD_REQUEST` | Input is invalid | Fix the input; do not retry unchanged. |
| `NOT_FOUND` | Resource is absent or not owned by this key's user | List/search first, then report if still absent. |
| `CONFLICT` / `MEDIA_IN_USE` | Request conflicts with current state | Read the resource and resolve the conflict; do not blindly retry. |
| `TOO_MANY_REQUESTS` | A limit was reached | Wait `Retry-After`, then retry once. |
| `INTERNAL` | Unexpected server error | Retry only a safe/idempotent operation once, then report. |

## Workflows

### Upload media

1. `POST /media/uploads` (`media:write`) to get `mediaId`, `partSize`, and presigned part URLs.
2. PUT every byte range directly to its corresponding presigned URL; collect the response ETags.
3. `POST /media/{mediaId}/complete` with the ETags.
4. Poll `GET /media/{mediaId}` (`media:read`) until `status` is `ready` or `failed`. Do not publish failed media.

### Organize media

Create a folder with `POST /folders`, then use `POST /folders/{folderId}/items` to add media. Media remains in the library when a folder is deleted.

### Generate captions (optional)

Call `POST /ai/generations`, then poll `GET /ai/generations/{generationId}` until `status` is `succeeded` or `failed`. Review generated content before publishing.

### Validate and publish

First call `POST /posts/validate`. When it returns `valid: true`, call `POST /posts/batches` with the same payload and a UUID idempotency key. Poll `GET /posts/batches/{batchId}` until all posts have terminal statuses (`published`, `failed`, `cancelled`, or `deleted`).

### Schedule posts

Add `schedule: { at, timezone }` to a target, or `scheduleAll: { at, timezone }` to the batch, in `POST /posts/batches` (and `POST /posts/validate`). A target's own `schedule` wins; `scheduleAll` fills only targets without one; targets with neither publish immediately, so one batch can mix instant and scheduled posts.

- `at` is ISO 8601 with an offset or `Z` (e.g. `2026-11-07T19:00:00+05:30`); it is stored in UTC. `timezone` is an IANA name (e.g. `Asia/Kolkata`) used only for display.
- `at` must be at least 2 minutes and at most 180 days from now, otherwise validation returns an issue with `field: "schedule"` for that target.
- The response gives each post's `scheduledAt` (`null` = publishing now). Scheduled posts have status `scheduled`; the batch view's `posts[].schedule.status` is `scheduled` → `handed_off` (uploading ahead of time; nothing is public yet) → `completed`, or `cancelled`, `missed` (Fannout was offline more than 2 hours past the time), or `failed`.
- `POST /posts/{postId}/reschedule` sets a new time (while `scheduled` or `handed_off`, before it is published). `POST /posts/{postId}/cancel-schedule` cancels (idempotent). `POST /posts/{postId}/publish-now` publishes a scheduled or `missed` post right away. `DELETE /posts/{postId}` on a scheduled post also cancels it.
- `GET /posts/batches?filter=scheduled` lists batches that still have posts waiting.

### Edit, delete, or cancel posts

Use `PATCH /posts/{postId}` to queue an edit, `DELETE /posts/{postId}` to cancel/delete, and poll the batch or post afterwards. A delete result of `mode: "manual"` means that platform requires the human to delete the post in its native app (including any Instagram-like manual-delete requirement shown in its capability note).

### Notifications

List with `GET /notifications`; mark selected notifications read with `POST /notifications/read`, or all of them with `POST /notifications/read-all`.

## Platform reference

### Facebook (facebook)

video: true; photos: true; max photos: 10; thumbnail: false; delete: true; edit: true (message).

- Delete note: Deletes the post from your Page.
- Edit note: Only the post text can be edited, and only for posts made with Fannout.
- Media rules: maxVideoBytes=10737418240, maxVideoSeconds=14400, maxImageBytes=10485760

Fields for `targets[].input` when the account is Facebook:

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| message | string | optional | — | max length 63206 | Post message, or the video description for videos. |
| title | string | optional | — | max length 255 | Video title (max 255 characters). |
| content_category | BEAUTY_FASHION \| BUSINESS \| CARS_TRUCKS \| COMEDY \| CUTE_ANIMALS \| ENTERTAINMENT \| FAMILY \| FOOD_HEALTH \| HOME \| LIFESTYLE \| MUSIC \| NEWS \| POLITICS \| SCIENCE \| SPORTS \| TECHNOLOGY \| VIDEO_GAMING \| OTHER | optional | — | enum: BEAUTY_FASHION, BUSINESS, CARS_TRUCKS, COMEDY, CUTE_ANIMALS, ENTERTAINMENT, FAMILY, FOOD_HEALTH, HOME, LIFESTYLE, MUSIC, NEWS, POLITICS, SCIENCE, SPORTS, TECHNOLOGY, VIDEO_GAMING, OTHER | Facebook video content category. |

Minimal valid `input` (required fields only):

```json
{}
```

### LinkedIn (linkedin)

video: true; photos: true; max photos: 9; thumbnail: false; delete: true; edit: false (none).

- Delete note: Deletes the post from your LinkedIn profile.
- Edit note: Share on LinkedIn has no edit endpoint. Delete and repost instead.
- Media rules: maxVideoBytes=5368709120, minVideoSeconds=3, maxVideoSeconds=1800

Fields for `targets[].input` when the account is LinkedIn:

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| commentary | string | optional | — | max length 3000 | Post commentary (max 3,000 characters). |
| visibility | PUBLIC \| CONNECTIONS | required | — | enum: PUBLIC, CONNECTIONS | PUBLIC = anyone; CONNECTIONS = connections only (member posts). |
| videoTitle | string | optional | — | max length 200 | Title of the video (max 200 characters). |
| isReshareDisabledByAuthor | boolean | optional | — | — | Stop others from resharing the post. |

Minimal valid `input` (required fields only):

```json
{
  "visibility": "PUBLIC"
}
```

### Threads (threads)

video: true; photos: true; max photos: 20; thumbnail: false; delete: true; edit: false (none).

- Delete note: Needs the threads_delete permission. Threads allows 100 deletes per day.
- Edit note: The Threads API can't edit published posts. Delete and repost instead.
- Media rules: maxVideoBytes=1073741824, maxVideoSeconds=300, maxImageBytes=8388608, requiresPublicUrl=true

Fields for `targets[].input` when the account is Threads:

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| text | string | optional | — | max length 500 | Post text (max 500 UTF-8 bytes). |
| reply_control | everyone \| accounts_you_follow \| mentioned_only \| parent_post_author_only \| followers_only | optional | — | enum: everyone, accounts_you_follow, mentioned_only, parent_post_author_only, followers_only | Who can reply; omit for everyone. |
| topic_tag | string | optional | — | min length 1; max length 50 | Topic tag for the post (no periods or ampersands). |
| is_spoiler_media | boolean | optional | — | — | Blur the media as a spoiler. |

Minimal valid `input` (required fields only):

```json
{}
```

### X (x)

video: true; photos: true; max photos: 4; thumbnail: false; delete: true; edit: false (none).

- Delete note: Deletes the post on X. X API calls are billed on your plan.
- Edit note: The X API can't edit published posts. Delete and repost instead.
- Media rules: maxVideoBytes=536870912, maxVideoSeconds=140, maxImageBytes=5242880, billed=true

Fields for `targets[].input` when the account is X:

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| text | string | optional | — | max length 280 | Post text (max 280 X-weighted characters; URLs count 23). |
| replySettings | following \| mentionedUsers \| subscribers \| verified | optional | — | enum: following, mentionedUsers, subscribers, verified | Who can reply; omit to let everyone reply. |
| madeWithAi | boolean | optional | — | — | Label the media as made with AI. |
| paidPartnership | boolean | optional | — | — | Label the post as a paid partnership. |

Minimal valid `input` (required fields only):

```json
{}
```

### YouTube (youtube)

video: true; photos: false; max photos: 0; thumbnail: true; delete: true; edit: true (title, description, tags, categoryId, privacyStatus, madeForKids, playlistId, thumbnail).

- Delete note: Deletes the video from YouTube. Uses 50 of your 10,000 daily YouTube API quota units.
- Edit note: Edits use 50 quota units; the video file can't be replaced.
- Media rules: maxVideoBytes=274877906944, maxVideoSeconds=43200, shortMaxSeconds=180

Fields for `targets[].input` when the account is YouTube:

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| title | string | required | — | min length 1; max length 100 | Video title shown on YouTube (1–100 characters, no < or >). |
| description | string | optional | — | max length 5000 | Video description (max 5,000 UTF-8 bytes, no < or >). |
| privacyStatus | public \| unlisted \| private | required | — | enum: public, unlisted, private | Who can watch: public, unlisted or private. |
| madeForKids | boolean | required | — | — | Required: whether the video is made for kids (COPPA). There is no default. |
| categoryId | string | optional | — | pattern ^\d+$ | YouTube category ID, from GET /platforms/youtube/{socialConnectionId}/categories. |
| tags | string[] | optional | — | max length 500; max items 50 | Keywords (each 1–100 chars, at most 50 tags, 500 characters in total). |
| playlistId | string | optional | — | min length 1 | Playlist ID to add the video to, from GET /platforms/youtube/{socialConnectionId}/playlists. |
| notifySubscribers | boolean | optional | — | — | Notify channel subscribers about the upload (default true). |

Minimal valid `input` (required fields only):

```json
{
  "title": "x",
  "privacyStatus": "public",
  "madeForKids": false
}
```

## Endpoint reference

### Ai · Generate

**POST /ai/generations** — Queue AI-written compose fields from a social JSON or subtitles

- Required scope: `ai:generate`
- Rate limit: ai (20/3600s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| jsonMediaId | string (uuid) | optional | — | format uuid | Social-package JSON media to write from. jsonMediaId or subtitleMediaId is required. |
| subtitleMediaId | string (uuid) | optional | — | format uuid | Subtitle media (.srt/.vtt) to write from. jsonMediaId or subtitleMediaId is required. |
| videoMediaId | string (uuid) | optional | — | format uuid | Video the content is for (adds its duration/orientation as context). |
| targets[].socialConnectionId | string (uuid) | required | — | format uuid | Account to write content for. |
| targets[].fields | string[] | optional | — | min items 1; max items 10 | Compose fields to fill (see each platform's ai fields); omit for all of them. |
| instruction | string | optional | — | max length 300 | Extra guidance for the writer, e.g. tone. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/ai/generations" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "targets": [
    {
      "socialConnectionId": "00000000-0000-4000-8000-000000000000"
    }
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| generationId | string (uuid) | — | format uuid | Poll GET /ai/generations/{generationId} for the result. |

#### Example response

```json
{
  "generationId": "00000000-0000-4000-8000-000000000000"
}
```

### Ai · Get Generation

**GET /ai/generations/{generationId}** — Get an AI generation's status and output

- Required scope: `ai:generate`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| generationId | string (uuid) | required | — | format uuid | Generation ID from POST /ai/generations. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/ai/generations/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Generation ID. |
| status | queued \| running \| succeeded \| failed | — | enum: queued, running, succeeded, failed | Poll until succeeded or failed. |
| output | object \| null | — | — | socialConnectionId → field → generated value; review before publishing. |
| issues[].socialConnectionId | string (uuid) | — | format uuid | Account the issue is about. |
| issues[].field | string | — | — | Compose field name. |
| issues[].message | string | — | — | What went wrong for that field. |
| error | object \| null | — | — | Set when status is failed. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "status": "queued",
  "output": {
    "example": {
      "example": "x"
    }
  },
  "issues": [
    {
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "field": "x",
      "message": "x"
    }
  ],
  "error": {
    "code": "x",
    "message": "x"
  }
}
```

### Folders · Add Items

**POST /folders/{folderId}/items** — Add media to a folder

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| items[].mediaId | string (uuid) | required | — | format uuid | Media ID to put in the folder; its type must fit the role. |
| items[].role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | required | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | What the media is for in this folder. |
| items[].label | string \| null | optional | — | min length 1; max length 100 | Free-text label (1–100 chars); required when role is other. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000/items" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "folderId": "00000000-0000-4000-8000-000000000000",
  "items": [
    {
      "mediaId": "00000000-0000-4000-8000-000000000000",
      "role": "main_landscape"
    }
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Create

**POST /folders** — Create a folder

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| name | string | required | — | min length 1; max length 120 | Folder name (1–120 chars). |
| description | string \| null | optional | — | max length 2000 | Optional notes (max 2000 chars). |
| items[].mediaId | string (uuid) | optional | — | format uuid | Media ID to put in the folder; its type must fit the role. |
| items[].role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | optional | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | What the media is for in this folder. |
| items[].label | string \| null | optional | — | min length 1; max length 100 | Free-text label (1–100 chars); required when role is other. |
| items[].isPrimary | boolean | optional | — | — | Mark as the primary item of its role (e.g. the main thumbnail). |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/folders" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "name": "x"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Delete

**DELETE /folders/{folderId}** — Delete a folder (media stays in the library)

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |

#### Example request

```bash
curl -X DELETE "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| deleted | true | — | — | Always true; media in the folder stays in the library (idempotent). |

#### Example response

```json
{
  "deleted": true
}
```

### Folders · From Suggestion

**POST /folders/from-suggestion** — Create a folder from a social JSON's suggestion

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| jsonMediaId | string (uuid) | required | — | format uuid | ID of a social-package JSON media that has a folderSuggestion. |
| name | string | optional | — | min length 1; max length 120 | Folder name; defaults to the suggested name. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/folders/from-suggestion" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "jsonMediaId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Get

**GET /folders/{folderId}** — Get a folder's details

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Items

**GET /folders/{folderId}/items** — List a folder's items

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | optional | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | Only items with this role. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000/items" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].mediaId | string (uuid) | — | format uuid | Media ID. |
| items[].role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | Role of the media in this folder. |
| items[].label | string \| null | — | — | Label (set when role is other). |
| items[].position | integer | — | min -9007199254740991; max 9007199254740991 | 0-based position within the role. |
| items[].isPrimary | boolean | — | — | Whether this is the primary item of its role. |
| items[].media.id | string (uuid) | — | format uuid | Media ID. |
| items[].media.name | string | — | — | Display name. |
| items[].media.type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| items[].media.status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state. |
| items[].media.orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| items[].media.durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| items[].media.width | number \| null | — | — | Pixel width. |
| items[].media.height | number \| null | — | — | Pixel height. |
| items[].media.previewUrl | string \| null | — | — | Short-lived presigned URL for previewing the media. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "mediaId": "00000000-0000-4000-8000-000000000000",
      "role": "main_landscape",
      "label": "x",
      "position": -9007199254740991,
      "isPrimary": false,
      "media": {
        "id": "00000000-0000-4000-8000-000000000000",
        "name": "x",
        "type": "video",
        "status": "uploading",
        "orientation": "portrait",
        "durationSeconds": 1,
        "width": 1,
        "height": 1,
        "previewUrl": "x"
      }
    }
  ],
  "nextCursor": "x"
}
```

### Folders · List

**GET /folders** — List folders

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| q | string | optional | — | min length 1; max length 100 | Case-insensitive search on the folder name. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/folders" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].id | string (uuid) | — | format uuid | Folder ID. |
| items[].name | string | — | — | Folder name. |
| items[].description | string \| null | — | — | Folder notes. |
| items[].itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| items[].coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| items[].createdAt | string (date-time) | — | format date-time | When the folder was created. |
| items[].updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "description": "x",
      "itemCount": 0,
      "coverUrl": "x",
      "createdAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "nextCursor": "x"
}
```

### Folders · Remove Item

**DELETE /folders/{folderId}/items/{mediaId}** — Remove media from a folder

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| mediaId | string (uuid) | required | — | format uuid | Media ID to remove from the folder (the media itself is kept). |

#### Example request

```bash
curl -X DELETE "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000/items/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Reorder

**PUT /folders/{folderId}/order** — Reorder a role's items in a folder

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | required | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | Role whose items are reordered. |
| mediaIds | string (uuid)[] | required | — | min items 1; max items 200 | Media IDs of that role in the new order. |

#### Example request

```bash
curl -X PUT "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000/order" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "folderId": "00000000-0000-4000-8000-000000000000",
  "role": "main_landscape",
  "mediaIds": [
    "00000000-0000-4000-8000-000000000000"
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Update

**PATCH /folders/{folderId}** — Update a folder

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| name | string | optional | — | min length 1; max length 120 | New name (1–120 chars). |
| description | string \| null | optional | — | max length 2000 | New notes; null clears them. |
| coverMediaId | string (uuid) \| null | optional | — | format uuid | Image media to use as the cover; null falls back to the primary thumbnail. |

#### Example request

```bash
curl -X PATCH "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "folderId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Folders · Update Item

**PATCH /folders/{folderId}/items/{mediaId}** — Change a folder item's role, label, primary flag or position

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| folderId | string (uuid) | required | — | format uuid | Folder ID. |
| mediaId | string (uuid) | required | — | format uuid | Media ID of the item to change. |
| role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | optional | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | New role. |
| label | string \| null | optional | — | min length 1; max length 100 | New label (required when the role is other). |
| isPrimary | boolean | optional | — | — | Make this the primary item of its role. |
| position | integer | optional | — | min 0; max 9007199254740991 | 0-based position within the item's role. |

#### Example request

```bash
curl -X PATCH "${API_PUBLIC_URL}/api/folders/00000000-0000-4000-8000-000000000000/items/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "folderId": "00000000-0000-4000-8000-000000000000",
  "mediaId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Folder ID. |
| name | string | — | — | Folder name. |
| description | string \| null | — | — | Folder notes. |
| itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| createdAt | string (date-time) | — | format date-time | When the folder was created. |
| updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| coverMediaId | string (uuid) \| null | — | format uuid | Media ID chosen as the cover, if any. |
| roleCounts | object | — | — | Number of items per role, keyed by role. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "description": "x",
  "itemCount": 0,
  "coverUrl": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "coverMediaId": "00000000-0000-4000-8000-000000000000",
  "roleCounts": {
    "example": 0
  }
}
```

### Health · Get Health

**GET /health** — Health check

- Required scope: none (public)
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

No fields.

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/health" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| status | "healthy" | — | — | status of the server |

#### Example response

```json
{
  "status": "healthy"
}
```

### Media · Complete Upload

**POST /media/{mediaId}/complete** — Finish a multipart upload with the part ETags

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| mediaId | string (uuid) | required | — | format uuid | Media ID returned by POST /media/uploads. |
| parts[].partNumber | integer | required | — | min 1; max 10000 | 1-based part number. |
| parts[].etag | string | required | — | min length 1; max length 200 | ETag header returned by the part PUT. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/media/00000000-0000-4000-8000-000000000000/complete" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "mediaId": "00000000-0000-4000-8000-000000000000",
  "parts": [
    {
      "partNumber": 1,
      "etag": "x"
    }
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Media ID. |
| name | string | — | — | Display name. |
| type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| originalFilename | string \| null | — | — | Filename at upload time. |
| mimeType | string | — | — | Stored content type. |
| sizeBytes | number \| null | — | — | File size in bytes. |
| width | number \| null | — | — | Pixel width (images and videos). |
| height | number \| null | — | — | Pixel height (images and videos). |
| durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| codec | object \| null | — | — | Detected codecs (videos). |
| fps | number \| null | — | — | Frames per second (videos). |
| jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| error | string \| null | — | — | Why processing failed, when status is failed. |
| url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| createdAt | string (date-time) | — | format date-time | When the media was created. |
| updatedAt | string (date-time) | — | format date-time | When the media last changed. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "type": "video",
  "status": "uploading",
  "originalFilename": "x",
  "mimeType": "x",
  "sizeBytes": 1,
  "width": 1,
  "height": 1,
  "durationSeconds": 1,
  "orientation": "portrait",
  "codec": {},
  "fps": 1,
  "jsonSchema": "social_package",
  "subtitle": {
    "segments": 0,
    "durationMs": 0
  },
  "folderSuggestion": {
    "folderName": "x",
    "items": [
      {
        "mediaId": "00000000-0000-4000-8000-000000000000",
        "role": "main_landscape"
      }
    ]
  },
  "error": "x",
  "url": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z"
}
```

### Media · Create Upload

**POST /media/uploads** — Start a multipart upload and get presigned part URLs

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| filename | string | required | — | min length 1; max length 255 | Original filename including extension (.mp4, .jpg, .srt, .vtt, .json …). |
| mimeType | string | required | — | max length 255 | MIME type of the file (video/*, image/*, application/json); may be empty for .srt/.vtt. |
| sizeBytes | integer | required | — | max 5368709120 | Exact file size in bytes. Videos/images up to 5 GiB; subtitles and JSON up to 1 MiB. |
| name | string | optional | — | min length 1; max length 200 | Display name (1–200 chars); defaults to the filename without its extension. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/media/uploads" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "filename": "x",
  "mimeType": "x",
  "sizeBytes": 1
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| mediaId | string (uuid) | — | format uuid | ID of the new media item (status uploading). |
| partSize | integer | — | max 9007199254740991 | Bytes per part; part N covers bytes [(N-1)*partSize, N*partSize). |
| parts[].partNumber | integer | — | max 9007199254740991 | 1-based part number. |
| parts[].url | string (uri) | — | format uri | Presigned URL; PUT this part's bytes here and keep the ETag response header. |

#### Example response

```json
{
  "mediaId": "00000000-0000-4000-8000-000000000000",
  "partSize": 1,
  "parts": [
    {
      "partNumber": 1,
      "url": "https://example.com/resource"
    }
  ]
}
```

### Media · Delete

**DELETE /media/{mediaId}** — Delete a media item (idempotent)

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `MEDIA_IN_USE`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| mediaId | string (uuid) | required | — | format uuid | Media ID. |

#### Example request

```bash
curl -X DELETE "${API_PUBLIC_URL}/api/media/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| deleted | true | — | — | Always true. |
| alreadyGone | boolean | — | — | True when the media was already deleted (deletes are idempotent). |

#### Example response

```json
{
  "deleted": true,
  "alreadyGone": false
}
```

### Media · Fail Upload

**POST /media/{mediaId}/fail** — Mark an upload as failed

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| mediaId | string (uuid) | required | — | format uuid | Media ID of the upload that failed. |
| error | string | required | — | min length 1; max length 500 | Short reason the upload failed. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/media/00000000-0000-4000-8000-000000000000/fail" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "mediaId": "00000000-0000-4000-8000-000000000000",
  "error": "x"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Media ID. |
| name | string | — | — | Display name. |
| type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| originalFilename | string \| null | — | — | Filename at upload time. |
| mimeType | string | — | — | Stored content type. |
| sizeBytes | number \| null | — | — | File size in bytes. |
| width | number \| null | — | — | Pixel width (images and videos). |
| height | number \| null | — | — | Pixel height (images and videos). |
| durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| codec | object \| null | — | — | Detected codecs (videos). |
| fps | number \| null | — | — | Frames per second (videos). |
| jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| error | string \| null | — | — | Why processing failed, when status is failed. |
| url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| createdAt | string (date-time) | — | format date-time | When the media was created. |
| updatedAt | string (date-time) | — | format date-time | When the media last changed. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "type": "video",
  "status": "uploading",
  "originalFilename": "x",
  "mimeType": "x",
  "sizeBytes": 1,
  "width": 1,
  "height": 1,
  "durationSeconds": 1,
  "orientation": "portrait",
  "codec": {},
  "fps": 1,
  "jsonSchema": "social_package",
  "subtitle": {
    "segments": 0,
    "durationMs": 0
  },
  "folderSuggestion": {
    "folderName": "x",
    "items": [
      {
        "mediaId": "00000000-0000-4000-8000-000000000000",
        "role": "main_landscape"
      }
    ]
  },
  "error": "x",
  "url": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z"
}
```

### Media · Get

**GET /media/{mediaId}** — Get one media item with its folders and usage

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| mediaId | string (uuid) | required | — | format uuid | Media ID. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/media/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Media ID. |
| name | string | — | — | Display name. |
| type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| originalFilename | string \| null | — | — | Filename at upload time. |
| mimeType | string | — | — | Stored content type. |
| sizeBytes | number \| null | — | — | File size in bytes. |
| width | number \| null | — | — | Pixel width (images and videos). |
| height | number \| null | — | — | Pixel height (images and videos). |
| durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| codec | object \| null | — | — | Detected codecs (videos). |
| fps | number \| null | — | — | Frames per second (videos). |
| jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| error | string \| null | — | — | Why processing failed, when status is failed. |
| url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| createdAt | string (date-time) | — | format date-time | When the media was created. |
| updatedAt | string (date-time) | — | format date-time | When the media last changed. |
| folders[].folderId | string (uuid) | — | format uuid | Folder ID. |
| folders[].name | string | — | — | Folder name. |
| folders[].role | main_landscape \| main_portrait \| trailer_landscape \| trailer_portrait \| thumbnail \| subtitles \| social_json \| other | — | enum: main_landscape, main_portrait, trailer_landscape, trailer_portrait, thumbnail, subtitles, social_json, other | Role of this media in that folder. |
| inUseByPosts | integer | — | min 0; max 9007199254740991 | Number of posts that use this media; published posts are unaffected by a delete. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "type": "video",
  "status": "uploading",
  "originalFilename": "x",
  "mimeType": "x",
  "sizeBytes": 1,
  "width": 1,
  "height": 1,
  "durationSeconds": 1,
  "orientation": "portrait",
  "codec": {},
  "fps": 1,
  "jsonSchema": "social_package",
  "subtitle": {
    "segments": 0,
    "durationMs": 0
  },
  "folderSuggestion": {
    "folderName": "x",
    "items": [
      {
        "mediaId": "00000000-0000-4000-8000-000000000000",
        "role": "main_landscape"
      }
    ]
  },
  "error": "x",
  "url": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z",
  "folders": [
    {
      "folderId": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "role": "main_landscape"
    }
  ],
  "inUseByPosts": 0
}
```

### Media · List

**GET /media** — List media in the library

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| q | string | optional | — | min length 1; max length 100 | Case-insensitive search on the media name. |
| type | video \| image \| subtitle \| json \| other | optional | — | enum: video, image, subtitle, json, other | Only media of this type. |
| orientation | portrait \| landscape \| square | optional | — | enum: portrait, landscape, square | Only media with this orientation (images and videos). |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/media" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].id | string (uuid) | — | format uuid | Media ID. |
| items[].name | string | — | — | Display name. |
| items[].type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| items[].status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| items[].originalFilename | string \| null | — | — | Filename at upload time. |
| items[].mimeType | string | — | — | Stored content type. |
| items[].sizeBytes | number \| null | — | — | File size in bytes. |
| items[].width | number \| null | — | — | Pixel width (images and videos). |
| items[].height | number \| null | — | — | Pixel height (images and videos). |
| items[].durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| items[].orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| items[].codec | object \| null | — | — | Detected codecs (videos). |
| items[].fps | number \| null | — | — | Frames per second (videos). |
| items[].jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| items[].subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| items[].folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| items[].error | string \| null | — | — | Why processing failed, when status is failed. |
| items[].url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| items[].createdAt | string (date-time) | — | format date-time | When the media was created. |
| items[].updatedAt | string (date-time) | — | format date-time | When the media last changed. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "type": "video",
      "status": "uploading",
      "originalFilename": "x",
      "mimeType": "x",
      "sizeBytes": 1,
      "width": 1,
      "height": 1,
      "durationSeconds": 1,
      "orientation": "portrait",
      "codec": {},
      "fps": 1,
      "jsonSchema": "social_package",
      "subtitle": {
        "segments": 0,
        "durationMs": 0
      },
      "folderSuggestion": {
        "folderName": "x",
        "items": [
          {
            "mediaId": "00000000-0000-4000-8000-000000000000",
            "role": "main_landscape"
          }
        ]
      },
      "error": "x",
      "url": "x",
      "createdAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "nextCursor": "x"
}
```

### Media · Rename

**PATCH /media/{mediaId}** — Rename a media item

- Required scope: `media:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| mediaId | string (uuid) | required | — | format uuid | Media ID. |
| name | string | required | — | min length 1; max length 200 | New display name (1–200 chars). |

#### Example request

```bash
curl -X PATCH "${API_PUBLIC_URL}/api/media/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "mediaId": "00000000-0000-4000-8000-000000000000",
  "name": "x"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Media ID. |
| name | string | — | — | Display name. |
| type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| originalFilename | string \| null | — | — | Filename at upload time. |
| mimeType | string | — | — | Stored content type. |
| sizeBytes | number \| null | — | — | File size in bytes. |
| width | number \| null | — | — | Pixel width (images and videos). |
| height | number \| null | — | — | Pixel height (images and videos). |
| durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| codec | object \| null | — | — | Detected codecs (videos). |
| fps | number \| null | — | — | Frames per second (videos). |
| jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| error | string \| null | — | — | Why processing failed, when status is failed. |
| url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| createdAt | string (date-time) | — | format date-time | When the media was created. |
| updatedAt | string (date-time) | — | format date-time | When the media last changed. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "type": "video",
  "status": "uploading",
  "originalFilename": "x",
  "mimeType": "x",
  "sizeBytes": 1,
  "width": 1,
  "height": 1,
  "durationSeconds": 1,
  "orientation": "portrait",
  "codec": {},
  "fps": 1,
  "jsonSchema": "social_package",
  "subtitle": {
    "segments": 0,
    "durationMs": 0
  },
  "folderSuggestion": {
    "folderName": "x",
    "items": [
      {
        "mediaId": "00000000-0000-4000-8000-000000000000",
        "role": "main_landscape"
      }
    ]
  },
  "error": "x",
  "url": "x",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "updatedAt": "2020-01-01T00:00:00.000Z"
}
```

### Notifications · List

**GET /notifications** — List notifications

- Required scope: `posts:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| unreadOnly | boolean | optional | — | — | Only unread notifications. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/notifications" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].id | string (uuid) | — | format uuid | Notification ID. |
| items[].type | upload_succeeded \| upload_failed \| post_published \| post_failed \| post_scheduled \| schedule_failed \| schedule_missed \| post_deleted \| post_delete_failed \| post_edited \| post_edit_failed | — | enum: upload_succeeded, upload_failed, post_published, post_failed, post_scheduled, schedule_failed, schedule_missed, post_deleted, post_delete_failed, post_edited, post_edit_failed | What happened. |
| items[].title | string | — | — | Short headline. |
| items[].body | string | — | — | Longer message. |
| items[].link | string \| null | — | — | In-app path the notification points to (web UI). |
| items[].mediaId | string (uuid) \| null | — | format uuid | Related media ID, if any. |
| items[].postId | string (uuid) \| null | — | format uuid | Related post ID, if any. |
| items[].data | object | — | — | Extra event details (shape depends on type). |
| items[].readAt | string (date-time) \| null | — | format date-time | When it was marked read; null when unread. |
| items[].createdAt | string (date-time) | — | format date-time | When it was created. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "type": "upload_succeeded",
      "title": "x",
      "body": "x",
      "link": "x",
      "mediaId": "00000000-0000-4000-8000-000000000000",
      "postId": "00000000-0000-4000-8000-000000000000",
      "data": {
        "example": "x"
      },
      "readAt": "2020-01-01T00:00:00.000Z",
      "createdAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "nextCursor": "x"
}
```

### Notifications · Mark All Read

**POST /notifications/read-all** — Mark every notification as read

- Required scope: `posts:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

No fields.

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/notifications/read-all" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| updated | integer | — | min 0; max 9007199254740991 | Notifications newly marked read. |

#### Example response

```json
{
  "updated": 0
}
```

### Notifications · Mark Read

**POST /notifications/read** — Mark notifications as read

- Required scope: `posts:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| ids | string (uuid)[] | required | — | min items 1; max items 100 | Notification IDs to mark read. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/notifications/read" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "ids": [
    "00000000-0000-4000-8000-000000000000"
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| updated | integer | — | min 0; max 9007199254740991 | Notifications newly marked read. |

#### Example response

```json
{
  "updated": 0
}
```

### Notifications · Unread Count

**GET /notifications/unread-count** — Count unread notifications

- Required scope: `posts:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

No fields.

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/notifications/unread-count" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| count | integer | — | min 0; max 9007199254740991 | Unread notifications. |

#### Example response

```json
{
  "count": 0
}
```

### Platforms · Capabilities

**GET /platforms/capabilities** — Compose fields, limits and delete/edit support for every platform

- Required scope: none (public)
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

No fields.

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/platforms/capabilities" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| [].platform | youtube \| x \| linkedin \| threads \| facebook | — | enum: youtube, x, linkedin, threads, facebook | Platform key. |
| [].label | string | — | — | Platform name. |
| [].supportsVideo | boolean | — | — | Can publish a video. |
| [].supportsPhotos | boolean | — | — | Can publish photos. |
| [].maxPhotos | integer | — | min -9007199254740991; max 9007199254740991 | Most photos per post. |
| [].minCarousel | integer | — | min -9007199254740991; max 9007199254740991 | Fewest photos for a multi-photo post. |
| [].supportsThumbnail | boolean | — | — | Accepts a custom video thumbnail (thumbnailByConnection). |
| [].supportsDelete | boolean | — | — | Fannout can delete published posts here. |
| [].deleteNote | string | — | — | Platform note about deletes. |
| [].supportsEdit | boolean | — | — | Published posts can be edited. |
| [].editableFields | string[] | — | — | Compose fields PATCH /posts/{postId} accepts. |
| [].editNote | string | — | — | Platform note about edits. |
| [].fields[].name | string | — | — | Key to use in targets[].input. |
| [].fields[].label | string | — | — | Human-readable field name. |
| [].fields[].description | string | — | — | What the field does and its limits. |
| [].fields[].kind | text \| textarea \| select \| toggle \| tags \| playlist \| radio | — | enum: text, textarea, select, toggle, tags, playlist, radio | Input kind: text/textarea = string, toggle/radio = boolean or option value, select = option value, tags = string[], playlist = playlist ID. |
| [].fields[].required | boolean | — | — | Whether the field must be sent. |
| [].fields[].maxLength | integer | — | min -9007199254740991; max 9007199254740991 | Length limit, counted per countMode. |
| [].fields[].countMode | chars \| bytes \| weighted | — | enum: chars, bytes, weighted | How maxLength is counted: chars, UTF-8 bytes, or X-weighted (URLs count 23). |
| [].fields[].options[].value | string \| boolean | — | — | Value to send. |
| [].fields[].options[].label | string | — | — | Human-readable option. |
| [].fields[].optionsSource | "youtube.categories" | — | — | Options come from GET /platforms/youtube/{socialConnectionId}/categories. |
| [].fields[].defaultValue | string \| boolean | — | — | Value the web composer pre-fills (still send it when required). |
| [].fields[].mediaType | video \| photos | — | enum: video, photos | Field only applies to this media type. |
| [].fields[].helper | string | — | — | Extra hint shown in the web composer. |
| [].fields[].ai | boolean | — | — | POST /ai/generations can write this field. |
| [].mediaRules.maxVideoBytes | number | — | — | Largest video in bytes. |
| [].mediaRules.minVideoSeconds | number | — | — | Shortest video in seconds. |
| [].mediaRules.maxVideoSeconds | number | — | — | Longest video in seconds. |
| [].mediaRules.maxImageBytes | number | — | — | Largest image in bytes. |
| [].mediaRules.shortMaxSeconds | number | — | — | Vertical videos up to this length publish as Shorts. |
| [].mediaRules.requiresPublicUrl | boolean | — | — | The platform fetches media from a public URL. |
| [].mediaRules.billed | boolean | — | — | The platform bills API usage for posting. |

#### Example response

```json
[
  {
    "platform": "youtube",
    "label": "x",
    "supportsVideo": false,
    "supportsPhotos": false,
    "maxPhotos": -9007199254740991,
    "minCarousel": -9007199254740991,
    "supportsThumbnail": false,
    "supportsDelete": false,
    "deleteNote": "x",
    "supportsEdit": false,
    "editableFields": [
      "x"
    ],
    "editNote": "x",
    "fields": [
      {
        "name": "x",
        "label": "x",
        "description": "x",
        "kind": "text",
        "required": false
      }
    ],
    "mediaRules": {}
  }
]
```

### Platforms · Youtube Categories

**GET /platforms/youtube/{socialConnectionId}/categories** — List YouTube video categories for a channel

- Required scope: `connections:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| socialConnectionId | string (uuid) | required | — | format uuid | A connected YouTube account. |
| regionCode | string | optional | — | pattern ^[A-Z]{2}$ | ISO 3166-1 alpha-2 region, e.g. US. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/platforms/youtube/00000000-0000-4000-8000-000000000000/categories" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| [].id | string | — | — | Option ID to put in the compose field. |
| [].title | string | — | — | Human-readable name. |

#### Example response

```json
[
  {
    "id": "x",
    "title": "x"
  }
]
```

### Platforms · Youtube Playlists

**GET /platforms/youtube/{socialConnectionId}/playlists** — List a YouTube channel's playlists

- Required scope: `connections:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| socialConnectionId | string (uuid) | required | — | format uuid | A connected YouTube account. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/platforms/youtube/00000000-0000-4000-8000-000000000000/playlists" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| [].id | string | — | — | Option ID to put in the compose field. |
| [].title | string | — | — | Human-readable name. |

#### Example response

```json
[
  {
    "id": "x",
    "title": "x"
  }
]
```

### Posts · Batch

**GET /posts/batches/{batchId}** — Get a batch and the status of each post

- Required scope: `posts:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| batchId | string (uuid) | required | — | format uuid | Batch ID. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/posts/batches/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| batchId | string (uuid) | — | format uuid | Batch ID. |
| name | string | — | — | Batch display name. |
| mediaType | video \| photos | — | enum: video, photos | video or photos. |
| createdAt | string (date-time) | — | format date-time | When the batch was submitted. |
| finished | boolean | — | — | True when every post has a terminal status. |
| counts.total | number | — | — | Posts in the batch. |
| counts.published | number | — | — | Posts published. |
| counts.failed | number | — | — | Posts failed. |
| counts.pending | number | — | — | Posts not finished yet. |
| caption | string \| null | — | — | Caption of the first post, for display. |
| posts[].id | string (uuid) | — | format uuid | Post ID. |
| posts[].platform | youtube \| x \| linkedin \| threads \| facebook | — | enum: youtube, x, linkedin, threads, facebook | Platform of the post. |
| posts[].socialConnectionId | string (uuid) | — | format uuid | Account the post goes to. |
| posts[].account.username | string \| null | — | — | Account handle. |
| posts[].account.displayName | string \| null | — | — | Account display name. |
| posts[].account.profilePictureUrl | string \| null | — | — | Account avatar URL. |
| posts[].status | draft \| scheduled \| queued \| publishing \| published \| failed \| cancelled \| deleting \| deleted | — | enum: draft, scheduled, queued, publishing, published, failed, cancelled, deleting, deleted | Post state; published, failed, cancelled and deleted are terminal. |
| posts[].step | string \| null | — | — | Current publish step while publishing (e.g. uploading). |
| posts[].postUrl | string \| null | — | — | Public URL of the published post. |
| posts[].errorCode | string \| null | — | — | Error code when the publish failed. |
| posts[].errorMessage | string \| null | — | — | Error message when the publish failed. |
| posts[].publishedAt | string (date-time) \| null | — | format date-time | When the platform accepted the post. |
| posts[].updatedAt | string (date-time) | — | format date-time | When the post last changed. |
| posts[].externalStatus | string | — | — | State on the platform: live, hidden, deleted_externally, removed_by_platform or unknown. |
| posts[].editStatus | string \| null | — | — | editing while an edit is running, failed when the last edit failed, else null. |
| posts[].editErrorMessage | string \| null | — | — | Why the last edit failed. |
| posts[].lastEditedAt | string (date-time) \| null | — | format date-time | When the last edit succeeded. |
| posts[].deleteErrorCode | string \| null | — | — | Error code when the last delete failed. |
| posts[].deleteErrorMessage | string \| null | — | — | Why the last delete failed. |
| posts[].deletedAt | string (date-time) \| null | — | format date-time | When the post was deleted. |
| posts[].schedule | object \| null | — | — | Schedule for scheduled posts; null when the post was published immediately. |

#### Example response

```json
{
  "batchId": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "mediaType": "video",
  "createdAt": "2020-01-01T00:00:00.000Z",
  "finished": false,
  "counts": {
    "total": 1,
    "published": 1,
    "failed": 1,
    "pending": 1
  },
  "caption": "x",
  "posts": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "platform": "youtube",
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "account": {
        "username": "x",
        "displayName": "x",
        "profilePictureUrl": "x"
      },
      "status": "draft",
      "step": "x",
      "postUrl": "x",
      "errorCode": "x",
      "errorMessage": "x",
      "publishedAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z",
      "externalStatus": "x",
      "editStatus": "x",
      "editErrorMessage": "x",
      "lastEditedAt": "2020-01-01T00:00:00.000Z",
      "deleteErrorCode": "x",
      "deleteErrorMessage": "x",
      "deletedAt": "2020-01-01T00:00:00.000Z",
      "schedule": {
        "scheduledAt": "2020-01-01T00:00:00.000Z",
        "timezone": "x",
        "status": "scheduled",
        "scheduleVersion": 1,
        "lastError": "x"
      }
    }
  ]
}
```

### Posts · Batches

**GET /posts/batches** — List publish batches

- Required scope: `posts:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| filter | all \| scheduled | required | "all" | enum: all, scheduled; default: "all" | scheduled = only batches with a post still waiting for its scheduled time |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/posts/batches" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].batchId | string (uuid) | — | format uuid | Batch ID. |
| items[].name | string | — | — | Batch display name. |
| items[].mediaType | video \| photos | — | enum: video, photos | video or photos. |
| items[].createdAt | string (date-time) | — | format date-time | When the batch was submitted. |
| items[].finished | boolean | — | — | True when every post has a terminal status. |
| items[].counts.total | number | — | — | Posts in the batch. |
| items[].counts.published | number | — | — | Posts published. |
| items[].counts.failed | number | — | — | Posts failed. |
| items[].counts.pending | number | — | — | Posts not finished yet. |
| items[].caption | string \| null | — | — | Caption of the first post, for display. |
| items[].posts[].id | string (uuid) | — | format uuid | Post ID. |
| items[].posts[].platform | youtube \| x \| linkedin \| threads \| facebook | — | enum: youtube, x, linkedin, threads, facebook | Platform of the post. |
| items[].posts[].socialConnectionId | string (uuid) | — | format uuid | Account the post goes to. |
| items[].posts[].account.username | string \| null | — | — | Account handle. |
| items[].posts[].account.displayName | string \| null | — | — | Account display name. |
| items[].posts[].account.profilePictureUrl | string \| null | — | — | Account avatar URL. |
| items[].posts[].status | draft \| scheduled \| queued \| publishing \| published \| failed \| cancelled \| deleting \| deleted | — | enum: draft, scheduled, queued, publishing, published, failed, cancelled, deleting, deleted | Post state; published, failed, cancelled and deleted are terminal. |
| items[].posts[].step | string \| null | — | — | Current publish step while publishing (e.g. uploading). |
| items[].posts[].postUrl | string \| null | — | — | Public URL of the published post. |
| items[].posts[].errorCode | string \| null | — | — | Error code when the publish failed. |
| items[].posts[].errorMessage | string \| null | — | — | Error message when the publish failed. |
| items[].posts[].publishedAt | string (date-time) \| null | — | format date-time | When the platform accepted the post. |
| items[].posts[].updatedAt | string (date-time) | — | format date-time | When the post last changed. |
| items[].posts[].externalStatus | string | — | — | State on the platform: live, hidden, deleted_externally, removed_by_platform or unknown. |
| items[].posts[].editStatus | string \| null | — | — | editing while an edit is running, failed when the last edit failed, else null. |
| items[].posts[].editErrorMessage | string \| null | — | — | Why the last edit failed. |
| items[].posts[].lastEditedAt | string (date-time) \| null | — | format date-time | When the last edit succeeded. |
| items[].posts[].deleteErrorCode | string \| null | — | — | Error code when the last delete failed. |
| items[].posts[].deleteErrorMessage | string \| null | — | — | Why the last delete failed. |
| items[].posts[].deletedAt | string (date-time) \| null | — | format date-time | When the post was deleted. |
| items[].posts[].schedule | object \| null | — | — | Schedule for scheduled posts; null when the post was published immediately. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "batchId": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "mediaType": "video",
      "createdAt": "2020-01-01T00:00:00.000Z",
      "finished": false,
      "counts": {
        "total": 1,
        "published": 1,
        "failed": 1,
        "pending": 1
      },
      "caption": "x",
      "posts": [
        {
          "id": "00000000-0000-4000-8000-000000000000",
          "platform": "youtube",
          "socialConnectionId": "00000000-0000-4000-8000-000000000000",
          "account": {
            "username": "x",
            "displayName": "x",
            "profilePictureUrl": "x"
          },
          "status": "draft",
          "step": "x",
          "postUrl": "x",
          "errorCode": "x",
          "errorMessage": "x",
          "publishedAt": "2020-01-01T00:00:00.000Z",
          "updatedAt": "2020-01-01T00:00:00.000Z",
          "externalStatus": "x",
          "editStatus": "x",
          "editErrorMessage": "x",
          "lastEditedAt": "2020-01-01T00:00:00.000Z",
          "deleteErrorCode": "x",
          "deleteErrorMessage": "x",
          "deletedAt": "2020-01-01T00:00:00.000Z",
          "schedule": {
            "scheduledAt": "2020-01-01T00:00:00.000Z",
            "timezone": "x",
            "status": "scheduled",
            "scheduleVersion": 1,
            "lastError": "x"
          }
        }
      ]
    }
  ],
  "nextCursor": "x"
}
```

### Posts · Cancel Schedule

**POST /posts/{postId}/cancel-schedule** — Cancel a scheduled post before it publishes

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | The scheduled post |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000/cancel-schedule" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | The post |
| cancelled | true | — | — | Always true: the schedule is cancelled (or already was) |
| alreadyCancelled | boolean | — | — | True when nothing changed (idempotent repeat, or not scheduled) |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "cancelled": true,
  "alreadyCancelled": false
}
```

### Posts · Delete

**DELETE /posts/{postId}** — Cancel or delete a post (idempotent)

- Required scope: `posts:delete`
- Rate limit: delete (30/3600s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | Post ID. |

#### Example request

```bash
curl -X DELETE "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | Post ID. |
| mode | queued \| cancelled \| manual \| noop | — | enum: queued, cancelled, manual, noop | queued = platform delete running; cancelled = never reached the platform; manual = the human must delete it in the platform's app; noop = already done. |
| status | string | — | — | Post status after the request. |
| deleteNote | string | — | — | Platform note, set for manual deletes. |
| postUrl | string \| null | — | — | Post URL, so a human can delete it manually. |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "mode": "queued",
  "status": "x"
}
```

### Posts · Delete Batch

**POST /posts/batches/{batchId}/delete** — Cancel or delete the posts of a batch

- Required scope: `posts:delete`
- Rate limit: delete (30/3600s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| batchId | string (uuid) | required | — | format uuid | Batch ID. |
| socialConnectionIds | string (uuid)[] | optional | — | min items 1; max items 50 | Only delete posts for these accounts; default all. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/batches/00000000-0000-4000-8000-000000000000/delete" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "batchId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| results | object[] | — | — | One result per post, in the same shape as DELETE /posts/{postId}, or an error. |

#### Example response

```json
{
  "results": [
    {
      "postId": "00000000-0000-4000-8000-000000000000",
      "mode": "queued",
      "status": "x"
    }
  ]
}
```

### Posts · Get

**GET /posts/{postId}** — Get one post with its edit history and capabilities

- Required scope: `posts:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | Post ID. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| id | string (uuid) | — | format uuid | Post ID. |
| name | string | — | — | Post display name. |
| batchId | string (uuid) \| null | — | format uuid | Batch the post belongs to. |
| socialConnectionId | string (uuid) | — | format uuid | Account the post goes to. |
| platform | string | — | — | Platform of the post. |
| status | string | — | — | Post state; published, failed, cancelled and deleted are terminal. |
| externalStatus | string | — | — | State on the platform: live, hidden, deleted_externally, removed_by_platform or unknown. |
| editStatus | string \| null | — | — | editing while an edit is running, failed when the last edit failed, else null. |
| postUrl | string \| null | — | — | Public URL of the published post. |
| caption | string \| null | — | — | Caption/text of the post. |
| input | object | — | — | The compose fields the post was published with. |
| errorMessage | string \| null | — | — | Why the publish failed. |
| deleteErrorCode | string \| null | — | — | Error code when the last delete failed. |
| deleteErrorMessage | string \| null | — | — | Why the last delete failed. |
| editErrorCode | string \| null | — | — | Error code when the last edit failed. |
| editErrorMessage | string \| null | — | — | Why the last edit failed. |
| publishedAt | string (date-time) \| null | — | format date-time | When the platform accepted the post. |
| lastEditedAt | string (date-time) \| null | — | format date-time | When the last edit succeeded. |
| deletedAt | string (date-time) \| null | — | format date-time | When the post was deleted. |
| revisions[].at | string | — | — | ISO-8601 time of the edit. |
| revisions[].before | object | — | — | Changed fields before the edit. |
| revisions[].after | object | — | — | Changed fields after the edit. |
| revisions[].by | string | — | — | Who made the edit (app or api). |
| account.username | string \| null | — | — | Account handle. |
| account.displayName | string \| null | — | — | Account display name. |
| account.profilePictureUrl | string \| null | — | — | Account avatar URL. |
| capabilities.supportsDelete | boolean | — | — | Whether Fannout can delete this post on the platform. |
| capabilities.deleteNote | string | — | — | Platform note about deletes. |
| capabilities.supportsEdit | boolean | — | — | Whether this post can be edited after publishing. |
| capabilities.editableFields | string[] | — | — | Compose fields PATCH /posts/{postId} accepts. |
| capabilities.editNote | string | — | — | Platform note about edits. |

#### Example response

```json
{
  "id": "00000000-0000-4000-8000-000000000000",
  "name": "x",
  "batchId": "00000000-0000-4000-8000-000000000000",
  "socialConnectionId": "00000000-0000-4000-8000-000000000000",
  "platform": "x",
  "status": "x",
  "externalStatus": "x",
  "editStatus": "x",
  "postUrl": "x",
  "caption": "x",
  "input": {
    "example": "x"
  },
  "errorMessage": "x",
  "deleteErrorCode": "x",
  "deleteErrorMessage": "x",
  "editErrorCode": "x",
  "editErrorMessage": "x",
  "publishedAt": "2020-01-01T00:00:00.000Z",
  "lastEditedAt": "2020-01-01T00:00:00.000Z",
  "deletedAt": "2020-01-01T00:00:00.000Z",
  "revisions": [
    {
      "at": "x",
      "before": {
        "example": "x"
      },
      "after": {
        "example": "x"
      },
      "by": "x"
    }
  ],
  "account": {
    "username": "x",
    "displayName": "x",
    "profilePictureUrl": "x"
  },
  "capabilities": {
    "supportsDelete": false,
    "deleteNote": "x",
    "supportsEdit": false,
    "editableFields": [
      "x"
    ],
    "editNote": "x"
  }
}
```

### Posts · Publish Batch

**POST /posts/batches** — Publish media to one or more accounts

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| idempotencyKey | string | required | — | min length 8; max length 100 | Unique key (use a UUID) per intended publish; resending the same key returns the original batch. |
| mediaType | video \| photos | required | — | enum: video, photos | video = one video; photos = one or more images (carousel). |
| mediaIds | string (uuid)[] | required | — | min items 1; max items 20 | Ready media IDs in order: exactly one video, or the photos. |
| thumbnailByConnection | object | optional | — | — | Video mode: socialConnectionId → image media ID used as that account's thumbnail. |
| jsonMediaId | string (uuid) | optional | — | format uuid | Social-package JSON media the content came from; used to name the batch. |
| scheduleAll.at | string (date-time) | optional | — | format date-time | When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now. |
| scheduleAll.timezone | string | optional | — | min length 1; max length 64 | IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC. |
| targets[].socialConnectionId | string (uuid) | required | — | format uuid | Connected account to publish to (from GET /social-connections). |
| targets[].input | object | required | — | — | The platform's compose fields — see the Platform reference for this account's platform. |
| targets[].mediaIds | string (uuid)[] | optional | — | min items 1; max items 20 | Photos mode only: this account's subset/order of the batch photos. |
| targets[].schedule.at | string (date-time) | optional | — | format date-time | When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now. |
| targets[].schedule.timezone | string | optional | — | min length 1; max length 64 | IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/batches" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "idempotencyKey": "xxxxxxxx",
  "mediaType": "video",
  "mediaIds": [
    "00000000-0000-4000-8000-000000000000"
  ],
  "targets": [
    {
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "input": {
        "title": "x",
        "privacyStatus": "public",
        "madeForKids": false
      }
    }
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| batchId | string (uuid) | — | format uuid | Batch ID; poll GET /posts/batches/{batchId}. |
| posts[].id | string (uuid) | — | format uuid | Post ID. |
| posts[].platform | youtube \| x \| linkedin \| threads \| facebook | — | enum: youtube, x, linkedin, threads, facebook | Platform of the post. |
| posts[].socialConnectionId | string (uuid) | — | format uuid | Account the post goes to. |
| posts[].scheduledAt | string (date-time) \| null | — | format date-time | UTC publish time for scheduled posts; null = publishing now. |
| replayed | boolean | — | — | True when the idempotency key matched an earlier submit (nothing new was queued). |

#### Example response

```json
{
  "batchId": "00000000-0000-4000-8000-000000000000",
  "posts": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "platform": "youtube",
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "scheduledAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "replayed": false
}
```

### Posts · Publish Now

**POST /posts/{postId}/publish-now** — Publish a scheduled or missed post right away

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | The scheduled post |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000/publish-now" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | The post |
| scheduledAt | string (date-time) | — | format date-time | New UTC publish time |
| timezone | string | — | — | IANA timezone |
| status | scheduled \| handed_off \| completed \| cancelled \| missed \| failed | — | enum: scheduled, handed_off, completed, cancelled, missed, failed | scheduled = waiting; handed_off = upload/prepare running, final publish at scheduledAt; completed = published; cancelled; missed = the server was down > 2 h past the time (use publishNow); failed |
| scheduleVersion | integer | — | max 9007199254740991 | Current schedule version |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "scheduledAt": "2020-01-01T00:00:00.000Z",
  "timezone": "x",
  "status": "scheduled",
  "scheduleVersion": 1
}
```

### Posts · Repost

**POST /posts/{postId}/repost** — Publish a post again as a new post

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | Post to publish again as a new post. |
| changes | object | optional | — | — | Compose fields to change in the new post. |
| deleteOriginal | boolean | optional | — | — | Delete the original once the new post is published (never automatic otherwise). |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000/repost" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| batchId | string (uuid) | — | format uuid | Batch ID; poll GET /posts/batches/{batchId}. |
| posts[].id | string (uuid) | — | format uuid | Post ID. |
| posts[].platform | youtube \| x \| linkedin \| threads \| facebook | — | enum: youtube, x, linkedin, threads, facebook | Platform of the post. |
| posts[].socialConnectionId | string (uuid) | — | format uuid | Account the post goes to. |
| posts[].scheduledAt | string (date-time) \| null | — | format date-time | UTC publish time for scheduled posts; null = publishing now. |
| replayed | boolean | — | — | True when the idempotency key matched an earlier submit (nothing new was queued). |

#### Example response

```json
{
  "batchId": "00000000-0000-4000-8000-000000000000",
  "posts": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "platform": "youtube",
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "scheduledAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "replayed": false
}
```

### Posts · Reschedule

**POST /posts/{postId}/reschedule** — Move a scheduled post to a new time

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | A post whose schedule is scheduled or handed_off and that isn't published yet |
| at | string (date-time) | required | — | format date-time | When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now. |
| timezone | string | required | — | min length 1; max length 64 | IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000/reschedule" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000",
  "at": "2026-11-07T19:00:00+05:30",
  "timezone": "Asia/Kolkata"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | The post |
| scheduledAt | string (date-time) | — | format date-time | New UTC publish time |
| timezone | string | — | — | IANA timezone |
| status | scheduled \| handed_off \| completed \| cancelled \| missed \| failed | — | enum: scheduled, handed_off, completed, cancelled, missed, failed | scheduled = waiting; handed_off = upload/prepare running, final publish at scheduledAt; completed = published; cancelled; missed = the server was down > 2 h past the time (use publishNow); failed |
| scheduleVersion | integer | — | max 9007199254740991 | Current schedule version |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "scheduledAt": "2020-01-01T00:00:00.000Z",
  "timezone": "x",
  "status": "scheduled",
  "scheduleVersion": 1
}
```

### Posts · Retry

**POST /posts/{postId}/retry** — Retry a failed post

- Required scope: `posts:write`
- Rate limit: publish (10/60s, 100/86400s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | ID of a failed post to retry. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000/retry" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000"
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | Post ID. |
| queued | true | — | — | Always true: the retry was queued. |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "queued": true
}
```

### Posts · Update

**PATCH /posts/{postId}** — Edit a published post

- Required scope: `posts:write`
- Rate limit: edit (30/3600s; plus API key api 60/60s)
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| postId | string (uuid) | required | — | format uuid | Post ID. |
| changes | object | required | — | — | Compose fields to change; only the platform's editableFields are accepted (thumbnail = image media ID for YouTube). |

#### Example request

```bash
curl -X PATCH "${API_PUBLIC_URL}/api/posts/00000000-0000-4000-8000-000000000000" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "postId": "00000000-0000-4000-8000-000000000000",
  "changes": {
    "example": "x"
  }
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| postId | string (uuid) | — | format uuid | Post ID. |
| mode | queued \| noop | — | enum: queued, noop | queued = edit job started; noop = nothing changed. |
| editStatus | string \| null | — | — | editing while the edit runs. |

#### Example response

```json
{
  "postId": "00000000-0000-4000-8000-000000000000",
  "mode": "queued",
  "editStatus": "x"
}
```

### Posts · Validate

**POST /posts/validate** — Check a publish batch without publishing

- Required scope: `posts:write`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| idempotencyKey | string | required | — | min length 8; max length 100 | Unique key (use a UUID) per intended publish; resending the same key returns the original batch. |
| mediaType | video \| photos | required | — | enum: video, photos | video = one video; photos = one or more images (carousel). |
| mediaIds | string (uuid)[] | required | — | min items 1; max items 20 | Ready media IDs in order: exactly one video, or the photos. |
| thumbnailByConnection | object | optional | — | — | Video mode: socialConnectionId → image media ID used as that account's thumbnail. |
| jsonMediaId | string (uuid) | optional | — | format uuid | Social-package JSON media the content came from; used to name the batch. |
| scheduleAll.at | string (date-time) | optional | — | format date-time | When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now. |
| scheduleAll.timezone | string | optional | — | min length 1; max length 64 | IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC. |
| targets[].socialConnectionId | string (uuid) | required | — | format uuid | Connected account to publish to (from GET /social-connections). |
| targets[].input | object | required | — | — | The platform's compose fields — see the Platform reference for this account's platform. |
| targets[].mediaIds | string (uuid)[] | optional | — | min items 1; max items 20 | Photos mode only: this account's subset/order of the batch photos. |
| targets[].schedule.at | string (date-time) | optional | — | format date-time | When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now. |
| targets[].schedule.timezone | string | optional | — | min length 1; max length 64 | IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC. |

#### Example request

```bash
curl -X POST "${API_PUBLIC_URL}/api/posts/validate" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
  "idempotencyKey": "xxxxxxxx",
  "mediaType": "video",
  "mediaIds": [
    "00000000-0000-4000-8000-000000000000"
  ],
  "targets": [
    {
      "socialConnectionId": "00000000-0000-4000-8000-000000000000",
      "input": {
        "title": "x",
        "privacyStatus": "public",
        "madeForKids": false
      }
    }
  ]
}'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| valid | boolean | — | — | True when the batch can be published as is. |
| issues[].socialConnectionId | string (uuid) | — | format uuid | Account the issue is about; missing for batch-level issues. |
| issues[].field | string | — | — | Compose field name, or media / thumbnail / account. |
| issues[].message | string | — | — | Human-readable problem to fix. |

#### Example response

```json
{
  "valid": false,
  "issues": [
    {
      "field": "x",
      "message": "x"
    }
  ]
}
```

### Search · Unified

**GET /search** — Search folders and media by name

- Required scope: `media:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| q | string | required | — | min length 1; max length 100 | Search text (1–100 chars), matched against folder and media names. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Max results per section (folders, media). |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/search" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| folders[].id | string (uuid) | — | format uuid | Folder ID. |
| folders[].name | string | — | — | Folder name. |
| folders[].description | string \| null | — | — | Folder notes. |
| folders[].itemCount | integer | — | min 0; max 9007199254740991 | Number of media items in the folder. |
| folders[].coverUrl | string \| null | — | — | Presigned cover image URL (the primary thumbnail when no cover is set). |
| folders[].createdAt | string (date-time) | — | format date-time | When the folder was created. |
| folders[].updatedAt | string (date-time) | — | format date-time | When the folder last changed. |
| media[].id | string (uuid) | — | format uuid | Media ID. |
| media[].name | string | — | — | Display name. |
| media[].type | video \| image \| subtitle \| json \| other | — | enum: video, image, subtitle, json, other | Kind of media. |
| media[].status | uploading \| uploaded \| processing \| ready \| failed | — | enum: uploading, uploaded, processing, ready, failed | Processing state; only ready media can be published. |
| media[].originalFilename | string \| null | — | — | Filename at upload time. |
| media[].mimeType | string | — | — | Stored content type. |
| media[].sizeBytes | number \| null | — | — | File size in bytes. |
| media[].width | number \| null | — | — | Pixel width (images and videos). |
| media[].height | number \| null | — | — | Pixel height (images and videos). |
| media[].durationSeconds | number \| null | — | — | Duration in seconds (videos and subtitles). |
| media[].orientation | portrait \| landscape \| square \| null | — | enum: portrait, landscape, square | Derived from width and height. |
| media[].codec | object \| null | — | — | Detected codecs (videos). |
| media[].fps | number \| null | — | — | Frames per second (videos). |
| media[].jsonSchema | social_package \| null | — | enum: social_package | Recognised JSON format, for JSON media. |
| media[].subtitle | object \| null | — | — | Cue summary, for subtitle media. |
| media[].folderSuggestion | object \| null | — | — | Folder proposed from a social-package JSON; create it with POST /folders/from-suggestion. |
| media[].error | string \| null | — | — | Why processing failed, when status is failed. |
| media[].url | string \| null | — | — | Short-lived presigned download URL; null until the upload has finished. |
| media[].createdAt | string (date-time) | — | format date-time | When the media was created. |
| media[].updatedAt | string (date-time) | — | format date-time | When the media last changed. |

#### Example response

```json
{
  "folders": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "description": "x",
      "itemCount": 0,
      "coverUrl": "x",
      "createdAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z"
    }
  ],
  "media": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "name": "x",
      "type": "video",
      "status": "uploading",
      "originalFilename": "x",
      "mimeType": "x",
      "sizeBytes": 1,
      "width": 1,
      "height": 1,
      "durationSeconds": 1,
      "orientation": "portrait",
      "codec": {},
      "fps": 1,
      "jsonSchema": "social_package",
      "subtitle": {
        "segments": 0,
        "durationMs": 0
      },
      "folderSuggestion": {
        "folderName": "x",
        "items": [
          {
            "mediaId": "00000000-0000-4000-8000-000000000000",
            "role": "main_landscape"
          }
        ]
      },
      "error": "x",
      "url": "x",
      "createdAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z"
    }
  ]
}
```

### Social Connections · List

**GET /social-connections** — List connected social accounts

- Required scope: `connections:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

| Field | Type | Required | Default | Constraints | Description |
| --- | --- | --- | --- | --- | --- |
| cursor | string \| null | optional | — | min length 1; max length 300 | Opaque cursor from the previous page's nextCursor; omit for the first page. |
| limit | integer | required | 10 | min 1; max 10; default: 10 | Items per page (max 10). |
| provider | LINKEDIN \| X \| YOUTUBE \| FACEBOOK \| THREADS | optional | — | enum: LINKEDIN, X, YOUTUBE, FACEBOOK, THREADS | Only accounts of this provider. |

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/social-connections" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| items[].id | string (uuid) | — | format uuid | Connection ID; use as socialConnectionId when publishing. |
| items[].userId | string (uuid) | — | format uuid | Owner's user ID. |
| items[].provider | string | — | min length 1 | LINKEDIN, X, YOUTUBE, FACEBOOK or THREADS. |
| items[].providerAccountId | string | — | min length 1 | Account/page/channel ID on the platform. |
| items[].accountType | string \| null | — | — | Kind of account, e.g. person, organization, page or channel. |
| items[].username | string \| null | — | — | Account handle. |
| items[].displayName | string \| null | — | — | Account display name. |
| items[].profilePictureUrl | string \| null | — | — | Account avatar URL. |
| items[].config | object \| null | — | — | Provider-specific settings for this account. |
| items[].accessExpiry | string (date-time) \| null | — | format date-time | When the platform access token expires. |
| items[].refreshExpiry | string (date-time) \| null | — | format date-time | When the platform refresh token expires. |
| items[].scopes | string[] \| null | — | — | Platform permissions granted. |
| items[].isActive | boolean | — | — | False once disconnected. |
| items[].createdAt | string (date-time) | — | format date-time | When the account was connected. |
| items[].updatedAt | string (date-time) | — | format date-time | When the connection last changed. |
| items[].status | connected \| reconnect \| disconnected | — | enum: connected, reconnect, disconnected | connected = ready to publish; reconnect = the human must reconnect in the web app; disconnected. |
| nextCursor | string \| null | — | — | Pass as cursor to get the next page; null when there are no more items. |

#### Example response

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "userId": "00000000-0000-4000-8000-000000000000",
      "provider": "x",
      "providerAccountId": "x",
      "accountType": "x",
      "username": "x",
      "displayName": "x",
      "profilePictureUrl": "x",
      "config": {
        "example": "x"
      },
      "accessExpiry": "2020-01-01T00:00:00.000Z",
      "refreshExpiry": "2020-01-01T00:00:00.000Z",
      "scopes": [
        "x"
      ],
      "isActive": false,
      "createdAt": "2020-01-01T00:00:00.000Z",
      "updatedAt": "2020-01-01T00:00:00.000Z",
      "status": "connected"
    }
  ],
  "nextCursor": "x"
}
```

### Social Connections · Providers

**GET /social-connections/providers** — Which providers can be connected on this server

- Required scope: `connections:read`
- Rate limit: none beyond the API-key `api` bucket
- Possible errors: `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `VALIDATION`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`

#### Request

No fields.

#### Example request

```bash
curl -X GET "${API_PUBLIC_URL}/api/social-connections/providers" \
  -H "Authorization: Bearer $FANNOUT_API_KEY" \
  -H 'Content-Type: application/json'
```

#### Response

| Field | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| linkedin | boolean | — | — | LinkedIn can be connected on this server. |
| x | boolean | — | — | X can be connected on this server. |
| youtube | boolean | — | — | YouTube can be connected on this server. |
| facebook | boolean | — | — | Facebook can be connected on this server. |
| threads | boolean | — | — | Threads can be connected on this server. |

#### Example response

```json
{
  "linkedin": false,
  "x": false,
  "youtube": false,
  "facebook": false,
  "threads": false
}
```

## Agent rules

- Ask the human before publishing or deleting unless they have explicitly instructed you to do so.
- Never invent media IDs; list or search before referencing media.
- Check the platform limits below before calling validate or publish.
- Stop and report authentication or permission errors; do not work around them.
