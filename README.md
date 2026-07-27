# DHCS MCSS — Medi-Cal Intelligence

Source of truth for **https://dhcs-mcss.duckdns.org** — a searchable monitor of official DHCS
Medi-Cal publications (news, provider bulletins, notices, alerts) with RSS/JSON feeds and an
Excel export.

Two independent halves, deliberately **not** merged into one build:

| | Path | What it is |
|---|---|---|
| `frontend/` | React + Vite + Tailwind SPA | builds to `dist/public`, ships to `/var/www/dhcs` |
| `backend/` | pnpm workspace, Express 5 on Node | esbuild bundle, scrapes DHCS live, no database |

## What's deployed where

- **Caddy** (`/etc/caddy/Caddyfile`) owns 80/443 for `dhcs-mcss.duckdns.org`, TLS automatic.
  - `root * /var/www/dhcs` — static SPA with `try_files … /index.html` fallback.
  - `/api/*` → `reverse_proxy localhost:5000`.
- **`dhcs-api.service`** (systemd) runs the backend: `WorkingDirectory=…/backend/artifacts/api-server`,
  `ExecStart=/usr/bin/node ./dist/index.mjs`, `PORT=5000`, `NODE_ENV=production`,
  `PUBLIC_ORIGIN=https://dhcs-mcss.duckdns.org` (this env var is what puts the public host into the
  feed URLs — without it they fall back to the request host).
- **DuckDNS** record refreshed every 5 min by `duckdns.timer` → `duckdns.service`.

## Deploying

**Build from the intended commit, *then* copy.** Never "copy whatever is in `dist/`" — `dist/` is
gitignored, so its presence on disk is not evidence of what is committed, and it may be newer,
older, or built from something else entirely.

### Frontend

```sh
git checkout <commit>
cd frontend
PORT=5173 BASE_PATH=/ npm run build          # vite.config.ts THROWS without both env vars, by design
sudo cp -a /var/www/dhcs /home/ubuntu/docroot-backups/var-www-dhcs-$(date +%Y%m%d-%H%M%S)
sudo rsync -a --delete-after --chown=caddy:caddy dist/public/ /var/www/dhcs/
```

`--delete-after` matters: asset filenames are content-hashed, so without deletion the old bundles
linger as orphans and a half-updated docroot half-works. Docroot is owned `caddy:caddy`.
Rollback is a copy-back from the backup — no rebuild, no Caddy reload.

### Backend

```sh
git checkout <commit>
cd backend && pnpm install --frozen-lockfile
cd artifacts/api-server && node ./build.mjs   # writes dist/ — see the warning below
sudo systemctl restart dhcs-api
curl -s localhost:5000/api/healthz            # {"status":"ok"}
```

Two things about that build:

- `build.mjs` **hardcodes its outdir and `rm -rf`s it first.** There is no override flag. Running it
  in the live tree deletes the file `ExecStart` points at for the duration of the build; with
  `Restart=always`, a crash in that window becomes a fail-loop. Build where the bundle will live, or
  build in a scratch copy.
- `esbuild-plugin-pino` **bakes the absolute output directory into the bundle** (`index.mjs`,
  `pino-file.mjs`, `pino-worker.mjs`). A bundle built elsewhere and copied in will point at the wrong
  path. It is dormant under `NODE_ENV=production` (no pino transport is configured) but it is a trap.
  Corollary: two builds of the same commit at different paths are *not* byte-identical — compare them
  with that one string normalised, not with raw `cmp`.

## ⚠️ Stale copies — this repo is the source of truth

These directories exist on the server and **look** authoritative. They are not. They are retained
only as rollback for the 2026-07-27 consolidation:

```
/home/ubuntu/apps/dhcs                              <- OLD backend working copy
/home/ubuntu/staging/kam2-inspect/kam2-site/frontend <- OLD frontend working copy
/home/ubuntu/apps/dhcs.bak-20260724                  <- older pre-upgrade backup
/home/ubuntu/docroot-backups/                        <- docroot snapshots
```

Do not edit them. Do not build from them. Anything committed here and anything running in
production comes from **this repo**. Before the consolidation, `apps/dhcs/artifacts/dashboard`
was mistaken for the live frontend source and cost three rounds of investigation — it is an
obsolete fork, not the live UI.

## Known broken

**`frontend/npm run typecheck` — do not trust it.** It exits 0 on the deployment box and 127
everywhere else. `typescript` is not a declared dependency and is not in `node_modules`; `npm run`
falls through to `PATH` and picks up a stray `tsc` 6.0.3 belonging to an unrelated tool installed on
this machine (the origin monorepo pinned `~5.9.3`). It also excludes `**/*.test.ts`, so test files
are never checked. Green here, red on CI, and the greenness is an accident. Left as-is deliberately;
fix it before wiring any CI that depends on it.

`frontend/npm test` is fine — vitest is declared, installed, and its 10 tests pass.

## Gotchas

- **`backend/artifacts/dashboard/` must stay where it is.** `backend/artifacts/api-server/src/app.ts:36`
  resolves `path.resolve(__dirname, "../../dashboard/dist/public")` and serves it as a static
  fallback. The package is an obsolete copy of the UI and looks deletable. It is not.
- **`/var/www/dhcs/sw.js` is a service worker.** After a deploy a browser can serve you the previous
  build from cache. Verify with `curl` first; in a browser, hard-reload or disable cache. Navigations
  are network-first and assets are keyed by hashed URL, so it self-heals — but it will lie to you once.
- **`totalReturned` from `/api/feed.json` is a live scrape.** Small drift between calls is normal;
  `0` or a 500 is not.

## Verifying a deploy

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://dhcs-mcss.duckdns.org/
curl -s https://dhcs-mcss.duckdns.org/ | grep -oE 'src="/assets/[^"]*"'      # expect the NEW hash
curl -s https://dhcs-mcss.duckdns.org/api/healthz                            # {"status":"ok"}
curl -s https://dhcs-mcss.duckdns.org/api/feed.json | head -c 120            # feedUrl must be the duckdns host
```

If `feedUrl` shows anything other than `https://dhcs-mcss.duckdns.org/api/feed.json`, an old backend
bundle is running — roll back.
