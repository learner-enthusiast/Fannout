# Fannout

Write once, publish to every channel.

Turborepo (pnpm) monorepo:

| Path | What |
| --- | --- |
| `apps/web` | Next.js App Router web app: Tailwind v4, shadcn/ui (Base UI), Clerk |
| `apps/api` | Express + tRPC API (OpenAPI at `/docs`) |
| `packages/*` | Shared database, services, tRPC router, logger, errors and configs |

## Getting started

```sh
cp .env.example .env   # fill in Clerk + database values
pnpm install
pnpm dev
```

| Command | Does |
| --- | --- |
| `pnpm dev` | Run all apps |
| `pnpm build` | Build all apps |
| `pnpm lint` | ESLint plus the web design-rule lint |
| `pnpm check-types` | TypeScript |
| `pnpm test` | Unit tests |

## UI

UI work in `apps/web` follows [`apps/web/DESIGN.md`](apps/web/DESIGN.md).
Brand tokens live in `apps/web/app/globals.css`. In development,
`/theme-preview` shows every token and component.

## Clerk user sync

Configure Clerk's API keys and webhook signing secret in the root `.env` using
`.env.example`. In the Clerk Dashboard, go to **Webhooks** and add the endpoint
`{API_PUBLIC_URL}/webhooks/clerk` (use an ngrok URL for local development).
Subscribe to `user.created`, `user.updated`, and `user.deleted`, then copy the
endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`.
