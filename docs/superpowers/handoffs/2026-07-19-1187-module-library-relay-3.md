# Relay — #1187 module library (build lane), relay 3 (2026-07-19, context 70%)

**Spec:** `docs/superpowers/specs/2026-07-19-1187-module-inventory-feedback.md`
**Plan:** `docs/superpowers/plans/2026-07-19-1187-module-library.md`
**Worktree/branch:** this worktree, `feedback/1187-module-library`.
**Coordinator:** label `Coordinator` — **re-resolve fresh by label + `agent_session.value`** via
`herdr pane list` at message time; a NEW coordinator adopted the run this relay (do not trust any
session id written in this doc's history, including this line).
**Tier:** security.

Read plan/spec BY SECTION for the current task only, never front-to-back.

## Run overrides still in force

- **Wrap-up override (this run only):** after the full verification gate, stop at a compact
  verification report to the Coordinator. Do **NOT** push, open a PR, merge, or touch the project
  board — the Coordinator integrates this branch itself for #1178 visual QA and cuts a clean
  main-based PR later.

## HEAD: `39cd8319` — working tree clean except hook-managed `.claude/context-meter.log`

All committed:
- `6ed3d788` + `64db5e61` (Task 1): `libraryAction`, `describeCapabilityConsequences`,
  external-modules trust-warning fix.
- `dec8f95c` (Task 2): merged built-in + registry modules into one "Module library" group.
- `167d6542` (Task 4): e2e copy assertion update.
- `14b98a1c`: pre-existing prettier drift fix (whitespace only, 3 files not owned by this diff).
- `36d3456a`, `2269bbe1`: prior relay docs (relay 1→2).
- **`39cd8319` (this segment, NEW):** fixed pre-existing NodeNext typecheck drift — missing `.js`
  extensions + implicit-any params — in TWO files: `settings-module-registry-section.tsx` (as
  flagged by relay-2) **and** `module-credentials-section.tsx` (NOT flagged by relay-2; only
  surfaced once the first file's imports resolved and tsc reached it transitively). Both
  pre-existing since before Task 1, unrelated to #1187 scope.

## Full verification gate — status

Run in order per relay-2's plan, all against **isolated gate DBs** (`jarv1s_gate_1187*` on the
`jarv1s-postgres` container, port 55433 — created via `docker exec jarv1s-postgres psql -U
postgres`, migrated via `JARVIS_PGDATABASE=<name> pnpm db:migrate`, **dropped after use**). Never
touched the shared default `jarv1s` DB — see [[verify-foundation-fresh-gate-db]] in agentmemory,
but that memory assumes a `jarv1s_gate_X` isolation convention that ISN'T actually wired into this
worktree's env (no `JARVIS_PGDATABASE` was set) — future gate runs here need the same manual
isolation step, not a bare `pnpm verify:foundation`.

- ✅ `pnpm format:check` — green.
- ✅ `pnpm lint` — green.
- ✅ `pnpm typecheck` — green (after `39cd8319`).
- ✅ `pnpm test:unit` — 460 files / 3810 passed, 2 skipped.
- ✅ `pnpm test:uat-seed` — 12 files / 23 passed (on fresh gate DB).
- ✅ 2 targeted e2e specs (`tests/e2e/settings-modules.spec.ts` + `tests/e2e/external-modules.spec.ts`)
  — 3/3 passed, default port 4173 was free this run (no scratch config needed).
- ❌ `pnpm test:integration` — 161/162 files, 1733/1737 tests pass. **2 FAILING**, both in
  `tests/integration/onboarding-provider-install.test.ts`:
  - `corrects a STALE 'installing' row on the status load (§A.4.2) from a fresh probe`
  - `leaves a stale 'installing' row UNCHANGED when the probe is untrusted (transient)`

## The one open blocker

**Confirmed pre-existing + unrelated to #1187, NOT fixed:**
- Reproduced identically on a **solo fresh-migrated isolated DB** (single-file run, no other test
  pollution) — deterministic, not a "tuple concurrently updated" flake.
- File's git history on this branch shows only `95b61381` and `2d3f7d21`, both pre-#1187 — this
  branch never touched it.
- `git merge-base HEAD origin/main == origin/main` — this branch is origin/main + #1187 commits
  only, so the bug is present on the **current main baseline**, not introduced here.
- Touches provider-install lifecycle-state reconciliation — on this lane's explicit no-touch list
  (guardrails below). Escalated instead of fixing.

**Escalated to Coordinator twice** (old coordinator session, then the new one that adopted the run
mid-relay) with the compact status above. **No reply received yet as of this relay** — the
successor's first job is to check for a reply (`herdr pane read <Coordinator pane> --source recent
--lines 30`) and act on it:
- If Coordinator says proceed → run `coordinated-wrap-up`, noting this failure in the report as a
  known pre-existing gate red (not introduced by #1187), do NOT push/PR/merge per the run override
  above (Coordinator integrates this branch itself).
- If Coordinator says hold → wait / relay further per normal triggers.
- If no reply within a reasonable wait, re-ping once (busy agents queue — check
  `Press up to edit queued messages` before assuming non-delivery) rather than guessing.

## Guardrails (unchanged)

No edits to `settings-page.tsx`, routes, schema, auth/RLS, hash/integrity, worker, or lifecycle
state derivation (this includes the failing onboarding-provider-install seam — do not fix it here).
If any of those turn out necessary, stop and escalate to the Coordinator (label `Coordinator`,
re-resolve pane fresh) before touching them.

## Key design judgment already made (flag if reconsidering)

Decision-4 capability translation: no hardcoded permission-id→phrase table (vocabulary is
open/module-extensible). Lead the confirm-dialog description with a consequence sentence built
from structured DTO fields, keep raw permission ids as a secondary detail line.

## Coordination notes

- Never `git add -A` — explicit paths only, shared host discipline.
- `.claude/context-meter.log` shows modified in `git status` — hook-managed, not yours to
  stage/commit; ignore it.
- Another worktree (`feedback-1188-connector-onboarding`) runs its own vite dev server on port
  4173 sometimes — check `ss -ltnp | grep 4173` before assuming it's free; dodge with a scratch
  Playwright config on a different port if occupied, never kill a foreign process.
- If you need to re-run any DB-touching gate step, isolate via a throwaway `JARVIS_PGDATABASE`
  (create with `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE <name>;"`, drop
  when done) — do not run bare against the shared default `jarv1s` DB.
