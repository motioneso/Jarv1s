# Relay — js-05-monitoring (#934)

**You are the Fable successor for the JS-05 build.** Same worktree
(`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-05-monitoring`),
branch `feat/js-05-monitoring`, security tier, zero migrations.

## Pointers (read by section, never in full)

- Build handoff (rules, bans, coordinator routing): `docs/coordination/2026-07-11-js-05-build-handoff.md` — READ THIS FIRST, it is short.
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-05-monitoring.md` (~53 lines).
- **Plan (complete, code-in-every-step): `docs/superpowers/plans/2026-07-11-js-05-monitoring.md`** — read ONE task at a time.

## State

- DONE: spec verified current against branch; plan written and committed. NO code written, no
  other commits — tree is otherwise clean.
- **NOT DONE: Coordinator plan approval.** The predecessor messaged the Coordinator (label
  `Coordinator`, session id authority `58a78927-385c-4b1d-8fa0-94db20255d6f`) with the plan path +
  three scope flags. **Do not write code until approval arrives.** If no reply, nudge via
  `herdr-pane-message` (verify EXACTLY ONE `Coordinator` pane, resolved fresh).

## Scope flags raised (await Coordinator ruling with the approval)

1. Stale marking deferred to JS-07 (#936) — `OpportunityRecord` has no `monitorId`; JS-05 never
   marks stale (tests assert failures leave opportunities untouched).
2. `timezone`/`dueTime` defaults `UTC` / `07:00`, preserved on update when omitted.
3. Run-now jobKind `job-search.monitor-run-now`, params `{ monitorId }` (queue paramsSchema).

## After approval

Resume `coordinated-build` step 2: TDD per plan task (superpowers:test-driven-development), green
commit per task, `git add` explicit paths ONLY (parallel Codex build shares the tree). Pre-push
trio + rebase before every push. Finish with `coordinated-wrap-up` (PR `Closes #934`). Each plan
task carries verify-notes (records.ts signatures, runs-namespace prefix, HANDLERS pin tests) —
check those at the task, not up front. Relay again only past ~80% real work.
