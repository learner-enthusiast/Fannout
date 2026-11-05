# apps/web — Fannout web app

Product name: **Fannout**, spelled with a double n. Never drop the second n.

## UI work — MANDATORY
Read and follow [`DESIGN.md`](./DESIGN.md) for ANY UI change. It overrides skill
defaults and shadcn defaults.

- Tokens: `app/globals.css` only (mirror any change in `lib/brand.ts`; `pnpm test` checks it).
- Pages and feature components pick `variant` / `size` on shared components and never
  pass colour, radius, height or font-size classes to Button/Input/Badge/Card.
- Forms render fields with `FormField` only.
- Status uses `StatusBadge` (icon + text + colour).
- Check new UI on `/theme-preview` (dev) in both themes, at 375px and 1280px.
- `pnpm lint` runs `scripts/lint-design.mjs` (no hex, palette classes, arbitrary values,
  or style overrides on shared controls). `pnpm contrast` checks WCAG ratios.

## Layout
- `app/(marketing)` — public pages (header + footer).
- `app/(app)` — signed-in app (AppShell, protected by Clerk in the layout).
- `app/(dev)` — dev-only tools, 404 in production.
- `components/ui` — shared components (shadcn base-ui, customised to DESIGN.md).
- `components/layout` — app shell (header, sidebar, footer, page header).

## Local screenshots
Start dev with `FANNOUT_DEV_AUTH_BYPASS=1` (ignored in production), then run
`NODE_PATH=$(npm root -g) node scripts/screenshots.mjs`. Output goes to `screenshots/`.
