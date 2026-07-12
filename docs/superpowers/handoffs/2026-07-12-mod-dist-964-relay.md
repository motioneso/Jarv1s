# Relay: #964 module distribution & install

## Where things are

- Worktree: `/home/ben/Jarv1s/.claude/worktrees/mod-dist-964`, branch `mod-dist-964`.
- Spec: `docs/superpowers/specs/2026-07-12-module-distribution-install.md` (approved, council waived by Ben — do not stop at DRAFT header).
- Plan (task-by-task source of truth): `docs/superpowers/plans/2026-07-12-module-distribution-install.md`. **Read ONE task section at a time, never the whole file.**
- Handoff contract (constraints, security invariants, deviations): `docs/coordination/handoff-mod-dist-964.md` — read in full, never edit/stage it.
- Coordinator: Herdr label `Coordinator` (session `58a78927-385c-4b1d-8fa0-94db20255d6f`) — re-resolve pane fresh by label before messaging, confirm exactly one match.
- Risk tier: **security**. You build to green; coordinator runs the adversarial security council and owns merge/board/close. Never merge yourself.

## Done (commits on this branch)

- Task 1 — registry index schema + ensure-list parsing: `b4af4976`.
- Task 2 — manifest `database.ownedTables` declaration + `sql/**` in package hash: `02dc9f5c`.
  - Fixed a real gap found during Task 2: `packages/module-registry/src/node.ts` imported
    `validateExternalModuleManifest`/`MODULE_ID_RE` from `./external/validate.js` for internal use
    but never re-exported it — the plan's test imports directly from `node.js`. Fix: added
    `export * from "./external/validate.js";` to `node.ts`. This is a real code fix already
    applied and committed, not just documented — no action needed, just be aware if Task 3+ also
    imports from `node.js`.

Both tasks: TDD red→green confirmed, typecheck clean, staged by explicit path (never `-A`), committed with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Next: Task 3 onward

Read the plan's Task 3 section only (`docs/superpowers/plans/2026-07-12-module-distribution-install.md`), then continue the same cadence through Task 10:

3. Migration 0161 + staged/purge repository state
4. Publish script + rolling-release GitHub workflow
5. Download → verify → extract → stage pipeline
6. Shared contracts, lifecycle derivation, admin registry routes
7. Boot-time module reconcile
8. Boot & compose wiring
9. Admin web UI — module registry section
10. Integration suite, docs, spec-example fix, full gates (`pnpm verify:foundation` + full `pnpm test:integration`)

After Task 10 green: `coordinated-wrap-up` → open PR (Part of #964) → report to Coordinator for the security council. Do not merge, move the board, or close issues.

## Standing constraints (from handoff/CLAUDE.md — don't re-litigate)

- Stage explicit paths only, never `git add -A` / `git add .` / repo-wide `pnpm format` (shared tree).
- Never touch `docs/coordination/`, the project board, milestones, or merge.
- No secrets in any doc/payload/log/prompt.
- Never edit an applied migration — new migration file only; module SQL lives in the owning module's `sql/`, never `infra/`.
- Never assume a migration number — coordinator assigns landing order; escalate before Task 3's migration if unsure.
- `@jarv1s/settings` must NOT import `@jarv1s/module-registry`.
- File-size gate: all source (incl. CSS) ≤1000 lines.
- Every new Fastify response field must be declared in `packages/shared/src/*-api.ts` (schema strips undeclared fields) — test via `app.inject`.
- Prove security invariants (input validation/allowlisting, hash verification fail-closed, no admin RLS bypass, metadata-only job payloads) via tests, not prose.
- 3 intentional spec deviations already blessed — don't re-litigate: (1) `app.external_modules.last_install_error` mirror column instead of reading FORCE-RLS `module_installs`; (2) dev-boot parity via root `db:reconcile` script, no `scripts/dev.ts`; (3) spec's `jarv1s.job-search`-style example ids get fixed to bare kebab in Task 10.
- Relay again on the 70% context-meter warning or immediately on seeing a compaction summary — message Coordinator first (re-resolve pane by label + session id, confirm exactly one), then use `relay` skill.

## Bootstrap for the next session

`[ -d node_modules ] || pnpm install` (should already exist — skip). Read this doc, then read Task 3's section of the plan, verify its premises against the actual branch (grep the cited files/line numbers), and continue via `coordinated-build`.
