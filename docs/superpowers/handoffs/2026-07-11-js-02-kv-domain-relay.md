# Relay — JS-02 owner-scoped KV domain (#931)

Successor: you continue this build in THIS worktree/branch. You are **Fable**
(`claude-fable-5`); any further relay successor must also be spawned `--model claude-fable-5`
(scoped exception to the Sonnet rule — see the mission handoff).

## Pointers (read these, in this order)

1. `docs/coordination/2026-07-11-js-02-kv-domain-handoff.md` — mission, bans, coordinator
   protocol. UNTRACKED — never commit it.
2. `docs/superpowers/plans/2026-07-11-js-02-kv-domain.md` — THE PLAN (committed `30d131ce`).
   Complete: constraints, interfaces, behavior rules, 12 TDD tasks. Execute it task-by-task via
   superpowers:test-driven-development once approved. Read spec sections only if a task is unclear.
3. Spec: `docs/superpowers/specs/2026-07-10-job-search-js-02-kv-domain.md` (by section only).

## State

- Branch `feat/js-02-kv-domain` @ `30d131ce` (plan commit on top of origin/main `6b37bc01`).
  No code written yet. Spec-vs-branch verification DONE (result recorded in the plan).
- Coordinator (label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f`) was messaged
  2026-07-11: plan ready + purge-descope fork + namespace-drift note.
- **GATE: do NOT write code until the coordinator approves the plan** (it may also rule on the
  purge fork — plan Task 12/PR notes assume descope unless it says otherwise). If no reply is in
  your pane input/queue, poll your own pane context; if silent, wait — don't build.

## Implementation notes not in the plan doc

- Root `tsconfig.json` includes `tests/**` but not `external-modules/**`; the unit-test helper
  imports domain files relatively, which pulls them into root `tsc` too. Write ALL domain-internal
  imports with explicit `.js` extensions so both NodeNext (root) and bundler (module tsconfig,
  `pnpm check:external-modules`) resolve them.
- Memory fake mirrors the DB 65,536-byte check; domain cap is 65,535 and must fire first.
- Integration suite parses the REAL `external-modules/job-search/jarvis.module.json` for the
  handler's manifest (no hand-copied storage declarations).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add` explicit
  paths only. Prettier-write any new md before committing.

## Next concrete steps

1. Check for coordinator approval (your pane / queued messages).
2. On approval: plan Task 1 (foundations) → … → Task 11 (isolation integration) → Task 12
   (verify:foundation, pre-push trio + rebase, `coordinated-wrap-up`).
3. Wrap-up notes must mention: purge descope (+ follow-up issue if coordinator wants it filed),
   and that no shared JS-01 files were touched (expected — domain is new files; worker stubs stay).
