# Build Handoff — #964 Module Distribution & Install

**Issue:** #964 (Part of epic #860, pluggable modules). **Risk tier:** `security`.
**Worktree:** this directory (`.claude/worktrees/mod-dist-964`). **Branch:** `mod-dist-964` off
`origin/main` (`9af57f81`).

## APPROVAL STATE — READ FIRST (do NOT stop at the spec header)

The spec file's header still says `Status: DRAFT — awaiting Ben + adversarial council review`.
**That gate is CLOSED. Ben explicitly WAIVED the council review on 2026-07-12 and authorized this
build.** Treat the spec as **APPROVED**. Do **NOT** stop-and-escalate at the DRAFT line in
`coordinated-build` step 1 — the spec-before-build gate is satisfied. (If the plan's *content*
contradicts the merged S1–S9 / module-registry surface on your branch, THAT is still a stop — but
the approval status is settled.)

## Source of truth — the committed plan (read task-by-task, never whole)

- **Plan:** `docs/superpowers/plans/2026-07-12-module-distribution-install.md` — **10 tasks**, ~5.4k
  lines. It is the authored, Ben-approved build order with a per-task File Map and TDD steps
  (write failing test → verify red → implement → verify green → typecheck + commit). **Read ONE task
  section at a time** — reading the whole plan bloats context toward a premature relay.
- **Spec:** `docs/superpowers/specs/2026-07-12-module-distribution-install.md` (design rationale).

### Carry these 3 intentional spec deviations (already documented in the plan — do NOT re-litigate)

1. **Install-failed state source:** `app.module_installs` is FORCE-RLS supervisor-plane (migration
   0156), unreadable by the app role. The reconcile mirrors failures into a NEW
   `app.external_modules.last_install_error` column that the admin GET reads.
2. **Dev-boot parity:** no `scripts/dev.ts` exists; parity ships as a root `db:reconcile` package
   script + docs note (Tasks 8/10).
3. **Spec JSON examples** use `jarv1s.job-search` ids; real ids are bare kebab — Task 10 fixes the
   spec examples.

## Build path (per `coordinated-build`)

1. `[ -d node_modules ] || pnpm install`.
2. `pnpm audit:preflight` and re-ground — confirm the tree is current (`9af57f81`), not behind.
3. Work the plan **task-by-task in order** (dependencies are real: registry schema → manifest
   `ownedTables` → client → reconcile → admin GET). Commit per task with the plan's gate commands.
4. **Final gate (Task 10):** `pnpm verify:foundation` + full `pnpm test:integration`, exit 0.
5. `coordinated-wrap-up` → open PR (Part of #964), report to coordinator for the security council.

## Security invariants to HOLD (verify in tests, not prose — this is a `security`-tier lane)

- **Untrusted registry input:** the registry index + downloaded package manifest are fetched over
  the network — **every field is untrusted**. Validate/allowlist before use; never eval, never
  trust declared hashes without verifying; fail-closed on hash drift / invalid package (prove it
  contributes NOTHING).
- **No admin private-data bypass / RLS holds for all actors:** no `BYPASSRLS` on runtime or worker
  roles. Admin GET reads only via the app role's RLS-visible surface (hence deviation #1's mirror
  column — do not "fix" it by reading the supervisor-plane journal from the app role).
- **Secrets never escape:** no credentials/tokens in logs, pg-boss payloads, exports, or admin
  responses. **Metadata-only job payloads.**
- **Response-schema:** every newly returned field (admin GET, etc.) declared in the shared REST
  contract (`packages/shared/src/*-api.ts`) — Fastify `additionalProperties:false` silently strips
  undeclared fields. Test via `app.inject`, not the service directly.
- **Provider-agnostic:** no hardcoded provider/model anywhere.
- **Module isolation:** modules collaborate only through declared public APIs/events.

## Migration + foundation-catalog TRAP (will bite latently if skipped)

The new `app.external_modules.last_install_error` column ships as a **NEW migration file** (module
SQL lives in the owning module's `sql/` dir, never `infra/`; never edit an applied migration —
hash-checked). `tests/integration/**/foundation*.test.ts` asserts the FULL migration list with
`toEqual` — **add the new migration's row AND run the full `test:integration`**, or a focused module
test passes while foundation breaks latently.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by **explicit path** — never `git add -A` or repo-wide
  `pnpm format`. (The main tree has another session; do not sweep.)
- **Never** touch `docs/coordination/` (coordinator-only — READ this handoff, do NOT `git add` it),
  the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Coordination

- **Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; verify `herdr pane list`
  shows exactly ONE `Coordinator` pane, resolved fresh (never a cached pane number).
- **Coordinator session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f` (immutable authority).
- **Relay:** on a 70% meter warning OR a compaction summary → message the coordinator, then use the
  `relay` skill. **Your successor MUST be Sonnet** (`claude --model sonnet` — this is a build/coding
  lane, not News/plan authoring). Spawn it into the agents tab, never the coordinator tab.
- **Merge gate (SECURITY tier):** coordinator owns the merge via a named council (Opus adversarial
  QA + independent lenses). Build to green + document any manual-acceptance steps; do NOT merge
  yourself. State your fail-closed/hash-drift/RLS test approach in the PR body so each lens re-runs it.

## Collision notes

- #964 touches `packages/module-registry/*`, `packages/module-sdk/*`, `external-modules/*`, the
  admin external-modules route/handler, and adds a module migration. **No parallel lane touches
  these.** News S4 (`packages/news/*`) and the #944 flake fix (`tests/integration/tasks-agency-tools`)
  are isolated — no overlap.
