# API conventions (Fannout)

Mandatory for every tRPC procedure / REST route. Enforced by
`packages/trpc/test/pagination.test.ts` (list procedures) and code review
(`.github/pull_request_template.md`).

## Lists & pagination

- Every endpoint returning more than one item is **cursor-paginated**. No
  exceptions, no unbounded arrays, no offset pagination.
- Input: `PaginationInputSchema` from `packages/services/common/pagination.ts`
  (`cursor?`, `limit` default **10**, max **10**) — `.extend({...})` it for filters.
  Output: `paginatedOutput(itemSchema)` → `{ items, nextCursor }`.
- Sort **DESC** by the list's sort key (usually `created_at`), tie-break by `id`;
  fetch `limit + 1` rows to compute `nextCursor`.
  - Time-sorted lists: `cursorTimestamp` / `afterCursor` / `toPage` (cursor =
    base64url("created_at|id"), microsecond-exact so equal timestamps never skip
    or repeat).
  - Explicitly ordered lists (e.g. folder items by role → position) sort by that
    order and use `encodeKeyCursor` / `decodeKeyCursor` / `toKeyPage`
    (cursor = base64url("sortKey|id")).
- **Nested collections get their own paginated endpoint.** The parent's `get`
  returns metadata only (e.g. `folders.get` → counts; `folders.items` → the items).
- Search endpoints: at most **10 results per section** (`search.unified`).
- A list that truly can't be paginated (static config, a third-party list we
  proxy) goes in `packages/trpc/test/pagination-allowlist.ts` **with a reason**.
  The allowlist should stay (nearly) empty.

## Deletes

- **Idempotent**: deleting something already gone returns success
  (`media.delete` → `{ deleted: true, alreadyGone: true }`).
- **Ownership check first** (scope every query by `userId`); someone else's id
  behaves like "already gone" — never leak existence.
- When a delete isn't allowed, return a **typed error code** with the blocking
  items (e.g. `MEDIA_IN_USE` + `details.posts` for media used by unpublished posts).
- Deleting a **container** (folder, batch) never deletes the things it references.
- Deletes that call **external platforms** run in Inngest (`post/delete.requested`
  → `delete-post`), never inside the request.

## Delayed work

- Delayed work = a **BullMQ job with a deterministic id + version**
  (`sched:{postId}:v{version}`); changing the time bumps the version, so old jobs
  are stale rather than duplicated.
- The worker (`apps/worker`) must **re-validate state in the DB with an atomic
  `UPDATE … WHERE version = ? AND status = ? RETURNING`** before acting; 0 rows =
  stale/cancelled job → log and exit. Never trust a job's payload alone.
- BullMQ decides *when*; the work itself (platform calls) still runs in Inngest.
  A sweeper recovers lost jobs, so enqueue failures are logged, not fatal.

## Also

- Zod models live in `services/<feature>/model.ts`; procedures declare
  `.input()`, `.output()` and OpenAPI `meta`.
- Every protected procedure declares its API-key scope (`scoped("…")`) and, if
  expensive, a rate-limit bucket (`.use(rateLimit("…"))`).

## Analytics

- Dashboards read **only** from Fannout's analytics tables (`analytics_account_daily`,
  `analytics_post_snapshots`, `analytics_sync_state`) and our own `posts` /
  `scheduled_posts`. Platform analytics APIs are called **only** in the Inngest sync jobs
  (`packages/inngest/functions/analytics.ts` → `services/analytics/sync.ts`), never in a
  request. `analytics.refresh` only queues a sync (1 per connection per 15 min).
- Metrics are stored under the **normalized keys** in `services/analytics/model.ts`
  (`METRIC_KEYS`). A metric a platform doesn't report is **absent** — never stored as 0 —
  and the UI renders it as "—".
- Adding a platform metric: map it in `services/analytics/platforms/<platform>.ts`
  (add a normalized key to `METRIC_KEYS`/`MetricsSchema` only if none fits), list it in
  `ANALYTICS_CAPABILITIES` (`services/analytics/capabilities.ts`), cite the doc URL in the
  platform file, then run `pnpm docs:agent` and commit `docs/ai.md`.
- A connection missing a scope in `requiredScopes` gets status `needs_reconnect` with no
  API call. Auth/permission errors during sync set the analytics status only; they never
  clear the connection's publishing tokens.

## AI copy

Generation is three stages inside the `generate-content` Inngest function: **brief** (one per set of
inputs, cached by input hash as an `ai_generations` row with `scope.kind = "brief"`), **platform writers**
(one step per account, in parallel) and **validation + one repair** (in code).

- **Every new platform or post type needs** a playbook in `packages/ai/prompts/platforms/<platform>.ts`
  (system prompt + Zod output schema + `PROMPT_VERSION`, registered in `prompts/index.ts`) **and** an entry
  in `packages/ai/prompts/length-targets.ts`. Bump `PROMPT_VERSION` whenever a prompt changes; the
  platform, post type and version are saved in `ai_generations` with every generation.
- **Length numbers live in one place.** Playbooks interpolate `length-targets.ts` (via `target(...)`);
  never write a number into a prompt. The platform's compose model (`packages/providers/<platform>/model.ts`)
  wins over the table: its `maxLength` / `countMode` replace the table's limit and unit and the band
  scales (`services/ai-content/targets.ts`).
- **Length comes from source material, never padding.** Writers reach the band with distinct points,
  facts, examples and FAQs from the brief. Too little material = a shorter text plus a "Shorter than
  target" note. Code trims, it never pads.
- **Models never write timestamps.** They return cue ids; `services/ai-content/chapters.ts` maps them to
  the real cue start times and validates the block (first at 00:00, ≥ 3 chapters, ascending, ≥ 10 s each,
  before the video ends). Invalid = no chapters block.
- **Every limit is validated in code with the right unit** — `chars`, `weighted` (X) or `bytes`
  (Threads, YouTube descriptions) — using the same `length-targets.ts` entry the prompt used. Hashtags
  are returned as a list and normalised/appended in code. One repair call lists the exact failures with
  numbers; still over the hard limit = trimmed at a sentence/word boundary.
- **User instructions are preferences.** Global + per-account instructions are added to each platform
  prompt as "user preferences" and can never override limits, bands or the no-invented-facts rule.
- **Generation only fills compose cards.** It never publishes; the user reviews and posts.
- Source text and generated copy never leave an Inngest step (steps return ids, counts and limit notes).
  Photos go to the model as downscaled inline images fetched server-side — never presigned URLs.

## Platform capabilities, tags and manual steps

- **Capabilities are the single source.** Each platform's `*_COMPOSE` (in `packages/providers/<platform>/model.ts`)
  declares `carouselMode` (`api` | `manual` | `none`) + `carouselMax`, `tagging`
  (`image`: positioned | list | none, `video`: list | none, `max`, `needsUserId`) and `collaborators`
  (`{ max }` | null). Server validation and the compose UI read **only** these; no platform name checks in
  components. Flipping a value (e.g. YouTube `carouselMode` to `api`) must need no other code change.
- **Manual posts** (`carouselMode: "manual"`, e.g. YouTube image posts: the Data API has no endpoint) are
  created with status `draft` and `posts.config.manual = { status: "pending" }`. They are never sent to the
  publish job and never hold a batch open; `posts.markManualPosted` sets them to `published`.
- **Manual follow-ups never block or fail a publish.** A step an API can't do (YouTube related video, end
  screens) is stored in `posts.config.<platform>` with a `status`, announced with a `post_task`
  notification after the post is live, and closed by the user ("Mark done"). Never automate a platform's
  web UI.
- **Media tags are not @mentions.** They are sent in the compose input (`userTags`, `taggedUsers`), stored
  under `posts.config.instagram.tags` / `posts.config.x.taggedUsers` (`splitComposeInput` /
  `joinComposeInput`) and validated before publishing (class `validation`): format, per-media maximum, no
  duplicates, positions only where the platform takes them. A platform rejecting a tag is shown on the
  post — tags are never dropped silently. The one exception is X: one retry without tags, then a
  `post_warning` notification naming who couldn't be tagged.
- **Paid lookups are saved and cached, never repeated.** X user ids (`GET /2/users/by/username`, billed) are
  resolved once at selection time, saved on the mention contact (`mention_contacts.platform_ref`) and
  cached in the `mentions` group. Check the contact before calling the platform.
- New usernames used in a published post are saved to `mention_contacts` for the tag popover.

## Caching

Service-level reads go through a Redis cache-aside layer (`packages/services/cache`). The TTL is only a
safety net: correctness comes from invalidating on every write.

- **Reads.** Every new get/list service function picks a group from `CACHE_TTL_SECONDS`
  (`user`, `apiKey`, `connections`, `media`, `posts`, `notifications`, `analytics`, `platform:{connId}`,
  `mentions`, `aiPresets`) and goes through `cached({ userId, group, key, input, schema, load })`.
  `input` must hold everything that changes the result (cursor, limit, search text, filters, tab,
  connection id, folder id). `schema` is the **output** model; a cached value that no longer validates is
  a miss. Use `isStale` / `cacheable` / `forCache` when a value depends on time or holds in-flight state
  (e.g. a scheduled post whose `scheduled_at` has passed is a miss).
- **Writes.** Every new write function calls `invalidate(userId, ...groups)` **after the commit, in the
  service layer** (so tRPC, Inngest, BullMQ, webhooks and Meta callbacks are all covered), and never inside
  an open transaction. Inside Inngest, invalidate in the same step as the write. Global keys (`user`,
  `apiKey`) use `delKey(globalKey(...))`.
- **Never in the cache:** access/refresh tokens (encrypted or not), presigned upload/download URLs (cache
  the rows and sign after the read), upload progress, `posts.config.progress`, rate-limiter state. No key
  without a TTL, and never `KEYS` / `SCAN`.
- **Workers read the DB directly.** publish-post, delete-post, edit-post, process-media, the schedule
  worker and sweeper, token refresh, connection health checks and API-key scope checks on write endpoints
  never read through the cache ("check the DB before posting" must stay true).
- **Fail open.** A Redis error or timeout (200 ms) means "read Postgres"; a cache failure never fails a
  request. `CACHE_ENABLED=false` bypasses the layer.
- After adding new files, run `graphify update .` (the git hook also does it on commit).

## Uploads

One upload engine (`apps/web/components/uploads/upload-provider.tsx`, mounted in the `(app)` layout) and
one picker (`MediaPickerDialog`) for every media slot. Never build a second upload path.

- **One picker for every slot.** Video, photos, thumbnails (pool and per card), subtitles and social JSON
  all open `MediaPickerDialog` with an "Upload" tab (default: drop zone, "Choose files", paste) and a
  "Library" tab (multi-select, shift-click range). Dropping files straight onto a slot works too.
- **Uploads start on selection.** Choosing files closes the popup and adds them to the slot at once; no
  confirm step. Previews, dimensions and duration come from the browser and are checked against
  capabilities per platform while the bytes are still moving.
- **The media row exists from init.** `POST /media/uploads` creates the row with status `uploading` and
  enforces the slot's file type, the size limit (largest platform limit) and the per-user concurrent
  upload cap. Identical ready files (fingerprint in `media.metadata.fingerprint`) are reused.
  `uploading → uploaded → processing → ready | failed`; process-media sniffs the real type from the bytes
  and sends `media/ready` / `media/failed`.
- **Posts can be created before media is ready.** Post and schedule accept media in `uploading`,
  `uploaded`, `processing` or `ready` (never `failed`). publish-post's `await-media` step reads statuses
  from Postgres, waits on `media/ready` (15 min per wait, 24 h cap; the schedule's late window for
  scheduled posts → `missed`), fails the post on a failed file, and re-runs the platform media rules once
  everything is processed. A thumbnail that isn't ready is skipped with a `post_warning`, never a failure.
- **Never disable Post for uploads.** The label becomes "… (uploads finishing)"; only validation errors
  disable it.
- **Progress state stays out of page state.** Byte progress lives in the throttled external store
  (`upload-store.ts`, ≤ 5 updates/s); only progress rings and the tray subscribe to it. Pages read
  status changes, never ticks.
- **S3 hygiene.** Cancel aborts the multipart upload (`POST /media/{mediaId}/fail`); the bucket needs an
  `AbortIncompleteMultipartUpload` lifecycle rule (1 day).
