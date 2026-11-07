# Fannout monorepo

Product name: **Fannout** (double n).

## Mandatory conventions — read before adding any endpoint, list, page or delete

- [docs/conventions/api.md](docs/conventions/api.md) — pagination (cursor, max 10),
  nested collections, idempotent deletes, typed error codes, Inngest for platform calls.
- [docs/conventions/frontend.md](docs/conventions/frontend.md) — `useInfiniteList` +
  `<InfiniteList>`, optimistic mutations, ConfirmDialog + kebab menus for destructive actions.
- UI work also follows [apps/web/DESIGN.md](apps/web/DESIGN.md).

Enforced by `packages/trpc/test/pagination.test.ts` and the PR checklist
(`.github/pull_request_template.md`).

- Any change that adds, removes or modifies an API-key-accessible endpoint, its input/output Zod models, scopes, rate limits, error codes or platform capabilities MUST: (1) add/keep `.describe()` on every new field, (2) run `pnpm docs:agent`, (3) commit the updated `docs/ai.md` in the same change. Hand-written parts of `ai.md` live in `docs/ai.template.md` — update them when workflows change. `pnpm docs:agent:check` must pass before finishing any task.
