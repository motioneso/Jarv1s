# Dev Environment & Infrastructure Notes

Operational notes for running Jarv1s locally. For the full command list see `CLAUDE.md` →
_Commands_; for release/ops scripts see `docs/operations/release-hardening.md`.

## Local / LAN dev run

This is a headless machine, so the Vite web shell must bind to all interfaces for LAN access.
Start the three processes (each in its own terminal):

```txt
pnpm --filter @jarv1s/web dev -- --host   # web shell on 0.0.0.0:5173 (proxies /api -> :3000)
pnpm dev:api                              # Fastify API on :3000
pnpm dev:worker                           # pg-boss worker (must run separately)
```

Access from another device on the tailnet: `http://100.64.98.99:5173` (Tailscale).

## Database / infrastructure

- **Docker Compose uses `pgvector/pgvector:pg17`.** Do not revert to `postgres:17-alpine` — the
  vector extension would be missing. (Also a hard invariant in `CLAUDE.md`.)
- The `vector` extension is installed in `infra/postgres/bootstrap/0001_extensions.sql`.
- `pnpm db:up` starts Postgres via Docker Compose; `pnpm db:migrate` applies app → module →
  pg-boss → grant migrations idempotently. DB-touching tests require `db:up` first.

## Running multiple agent sessions concurrently

When more than one agent session works the repo at once (each in its own git worktree), they
**share the single Postgres container** (`jarv1s-postgres`, port `55433`, database `jarv1s`).
Pointing them all at that one database collides three ways: they grab the same migration numbers,
concurrent integration runs (`resetFoundationDatabase` drops + reapplies) stomp each other, and
`db:migrate` hash-fails when a sibling branch's migrations are already applied. Give each session
its **own database** instead — the connection layer is env-addressable and the Postgres roles are
cluster-global, so no extra setup is needed:

```txt
# one-time, per agent (<label> e.g. mb1, p3)
docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarv1s_<label>;'

# then PREFIX every DB command (an agent's shell does not persist env between calls)
JARVIS_PGDATABASE=jarv1s_<label> pnpm db:migrate        # bootstraps extensions + migrates the fresh db
JARVIS_PGDATABASE=jarv1s_<label> pnpm test:integration  # (or verify:foundation, test:<module>)
```

`getJarvisDatabaseUrls()` reads `JARVIS_PGDATABASE` (also `JARVIS_PGHOST` / `JARVIS_PGPORT` and the
per-role `JARVIS_*_DATABASE_URL`) at runtime and builds every role URL against it; `scripts/migrate.ts`
runs `infra/postgres/bootstrap` first, so a brand-new database self-provisions on the first
`db:migrate`. **Never run against the shared `jarv1s` database concurrently.**

- **Migration numbers are a global sequence** (one `app.schema_migrations` table across all module
  `sql/` dirs). When several branches add migrations in parallel, assign numbers by **landing order**
  — the branch that merges first takes the lower numbers; later branches renumber above it after
  integrating `main`. Never edit an already-applied migration.

## Production deploy (containerized stack)

The deploy artifact is `infra/docker-compose.prod.yml` (NOT the dev
`infra/docker-compose.yml`, which bind-mounts source and runs `tsx` for everything). It
runs two images: one app image (`ghcr.io/motioneso/jarv1s-api`) used for api / worker /
migrate by command selection, and an nginx static-web image (`ghcr.io/motioneso/jarv1s-web`)
that serves the SPA and reverse-proxies `/api` + `/health` to the api — so the api keeps
its `default-src 'none'` CSP and never serves HTML. The api/worker run as bundled plain
`node dist/server.js` / `node dist/worker.js` (no tsx, no per-start install). The migrate
one-shot runs `tsx scripts/migrate.ts` (NOT bundled — module SQL dirs resolve via
`import.meta.url`, which bundling would break); the image ships tsx + the SQL tree for it.

**Deploy steps:**

```txt
cp infra/env.production.example infra/env.production.local   # off-git; fill secrets/UIDs/tag
# set JARVIS_IMAGE_TAG to a published version tag (never :edge/:latest)
# NOTE: pass --env-file so Compose INTERPOLATION vars (JARVIS_IMAGE_TAG,
# POSTGRES_PASSWORD, JARVIS_HOST_UID/GID, socket/dir paths) resolve — a service
# `env_file:` only feeds the container's RUNTIME env, NOT `${...}` substitution, and
# the prod Compose now fails loudly if JARVIS_IMAGE_TAG or POSTGRES_PASSWORD is unset.
docker compose --env-file infra/env.production.local -f infra/docker-compose.prod.yml up -d
# or, at boot: systemctl enable --now jarv1s-stack   (the unit's EnvironmentFile
# exports the same vars into the service env, so interpolation resolves there too)
```

Order: postgres (healthcheck) → migrate one-shot (`tsx scripts/migrate.ts`: bootstrap →
app+module SQL → pg-boss → grants; exits 0) → api+worker (gated on
`service_completed_successfully`) → web (gated on api healthy). Every long-running
service is `restart: unless-stopped`; the api keeps a `/health` HEALTHCHECK.

**Host prerequisites:** Docker + the compose plugin installed and the daemon running
(`jarv1s-stack.service` has `Requires=docker.service`). The embedding model downloads on
first use into the `jarv1s-model-cache` named volume (`HF_HOME=/app/.cache/huggingface`);
set `JARVIS_EMBED_PROVIDER=stub` to skip it.

## Host-multiplexer bridge (CLI chat from the container)

Live CLI chat drives `claude`/`codex`/`gemini` through tmux under the operator's personal
auth. Per ADR 0008 §2 we do NOT bundle the AI CLIs (`claude`/`codex`/`gemini`) — they are
host-provisioned and run on the HOST. The tmux SERVER also runs on the host. What the
container carries is only the thin **tmux CLIENT** (apt-installed in the image): the
api/worker engine execs `tmux send-keys/...` from inside the container against the
bind-mounted host tmux socket, so the AI CLIs launch on the host with host auth. The
container **steers the host's** tmux and **reads the host's** transcripts through bind
mounts (only on api/worker):

1. **tmux socket** — the host per-uid tmux socket dir (`/tmp/tmux-<uid>`, mode 0700) is
   bind-mounted at the same path; the tmux server runs on the host. (Herdr-from-container
   is NOT wired in this slice — run herdr on the host and set `JARVIS_MULTIPLEXER=tmux`
   for the container.)
2. **Host CLI dirs (least-privilege)** — ONLY the three CLI-config dirs `~/.claude`,
   `~/.codex`, `~/.gemini` are bind-mounted READ-ONLY under `/host-home` (NOT the whole
   host HOME — that would expose `~/.ssh`, git/cloud creds, shell history). They line up
   under `JARVIS_CLI_HOME_BASE=/host-home` so the engine's `transcriptGlobDir` finds
   `/host-home/.claude|.codex|.gemini`.
3. **Neutral-dir alignment** — the per-user neutral dir base (`JARVIS_CHAT_HOME`) is
   mounted at the SAME absolute path on host and container so the host-spawned CLI `cd`s
   into the dir the container computed.

**UID mapping:** the container runs as `JARVIS_HOST_UID:JARVIS_HOST_GID` (the host operator
uid/gid) so it can open the 0700 socket and read the three RO CLI dirs. Because that uid
may differ from the image `node` uid, the writable named volumes (model cache, vault) are
made world-writable at build (Task 7). If the uid does not match the socket owner, CLI chat
silently breaks while REST stays green — the reboot-survival probe catches this by execing
`tmux ls` FROM INSIDE the running api container (not on the host), so a bad
`JARVIS_HOST_UID`/`GID` or a broken socket mount surfaces as a probe failure.

**Security tradeoff (accepted, documented):** mounting the three host CLI-auth dirs + the
tmux socket means a container compromise can reach the operator's personal CLI credentials
and steer host tmux sessions. This is accepted under the **single-operator household model**
(ADR 0007) — the same shared-uid soft boundary the CLI-adapter slice documents. The mount
is scoped to the three CLI dirs (read-only), NOT the whole HOME, to bound the blast radius.
It is **opt-in**: present only when the CLI-subscription adapter is chosen.
The **API-key adapter needs NONE of these mounts** (it talks HTTP to a provider), so an
API-key instance runs with a strictly smaller attack surface.

## Reboot-survival check

After a host reboot (or `systemctl start jarv1s-stack`), confirm the stack survived:

```txt
JARVIS_API_PORT=3000 scripts/verify-reboot-survival.sh
```

It asserts (1) `/health/ready` returns `{ ok:true, db:"ok", pgboss:"ok" }` and (2) the
multiplexer bridge is live — when the containerized stack is running it execs `tmux ls`
INSIDE the api container (proving the bind-mounted host socket is reachable as the mapped
uid, AND that the tmux SERVER is the host's per ADR 0008 — it never starts a server from
the container, which would false-green); otherwise it falls back to a host-side
tmux/herdr liveness check. The in-container probe shells out to `docker compose` with
`--env-file infra/env.production.local` (auto-detected) so the prod Compose's required
interpolation vars resolve; override the file with `JARVIS_ENV_FILE_ABS`. Non-zero exit
means a component is down — it fails loudly, never false-green.
