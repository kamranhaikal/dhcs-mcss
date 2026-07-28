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

*Every command below was run verbatim on 2026-07-27, from a fresh clone into a scratch docroot. That
is how the three defects it used to contain were found. The Backend block has not had this — see the
note there.*

```sh
git checkout <commit>
cd frontend
pnpm install --frozen-lockfile                # build fails ERR_MODULE_NOT_FOUND without this
PORT=5173 BASE_PATH=/ npm run build           # vite.config.ts THROWS without both env vars, by design
sudo cp -a /var/www/dhcs /home/ubuntu/docroot-backups/var-www-dhcs-$(date +%Y%m%d-%H%M%S)
sudo rsync -a --delete-after --chown=caddy:caddy --chmod=D775,F664 dist/public/ /var/www/dhcs/
```

`--delete-after` matters: asset filenames are content-hashed, so without deletion the old bundles
linger as orphans and a half-updated docroot half-works. Docroot is owned `caddy:caddy`.
Rollback is a copy-back from the backup — no rebuild, no Caddy reload.

`--chmod` is not optional. `-a` implies `-p`, so without it rsync reproduces **the build
directory's** permissions onto the docroot — including the docroot directory itself. Build in a
`umask 077` scratch directory and you get 0700 dirs and 0600 files under `/var/www/dhcs`, and the
docroot goes 0700 too. Caddy owns the files so the site keeps serving and `curl` keeps returning
200; what breaks is everything else, starting with your own `ls`. That happened on 2026-07-27 and
was caught only because the operator's next command was denied. Set the modes; never inherit them.

`D775,F664` is the docroot's own state. Three files there are 0644 rather than 0664
(`manifest.webmanifest`, `opengraph.jpg`, `sw.js`); that is umask residue, not intent — git stores
no mode beyond the executable bit, all of `public/` is `100644`, and a fresh `vite build` writes
every one of those files at whatever the builder's umask gives. This command normalises them to
0664 on the next deploy. Nothing reads or writes the docroot as group `caddy`, so 0644 throughout
would serve equally well if you would rather tighten than match.

### Backend

> **This sequence has NOT been executed as written.** The Frontend block above has — every command in
> it was run verbatim on 2026-07-27, into a scratch docroot, which is how three defects in it were
> found. This block has not had that treatment, so do not read its neighbour's proof as covering it.
>
> Why it was skipped rather than tested: `build.mjs` `rm -rf`s a hardcoded outdir that the running
> `dhcs-api` service `ExecStart`s from (see below), so running it to check the doc risks the live API
> for the sake of verifying prose. It needs a scratch copy of `backend/`, a spare port, and
> `dhcs-api` left alone.
>
> **What it still owes:** run all five lines in that scratch copy from a fresh clone; confirm
> `pnpm install --frozen-lockfile` succeeds there; confirm `build.mjs` writes where this block claims;
> confirm the `systemctl restart` / `healthz` pair is the right check and not a truncated one — that
> was exactly the bug in the frontend's feed check. Until then treat the commands below as *described*,
> not *verified*.

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

## Checks

Both run from `frontend/` and both need `pnpm install --frozen-lockfile` first — the toolchain is
declared, not borrowed from `PATH`.

- **`npm run typecheck`** — `typescript` is a declared devDependency pinned `~5.9.3` (the version
  this code was written against) and the script invokes `./node_modules/typescript/bin/tsc`
  explicitly, so it cannot fall through to a `tsc` that happens to be on `PATH`. `**/*.test.ts` is
  **not** excluded: the two vitest files are typechecked along with `src/` and
  `lib-api-client-react/`.
- **`npm test`** — vitest, 10 tests, 2 files.

Until 2026-07-27 `typecheck` was a lie: `typescript` was undeclared and absent from the tree, so
`npm run` fell through to `PATH` and found a stray `tsc` 6.0.3 belonging to an unrelated tool on the
deployment box — exit 0 here, exit 127 anywhere else, and blind to the test files either way.

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
curl -s https://dhcs-mcss.duckdns.org/api/feed.json | grep -o '"feedUrl":"[^"]*"'
find /var/www/dhcs -type d \! -perm -o=rx -o -type f \! -perm -o=r          # expect no output
```

If `feedUrl` shows anything other than `https://dhcs-mcss.duckdns.org/api/feed.json`, an old backend
bundle is running — roll back.

The `find` catches a docroot rsynced without `--chmod` — see the Frontend section. It is deliberately
an invariant ("nothing unreadable to other") rather than an exact-mode match, so it stays silent on
the three 0644 files that predate this and speaks only when something is genuinely unreachable.
