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
