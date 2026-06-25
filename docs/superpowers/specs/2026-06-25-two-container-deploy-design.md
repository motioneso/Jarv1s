# Two-container Deploy Consolidation

**Status:** checkpoint-approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s` working tree, README target compose template, current `infra/docker-compose.prod.yml`, `Dockerfile`, `apps/web/Dockerfile`, and cli-runner RPC specs.

## 1. Decision

Jarv1s should move toward the user-facing deployment shape shown in `README.md`: one `postgres`
container and one `jarv1s` container.

The chosen direction is **Option A**:

- Externally, Docker Compose exposes only `postgres` and `jarv1s`.
- Internally, the `jarv1s` container may run multiple processes: API, worker, cli-runner, static web
  serving, and migrations.
- The existing cli-runner RPC/process boundary stays in place inside the `jarv1s` container.

This is a checkpoint decision. If the internal RPC boundary later blocks a real feature or creates
concrete operator pain, revisit the decision rather than preserving it by inertia.

## 2. Why This Direction

The README target is simpler for operators: copy a compose file, provide secrets, run one app
container plus Postgres.

The current production stack is close but still exposes several app services:

- `api`
- `worker`
- `migrate`
- `cli-runner`
- `web`
- `init`
- `postgres`

Most of those app roles already share the same app image. The remaining gap is mostly packaging and
process orchestration, not product architecture.

Keeping cli-runner as a separate process preserves the important safety work already done in
`2026-06-20-in-container-cli-chat.md` and `2026-06-20-cli-runner-rpc-contract.md`: provider CLIs do
not casually inherit the API's full secret-bearing runtime, and CLI actions remain explicit RPC
commands.

## 3. Target Runtime

The target compose shape is:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17

  jarv1s:
    image: ghcr.io/motioneso/jarv1s:stable
```

Inside `jarv1s`, startup should do the smallest reliable sequence:

1. Prepare writable runtime directories and volumes.
2. Run database migrations before long-lived processes accept traffic.
3. Start cli-runner as a separate local process with a sanitized environment.
4. Start the worker.
5. Start the API.
6. Serve the built web UI from the Jarv1s app process or from a tiny in-container static server.

Postgres remains separate. The project invariant requiring a pgvector-enabled Postgres image still
applies.

## 4. Boundaries Kept

The cli-runner RPC boundary stays:

- API talks to cli-runner over the existing local RPC contract.
- Provider CLI install/auth/transcript paths stay owned by cli-runner.
- CLI subprocess env remains allowlisted.
- New provider CLI capabilities should be added as explicit RPC behavior, not by letting API code poke
  through cli-runner internals.

This does not require preserving the current sidecar container forever. The boundary that matters for
this checkpoint is the process/RPC contract, not a separate Compose service.

## 5. Boundaries Relaxed

The hard container-level split between API and cli-runner is relaxed.

That means the single `jarv1s` container must be treated as one trust domain at the container level.
The remaining defense is process/env discipline plus the existing RPC contract. That is an acceptable
trade for the simplified household/self-hosted deploy shape, but it is the main thing to revisit if
Jarv1s grows into a multi-tenant or hostile-plugin runtime.

## 6. Implementation Outline

Keep this small:

1. Update the app image build so it includes the built web assets.
2. Add a minimal production entrypoint/supervisor for the single `jarv1s` container.
3. Move static web serving into the app image and remove the production `web` image from the deploy
   contract.
4. Collapse production Compose app services into one `jarv1s` service while keeping `postgres`.
5. Keep existing migration, worker, API, and cli-runner entrypoints callable for development and tests.
6. Update smoke tests and docs to assert the two-container public contract.

Do not rewrite the cli-runner RPC protocol as part of this consolidation.

## 7. Verification

Minimum checks for implementation:

- `pnpm test:unit`
- production compose config validation
- production compose smoke for `postgres` + `jarv1s`
- readiness check against the public Jarv1s port
- a basic CLI-provider unavailable/available path check, depending on local test fixtures

The smoke should prove that a fresh deploy can run migrations, start the worker, serve the web UI, and
report API readiness with only `postgres` and `jarv1s` services.

## 8. Reversal Point

Revisit this checkpoint if any of these become true:

- RPC plumbing blocks common provider features.
- In-container process supervision becomes fragile or hard to debug.
- The single container meaningfully weakens secret handling in practice.
- Operators need independent restart/scale/debug controls for API, worker, web, or cli-runner.
- Multi-tenant isolation becomes a product requirement.

Until one of those happens, keep the simpler public deploy and preserve the internal RPC boundary.
