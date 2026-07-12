# Relay — News Slice 2 (safe discovery & compilation)

Successor: you continue this lane. Pointer doc only — read the linked files, not history.

## Identity / rooting

- **Task issue:** #958 (Part of epic #954). PR must say `Closes #958`.
- **Branch/worktree:** `feat/news-slice2` in `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/news-slice2` (this one). Rooted at `origin/main` = `fadef5d3`.
- **Model:** Fable (`claude-fable-5`) — Ben's directive in the build handoff OVERRIDES the
  Sonnet cost default for this lane. Relay further successors with `--model claude-fable-5`.
- **Coordinator:** label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f`
  (resolve pane fresh by label each time; verify session id). Risk tier: SECURITY.
- **Build handoff (read in full, short):** `docs/coordination/2026-07-11-news-slice2-build-handoff.md`
  — never commit/edit it or anything in `docs/coordination/`.

## State: at the plan-approval gate — NO CODE YET

- Plan (the deliverable so far): `docs/superpowers/plans/2026-07-11-news-s2-safe-discovery.md`,
  16 TDD tasks. Commits `0d714ad5` (plan, Codex blockers B1–B7 folded) + `fa6def51` (B8 folded).
- Codex pEP review blockers B1–B8 are ALL folded into the plan (see plan "Self-Review" section
  for the one-line map of what each was and which task carries it).
- `[PLAN-READY] B1-B8` sent to Coordinator (queued in its pane). **STOP-AND-WAIT applies: write
  NO feature code until the Coordinator approves the plan.** If it comes back with more blockers,
  fix the plan, commit (explicit path, prettier --write first), re-send [PLAN-READY].

## On approval: build

- Execute the plan task-by-task via `coordinated-build` step 2 (`superpowers:test-driven-development`).
  Read plan sections per current task only; read the spec
  (`docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`) BY SECTION only.
- Start at Task 1 (web-research rate limiter). Each task commits green, `git add` explicit paths.
- Key invariants already verified on this branch (don't re-derive): 0159 policies are
  app-runtime-only; 0151 news_prefs is app-only (worker grants go in NEW migration 0160,
  `packages/news/sql/`, catalog test append); reuse `packages/web-research/src/reader.ts` +
  `url-safety.ts` (resolve-then-pin exists; robots/rate-limit do NOT — T1/T2 add them); check
  v4-mapped-v6 `::ffff:127.0.0.1` in isBlockedIp (T3).
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` + fetch/rebase.
- Relay at context-meter 70% warning (write successor doc like this one; spawn `--model claude-fable-5`).
- Finish: `coordinated-wrap-up` (PR `Closes #958`, report to Coordinator). Never merge/board.
