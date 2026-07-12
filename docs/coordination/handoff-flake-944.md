# Build Handoff — #944 Flaky test fix (tasks-agency-tools)

**Issue:** #944 (bug). **Risk tier:** `routine` (test-only timing fix; no product code, no
migration, no contract change). **Worktree:** this directory (`.claude/worktrees/flake-944`).
**Branch:** `flake-944` off `origin/main` (`9af57f81`).

## Problem (root-caused in #944)

`tests/integration/tasks-agency-tools.test.ts` → `Tasks agency tools through AssistantToolGateway`
→ **"requires confirmation for destructive task tag deletion"** intermittently fails under
full-suite CI load with:

```
AssertionError: expected undefined to match object { kind: 'action_request', …(1) }
```

Root cause per #944: a `setTimeout(50)` race — the assertion runs before the confirm-gated
`action_request` has materialized when the box is under full-suite load. It passed in the 5 main
runs before `9af57f81` and fails intermittently; **it is a flake, not a real regression.**

## Fix scope (tight — do NOT expand)

- Replace the fixed `setTimeout(50)` race with a **deterministic wait** (`vi.waitFor(...)` or an
  explicit await on the gateway producing the `action_request`) so the assertion only runs once the
  confirmation exists. Keep the test's intent identical — it must still prove destructive tag
  deletion is confirm-gated (undefined immediate result → action_request materializes).
- Do **not** weaken the assertion, do not add sleeps, do not touch product code, do not touch any
  other test. If the fix appears to need a product change, STOP and escalate — that means it is not
  the flake.

## Gate

- Run the specific suite repeatedly to prove stability, then the surrounding integration gate:
  `pnpm test:integration` (or the tasks module's integration suite) — exit 0, and re-run the single
  file several times to confirm it no longer flakes.
- `coordinated-wrap-up` → PR (Fixes #944), report to coordinator.

## Run-specific bans

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` / repo-wide
  `pnpm format`. Never touch `docs/coordination/` (READ this handoff; do not `git add` it), the
  board, milestones, or merge.

## Coordination

- **Coordinator label:** `Coordinator`; **session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f`.
- Relay on 70% meter / compaction; successor MUST be **Sonnet**, spawned into the agents tab.
- Coordinator merges after QA green (routine — auto-merge after green greens `main`).
