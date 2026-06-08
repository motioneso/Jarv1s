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
