# Fannout API agent guide

Fannout lets a person prepare media once and fan it out to connected social platforms.
Use this guide when acting through the HTTP API with a scoped personal API key.
This document is the contract. Follow it exactly.

Generated from code at <!-- GENERATED:SHA --> on <!-- GENERATED:DATE -->. Do not edit generated sections by hand.

## Authentication

Set `API_PUBLIC_URL` to the public origin of the API (for example, `https://api.example.com`). The base URL is `{API_PUBLIC_URL}/api`.

Send `Authorization: Bearer fn_live_…`. Create keys in **Settings → API keys**. Never log, echo, commit, or return an API key to a human. Give each key only the scopes it needs.

<!-- GENERATED:SCOPES -->

## Rate limits

<!-- GENERATED:RATE_LIMITS -->

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

<!-- GENERATED:PLATFORMS -->

## Endpoint reference

<!-- GENERATED:ENDPOINTS -->

## Agent rules

- Ask the human before publishing or deleting unless they have explicitly instructed you to do so.
- Never invent media IDs; list or search before referencing media.
- Check the platform limits below before calling validate or publish.
- Stop and report authentication or permission errors; do not work around them.
