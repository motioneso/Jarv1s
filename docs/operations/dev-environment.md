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

Access from another device on the tailnet: `http://<tailscale-ip>:5173` (Tailscale).

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
runs one app image (`ghcr.io/motioneso/jarv1s`) plus Postgres. The `jarv1s` container
runs migrations, starts the internal cli-runner, starts the worker, and serves the API
plus built web assets on one public port.

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

Order: postgres (healthcheck) → jarv1s supervisor. The supervisor prepares runtime dirs,
runs migrations, starts the internal cli-runner RPC server, starts the worker, then starts
the API/static-web server. The `jarv1s` service is `restart: unless-stopped` and keeps a
Docker healthcheck on `/health/ready`.

**Host prerequisites:** Docker + the compose plugin installed and the daemon running
(`jarv1s-stack.service` has `Requires=docker.service`). The embedding model downloads on
first use into the `jarv1s-model-cache` named volume (`HF_HOME=/app/.cache/huggingface`);
set `JARVIS_EMBED_PROVIDER=stub` to skip it.

## Connector-sync worker secrets & tuning

The Google connector-sync job runs in the **worker** process and decrypts two at-rest secrets,
so the worker's environment MUST export both keys — and they MUST match the API process's
values, because the secrets are encrypted by the API and decrypted by the worker:

- `JARVIS_CONNECTOR_SECRET_KEY` — decrypts the stored Google OAuth bundle (access/refresh
  token) before any Google API call.
- `JARVIS_AI_SECRET_KEY` — decrypts the user's AI provider credential for the capability-routed
  email summary/signals pass.

If either key is missing or differs from the value the API used to encrypt, decryption fails.
This is surfaced as a **sync error label** on the result, not a process crash (spec risk #4),
so the rest of the app stays up while the sync reports the failure. In the containerized stack,
the `jarv1s` service carries the worker and API env in the same env file.

The sync has four optional tuning knobs (each with a built-in default), so an operator can bound
sync cost and latency without code changes:

| Variable                      | Default | Effect                                                                                    |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `JARVIS_RL_GOOGLE_SYNC_MAX`   | `6`     | Per-actor rate limit (per minute) on the manual `POST /api/connectors/google/sync` route. |
| `JARVIS_EMAIL_SYNC_CAP`       | `50`    | Max email messages summarized per sync run.                                               |
| `JARVIS_EMAIL_LLM_TIMEOUT_MS` | `20000` | Per-LLM-call timeout (ms) for the summary/signals pass.                                   |

## In-container CLI runtime

Live CLI chat runs through the cli-runner process inside the `jarv1s` container. Provider
CLIs install into the `jarv1s-cli-tools` volume and auth/session state lives in
`jarv1s-cli-auth`; no host tmux socket or host CLI config directories are mounted into the
production stack. The API talks to cli-runner over `/run/jarv1s/cli-runner.sock` with
`JARVIS_CLI_RUNNER_RPC_SECRET`.

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
