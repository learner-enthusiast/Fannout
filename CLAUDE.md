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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
