# Relay — #989 Sports settings dogfood hardening

**Worktree:** `~/Jarv1s/.claude/worktrees/ux-989-sports-settings-build` (already checked out — do NOT re-clone)
**Branch:** `ux/989-sports-settings-build`
**Spec:** `docs/superpowers/specs/2026-07-12-sports-settings-dogfood-hardening.md`
**Plan:** `docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md` (committed `84d3f973`)
**Build skill:** `coordinated-build` (this repo's `.claude/skills/coordinated-build/SKILL.md`)
**Supervising coordinator:** label `UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Merge authority (never yours):** label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f`

## Status: PLAN APPROVED — no fork. Ready to build Task 1.

The coordinator's own words (received live): "[PLAN APPROVED]
docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md is approved as summarized.
No fork. Execute only the six tasks within settings/index.tsx, settings/sports-2.css, the focused
unit test, and the new pane-owned E2E spec. Preserve #855 competition-scoped rows, #903 service
ownership, and the Settings-shell exclusion. Complete the 70% relay now; carry this approval into
the continuation and report the successor label/session before it edits code."

**No code written yet. No task commits yet.** This relay carries zero in-flight code state —
purely a context-exhaustion relay after planning, not mid-build.

## What's done

- Read handoff doc, spec (full, it's short), plan skill conventions.
- Verified every spec premise against the live branch — no drift (empty-search still floods
  every league, team buttons have no state text, whole-league buttons split lbl/state,
  pending/error are pane-wide, no `tests/e2e/sports-settings.spec.ts` exists). Safe to build as
  planned, no re-scope needed.
- Wrote and committed the full 6-task implementation plan (commit `84d3f973`).
- Sent the plan to `UX Coordinator` via `herdr-pane-message`; received `[PLAN APPROVED]` (quoted
  above) back mid-turn, no fork flagged.

## What's next — resume here

1. Do **not** re-run `pnpm install` — `node_modules` already present in this worktree.
2. **First message the coordinator** (`UX Coordinator`, session `019f5a2e-03fd-71c3-95ab-1934cb1de973`
   — re-resolve the pane fresh via `herdr pane list`, confirm exactly one match) reporting your own
   new pane label + `agent_session.value`, so it can track who's driving. Keep it one line, caveman.
3. Execute the plan **task-by-task** via `superpowers:test-driven-development`, starting at **Task 1**
   (`followControlState` helper + aria-pressed team/league button rewrite) in
   `docs/superpowers/plans/2026-07-12-sports-settings-dogfood-hardening.md`. Read the plan **by
   task**, not front-to-back, as you reach each one.
4. Commit green per task (`Co-Authored-By: Claude` trailer), staging only that task's own files —
   never `git add -A`.
5. Run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`) before any push.
6. Stay strictly inside the 4 spec-locked paths: `packages/sports/src/settings/index.tsx`,
   `packages/sports/src/settings/sports-2.css`, `tests/unit/settings-sports-pane.test.tsx`,
   `tests/e2e/sports-settings.spec.ts`. No routes/service/repository/shared-contract/SQL/provider
   edits. No Settings shell files. Never edit `docs/coordination/`.
7. Preserve #855 (competition-scoped follow rows stay independently visible/removable, no
   name-based dedupe at the picker) and #903 (deterministic primary-follow selection stays
   service/repository-owned — don't duplicate it here).
8. On completion of all 6 tasks and the exit-criteria walkthrough (plan Task 6): invoke
   `coordinated-wrap-up` — clean tree, full gate, push, open PR, report PR + evidence to the
   coordinator. Do not merge, touch the board, or run repo-wide formatting.
9. Relay again yourself on the next 70% context-meter warning or compaction summary — this repo's
   relay/coordinated-build skills apply unchanged to you.

## Key facts worth re-stating (don't re-derive from scratch)

- `sportsQueryKeys` lives at `packages/sports/src/web/query-keys.ts` (note: `.ts`, not `.js`) —
  reuse unchanged (`teamSearch`, `leagueTeams`, `catalog`, `follows`).
- `packages/settings-ui/src/index.tsx` exports `PaneHead`, `Note`, `Group`, `Row`, `Field`,
  `Choice`, `Switch`, `Segmented`, `Badge`, etc. — **no Disclosure/Accordion primitive exists**;
  the plan's Task 3 hand-builds the browse-toggle with a native `<button aria-expanded>`.
  Don't go looking for a shared one.
- `sports-2.css` exists (vs. one `sports.css`) purely because of the repo's 1000-line
  `check:file-size` gate — keep both files under that cap; split further if a task pushes over.
- `--font-mono` was retired app-wide in favor of `--font-sans` for eyebrow-style text (per an
  existing code comment, 2026-07-08) — don't reintroduce it.
- `tests/e2e/mock-sports-api.ts` mocks the Sports **overview/broadsheet** page only
  (`/api/sports/overview` + `/api/me/modules`) — it does NOT mock catalog/follows/search/
  leagueTeams, confirming the plan's Task 5 correctly writes its own local, stateful mock rather
  than reusing that file.
- Settings deep link the e2e spec targets: `/settings?section=modules&module=sports`. If that
  doesn't resolve to the Sports pane heading when you actually run it, the shell's query-param
  contract may have shifted under #986 (owned by a parallel session, label `UX 986 Settings
  Shell`) — read (don't edit) the current shell routing to find the real contract and fix only
  the e2e test's navigation helper, per plan Task 5 Step 3. Do not edit shell files regardless.

## Coordinator/session bookkeeping

- Your predecessor's session id (now spent, safe to reap once you confirm driving): 
  `888f3c71-6996-49e1-9dbe-921e829abe55`, Herdr label `UX 989 Sports Settings`.
- Re-resolve your own pane fresh via `herdr pane list` before reporting your label/session to the
  coordinator — do not assume the label carried over automatically.
