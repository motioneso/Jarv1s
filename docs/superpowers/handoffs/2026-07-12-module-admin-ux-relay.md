# Relay — module-management admin UX (#996, part of #860)

Worktree/branch: `/home/ben/Jarv1s/.claude/worktrees/module-admin-ux`, branch `module-admin-ux`.
Coordinator label: `Coordinator` (confirm still exactly one pane with this label before
escalating — `herdr pane list`).

## State

- Spec committed: `69306768` — `docs(spec): module-management admin UX (approved)`.
- `PLAN-996.md` written at worktree root (uncommitted, per brief — do not commit it). Read it
  in full — it has the complete file-by-slice plan, the finalized `resolveModulesDir(env)`
  design, and the grounded findings (S2 needs zero resolver/route code changes, only manifest
  edits + a test).
- `BRIEF-996.md` at worktree root — original build brief, already read in full by the prior
  session, still authoritative for process/scope.
- **Step ½ (spec-vs-branch verification) is essentially done.** Two small gaps left before
  Step 1 (writing the `superpowers:writing-plans` plan doc):
  - `packages/shared/src/platform-api-modules.ts` — read the `ModuleRegistryRowDto` schema
    before touching any DTO shape in S3 (fast-json-stringify silently drops undeclared
    fields — CLAUDE.md trap).
  - That's it — `settings-module-registry-section.tsx` (257 lines) has now been read in full
    (this session); its content and S3 implications are captured in `PLAN-996.md`.

## Next steps

1. Read `packages/shared/src/platform-api-modules.ts` (grep `ModuleRegistryRowDto`).
2. Write the actual `superpowers:writing-plans` plan doc at
   `docs/superpowers/plans/2026-07-12-module-management-admin-ux.md`, using `PLAN-996.md`'s
   content as the source (bite-sized TDD tasks, exact files per task, green per commit).
3. Message the Coordinator pane via `herdr-pane-message`: "plan ready for module-admin-ux:
   <path>. Approve, or flag a fork." **STOP and wait for approval** — no code before that,
   per `coordinated-build`'s hard gate.
4. After approval: build S1→S4 via `superpowers:test-driven-development`, one task per green
   commit, generous why-comments citing `#996`/`#860`, `Co-Authored-By: Claude` trailer.
5. Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main &&
   git rebase origin/main`) before every push.
6. Full gate `pnpm verify:foundation` (spec also wants full `pnpm test:integration`) before
   wrap-up; record exit codes.
7. `coordinated-wrap-up`: PR body `Part of #996` + `Part of #860`, base `main`, short
   user-facing "What's new" line (e.g. "Admin settings now lists downloadable modules; only
   Wellness/Sports/News are toggleable; core modules are always on"). Report PR number to
   coordinator. Never merge/close/board — coordinator's job.

## Constraints (unchanged, see BRIEF-996.md for full text)

- Never touch `packages/ai/**`, `packages/chat/**`, `packages/module-registry/src/index.ts`,
  AI-admin settings surfaces (Codex-869's lane, concurrent build).
- No DB migration for S2 (confirmed unnecessary via grounding, see PLAN-996.md).
- No `git add -A`. Don't commit `PLAN-996.md`. Don't touch `docs/coordination/`. Don't run
  repo-wide `pnpm format`. Never edit an applied migration.
- S4 is repo-side only — never touch `~/JarvisProd/` or any live box.

## Why relaying now

Context-meter hit 70% mid Step ½ verification, before any implementation code was written.
Zero code changes exist yet — only the spec commit and the two plan docs. Clean handoff point.
