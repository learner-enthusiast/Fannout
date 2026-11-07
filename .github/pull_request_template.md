## What & why

<!-- One or two sentences. -->

## Checklist

**Lists** ([docs/conventions/api.md](../docs/conventions/api.md), [frontend.md](../docs/conventions/frontend.md))
- [ ] Every new/changed endpoint returning multiple items takes `PaginationInput` (cursor, limit ≤ 10) and returns `{ items, nextCursor }` — no unbounded arrays, no offsets
- [ ] Nested collections have their own paginated endpoint; the parent `get` returns metadata only
- [ ] Every list in the UI uses `useInfiniteList` + `<InfiniteList>` (skeletons, "No more items", retry, EmptyState)
- [ ] Search/filter changes reset to page 1 and keep previous results visible

**Mutations**
- [ ] List-item create/update/delete is optimistic across every cached page (lists, detail, search, counts) via `lib/optimistic.ts`, restored on error with a toast, invalidated on settle
- [ ] The item's actions are disabled while its mutation is in flight

**Destructive actions**
- [ ] ConfirmDialog names the item in quotes, states consequences (and what is NOT affected); destructive button on the right; Enter doesn't confirm
- [ ] Card actions are in the kebab menu (Delete last, destructive); Delete key opens the same dialog
- [ ] Deletes are idempotent, ownership-checked, return typed error codes, and platform calls run in Inngest
- [ ] Success toast "Deleted “{name}”"; no Undo unless the backend can restore

**Checks**
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm build`, tests (incl. `packages/trpc/test/pagination.test.ts`)
- [ ] For API-key endpoints/models/scopes/rate limits/errors/platform capabilities: every new field has `.describe()`, `pnpm docs:agent` was run, `docs/ai.md` is committed, and `pnpm docs:agent:check` passes
