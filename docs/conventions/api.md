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
