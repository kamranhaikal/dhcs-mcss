# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- **Standing requirement**: any field/column added to the dashboard table (Home.tsx) must always be mirrored in both `/api/rss.xml` and `/api/feed.json` — this applies to all future changes, not just a single task. Keep `rss.ts`'s JSON feed item shape and RSS item HTML body in sync with whatever the dashboard table displays.

## Gotchas

- After editing `artifacts/api-server/src/lib/scraper.ts`, run `pnpm --filter @workspace/api-server run build` then restart the API Server workflow for changes to take effect.
- `www.dhcs.ca.gov` is behind Incapsula bot protection — direct `fetch()`/`curl` from the server gets a JS-challenge page, not the real HTML. The scraper fetches DHCS Public Notices pages through the `r.jina.ai` read-only proxy (`https://r.jina.ai/<url>`), which renders the page and returns clean markdown. If that proxy ever goes down, this source will need a different renderer/proxy.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
