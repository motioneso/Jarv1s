# Relay — rfa-755-people-archive-500

**Issue:** GitHub #755 — `bug(people): PATCH/archive person 500s when notes folder configured but
person has no canonical note`. Issue body IS the approved spec (Ben confirmed, 2026-07-04).
**Worktree/branch:** this worktree, branch `rfa-755-people-archive-500` (already correct, don't
switch).
**Handoff doc (coordinator):** `docs/coordination/handoffs/2026-07-04-rfa-fleet/rfa-755-people-archive-500.md`
in the coordinator's worktree (`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/...`) — not
committed there yet as of this relay; read it if you need the original framing, but this doc
supersedes it for what's left to do.
**Plan (coordinator-approved, do not need re-approval):**
`docs/superpowers/plans/2026-07-04-rfa-755-people-archive-500.md` — read it IN FULL, it has exact
code for every remaining step.
**Coordinator label:** `Coordinator` — resolve fresh via `herdr pane list` (never a cached pane
number). Session id `0f374652-df12-44cc-8592-881c421dfebb` is authority.
**Skill:** resume via `coordinated-build` (plan already approved — skip straight to step 2 Build).

## Done (committed)

- Commit `a9aaf9e5` — Task 1 of the plan, complete:
  - `packages/people/src/notes-service.ts`: added `export class CanonicalNoteNotFoundError extends
    Error`, thrown from `findCanonicalNote` (was a plain `Error`).
  - **Extra fix beyond the plan** (found during TDD, same function, same People-module scope, told
    to coordinator already — no new approval needed): `loadPeopleNotes` now catches ENOENT from
    `listVaultFilesRecursive` and treats a not-yet-created folder as zero notes, instead of letting
    the raw ENOENT propagate. This matters because a freshly-configured notes folder has no
    physical directory until the first note is written — same missing-canonical-note bug, different
    trigger path. If you write the PR description, mention both fixes.
  - `packages/people/src/__tests__/notes-service.test.ts`: new test "throws
    CanonicalNoteNotFoundError when updating a person with no canonical note" — passing.
  - Full file `npx vitest run packages/people/src/__tests__/notes-service.test.ts` → 7/7 pass.

## Not started — do next (Task 2 + Task 3 of the plan)

**Task 2** (plan doc has exact code — copy it, don't re-derive):
- `packages/people/src/routes.ts`: import `CanonicalNoteNotFoundError` from `./notes-service.js`;
  wrap the vault-path branch in both the PATCH handler (`/api/people/:id`) and the archive handler
  (`/api/people/:id/archive`) in try/catch — on `instanceof CanonicalNoteNotFoundError`, fall
  through to the existing `repo.updatePerson`/`repo.archivePerson` DB-only path (same as the
  no-folder-configured `else` branch already does). Re-throw anything else.
- `packages/people/src/__tests__/routes.test.ts`: add the route-level regression test from the plan
  (configure folder, create person via `repo.upsertPerson` directly with no note, PATCH + archive
  via HTTP, expect 200 not 500, assert DB state updated).
- TDD: write test red → implement → green → commit.

**Task 3** (verification, no code):
- `pnpm --filter @jarv1s/people test` — NOTE: this filter form doesn't work from this repo (vitest
  config lives at repo root, package-level `pnpm --filter` cwd breaks its include globs — hit this
  live). Use `npx vitest run packages/people/src/__tests__` from repo root instead.
- `pnpm format:check && pnpm lint && pnpm typecheck`
- Then `coordinated-wrap-up`: pre-push trio + `git fetch origin main && git rebase origin/main`,
  push, open PR, report PR + evidence to coordinator. Coordinator owns merge/board/close — you stop
  after the PR + report.

## Run-specific bans (from original handoff, still apply)

- Work only in this worktree/branch. `git add` by explicit path, never `-A`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc/payload/log/prompt.
- Stay inside the People module's own files (no #756/#758 overlap expected — see original handoff
  doc for collision notes if a conflict surfaces).
