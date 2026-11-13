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
