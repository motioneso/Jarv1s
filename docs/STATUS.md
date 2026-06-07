# Jarv1s — Current Status

> This is a slim rolling doc. Update it at the end of every milestone and when significant
> decisions are made. Do not add history here — use ADRs, agentmemory, and closed GitHub Issues
> for that. Keep this under 60 lines.

## Current milestone

**None in progress.** Roadmap established; GitHub Issues + Milestones created. Next: begin M-A1.

## Last known-good state (2026-06-07)

```
pnpm verify:foundation → lint, format:check, file-size, typecheck pass
                          29 migrations applied; 177 integration tests pass (15 files)
pnpm audit:release-hardening → passed true; failures []
pnpm test:spike → 2 files, 15 tests pass
```

## Next step

**Begin M-A1**: run `/brief` to spec a provider-agnostic `LocalEmbeddingProvider`,
then `/start` for the implementation plan.

## Open questions (carry-forward from HANDOFF.md)

- Real external OAuth/OIDC callback verification against deployed provider apps.
- Final post-MVP API contract layer (continue Fastify REST, or tRPC/ts-rest/oRPC/OpenAPI-first).
- Detailed visual design direction for the shell.
- Exact task recurrence/reminder model.
- Exact follow-up scope for Notifications Web Push, preferences, delivery schedules.
- Exact follow-up scope for Calendar/Email real sync, attachments, full-text search.

## Infrastructure notes

- Docker Compose: `pgvector/pgvector:pg17` — do not revert to `postgres:17-alpine`.
- Vector extension installed in `infra/postgres/bootstrap/0001_extensions.sql`.
- Dev LAN access (headless machine): `pnpm --filter @jarv1s/web dev -- --host` (0.0.0.0:5173),
  then `pnpm dev:api` + `pnpm dev:worker`. Access via Tailscale: `http://<tailscale-ip>:5173`.

## GitHub

- Project board: https://github.com/users/motioneso/projects/1 ("Jarv1s Roadmap")
- Epic issues: #2–#10 (one per milestone, all on the board)
