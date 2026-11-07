# apps/api — Fannout API

Read [docs/conventions/api.md](../../docs/conventions/api.md) before adding or
changing any endpoint: every list is cursor-paginated (limit ≤ 10), nested
collections get their own endpoint, deletes are idempotent with typed error
codes, and platform calls run in Inngest.
