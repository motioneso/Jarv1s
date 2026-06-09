# Wire tests/unit into the Gate + CI — Design (P1 #51)

**Status:** DRAFT (coordinator readiness, 2026-06-09) — needs Ben's sign-off
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #51 (Part of epic #46)

## Context

`pnpm verify:foundation` runs `vitest run tests/integration` and nothing else for testing. Fourteen
unit-test files (~1,938 lines) live in `tests/unit/` and are never executed by the gate or CI. They
cover non-trivial internals — HTTP adapter construction (`ai-http-api.test.ts`), tmux-bridge
message parsing (`ai-tmux-bridge.test.ts`), TmuxCliChatEngine state machine
(`cli-chat-engine.test.ts`), MCP gateway contract (`mcp-gateway-units.test.ts`), chat persona
handling, session management, and more. None of these tests require Postgres; they are purely
in-process with vitest mocks/stubs.

The current `vitest.config.ts` root `include` is `["spikes/**/*.test.ts", "tests/**/*.test.ts"]`,
which means `pnpm exec vitest run tests/unit` already resolves correctly using the same config's
alias map. There is no separate config needed — the suite simply lacks a script entry and is absent
from the gate and CI workflow.

## Goals

1. Add a `test:unit` script: `vitest run tests/unit`.
2. Include `test:unit` in `verify:foundation` (runs before the DB-dependent `test:integration`).
3. Confirm the suite runs clean at baseline (it currently does — `chat-types.test.ts` verified
   passing in ~0.4 s with no DB required).
4. The gate must fail on a deliberately broken unit test (no "silent pass" regression).

## Non-Goals

- Moving or reorganising existing unit-test files.
- Adding new unit tests (coverage improvement is a separate concern).
- Splitting the CI job into parallel unit/integration steps (a single sequential job is fine for now;
  the unit suite is fast, <10 s expected).
- Running `tests/slow/` inside `verify:foundation` (slow tests stay explicitly opt-in).

## Resolved Decisions

| # | Decision | Choice | Why |
| - | -------- | ------ | --- |
| 1 | Vitest config | Reuse root `vitest.config.ts` | The existing `include` glob + alias map already resolves `tests/unit`. No second config needed. |
| 2 | Gate placement | Prepend `pnpm test:unit &&` **before** `pnpm db:migrate` in `verify:foundation` | Unit tests need no DB; failing fast before any DB work is cheaper and clearer. |
| 3 | CI placement | No separate CI step needed | `verify:foundation` is already the single CI step. Extending the script string is sufficient. |

## Open Decisions — NEED BEN

**(A) Gate position: before or after `typecheck`?**
Fork: run `test:unit` before `pnpm typecheck` (fail even faster on a logic error) vs. after
(current typecheck-first order is lint → format:check → check:file-size → typecheck → ...).
**Recommendation: after `typecheck`, before `db:migrate`.** Unit tests depend on compiled types
resolving; running before typecheck can produce confusing import errors rather than a clean test
failure. The added latency is negligible (~5–10 s for typecheck on a fast machine).

## Approach

**`package.json` (root)** — two changes, one file, one collision:

```json
// add to "scripts":
"test:unit": "vitest run tests/unit",

// update verify:foundation:
"verify:foundation": "pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck && pnpm test:unit && pnpm db:migrate && pnpm test:integration"
```

**`.github/workflows/ci.yml`** — no change required. The `Verify foundation` step already runs
`pnpm verify:foundation`; the updated script string carries `test:unit` through automatically.

**Validation step for the PR:** temporarily introduce a failing assertion in any unit test file,
run `pnpm verify:foundation`, confirm it exits non-zero, then revert. This is the "deliberately-
failing unit test must fail the gate" check from the issue.

## Collision notes

`package.json` + `pnpm-lock.yaml` are shared with:
- **#58** (adds `pnpm.onlyBuiltDependencies` field — no script change)
- **#53** (adds `@fastify/rate-limit` dependency)

Per the wave plan: **#51 lands first** (Wave A first-mover owns `package.json`). #58 rebases on
#51 (Wave B). #53 rebases on both. The lockfile will have a conflict in every rebase — resolve by
regenerating with `pnpm install --frozen-lockfile` after the package.json merge is clean.

The `verify:foundation` script string itself is touched only by #51 in this batch.

## Exit Criteria

1. `pnpm test:unit` is a valid script in root `package.json`; `pnpm test:unit` runs all 14 files
   in `tests/unit/` and exits 0 with no DB running.
2. `pnpm verify:foundation` includes `test:unit` and fails when any unit test fails.
3. A PR that introduces a deliberately-failing assertion in one unit file is rejected by
   `pnpm verify:foundation` (verified manually or in CI) before the assertion is reverted.
4. CI `verify` job stays green on the main branch after the change.
5. `pnpm verify:foundation` green overall: lint, format:check, check:file-size, typecheck,
   test:unit, db:migrate, test:integration all pass.

## Hard Invariants honored

- No file >1000 lines — `package.json` and `ci.yml` changes are single-line additions.
- No new modules, no DB schema changes, no migrations.
- `verify:foundation` remains the canonical gate; CI remains a single `pnpm verify:foundation` call.
