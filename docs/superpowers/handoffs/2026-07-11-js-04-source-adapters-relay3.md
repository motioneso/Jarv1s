# js-04-source-adapters (#933) — relay 3 continuation

You are the relay successor in worktree
`~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/.claude/worktrees/js-04-source-adapters`,
branch `feat/js-04-source-adapters`. Plan APPROVED — build, never re-plan. Resume via the
`coordinated-build` skill.

## Read order (short, in full)

1. This doc.
2. `docs/superpowers/handoffs/2026-07-11-js-04-source-adapters-relay2.md` — binding mandates,
   run bans, fixture facts, coordinator authority. Everything there still applies.
3. Plan BY SECTION ONLY via `sed -n 'X,Yp' docs/superpowers/plans/2026-07-11-js-04-source-adapters.md`
   (untracked file with control bytes — NEVER full-read or plain-grep it).
   Line map: **Task 10: 704–728 · Task 11: 729–741 · self-review: 742–754.**

## State: Tasks 1–9 COMMITTED green

- Task 8 `fetch-board.ts` → commit `ad483875` (28/28, real `createHostPinnedFetch` driven).
- Task 9 capture handlers → commit `dac749df`: `src/worker/handlers/capture.ts`
  (sources.list + capture.paste + capture.url; file contains NO "fetch" token — source-grep test),
  registry now 17 keys, manifest 16 assistantTools, pinned tests updated
  (manifest `toHaveLength(16)` + IMPLEMENTED list; onboarding registry pin +3 keys).
  43/43 green, prettier+eslint clean.
- Trap fixed en route: `stripHtmlToText` puts ONE BLANK LINE between block elements
  (`<p>a</p><p>b</p>` → `a\n\nb`, pinned by committed Task 2 sanitize tests) — don't pin `\n`.

## Remaining work

1. **Task 10** (plan 704–728): `monitor.save` validates adapterId via `getSourceAdapter` →
   unknown returns `{status:"question"}` naming enabled adapter ids; `adapter.validateConfig`
   normalizes `query` (exact persisted shape, extra keys dropped). TDD: red in
   `tests/unit/external-module-job-search-handlers-monitor.test.ts` first (existing enable-gate
   tests need valid adapter+query fixtures). monitor.ts isolation grep must stay green.
   Commit `feat(job-search): monitor.save validates adapter + board configuration`.
2. **Task 11** (plan 729–741): full gate → scratchpad with REAL exit codes (never `| tail` alone;
   echo `EXIT=$?`): `pnpm check:external-modules`, module vitest sweep, pre-push trio.
   `pnpm test:integration -- external-module-job-search` ONLY if no other session mid-build
   (shared-PG memory trap); record command + exit either way. Spec verification checklist →
   test-name mapping recorded for the PR (list is in plan lines 733–739).
3. **Self-review** (plan 742–754), then **`coordinated-wrap-up`**: pre-push trio + fetch/rebase
   origin/main, push, PR `Closes #933` (grounded commit, compliance table for Ben's RFA
   confirmation, verification evidence), terse report to Coordinator.

## Non-negotiables (verbatim from relay2 — do not weaken)

- Never touch `docs/coordination/` beyond reading the build handoff (coordinator-only; never commit it).
- `git add` explicit paths only; never `-A`/`.`; never repo-wide format.
- Zero migrations; `monitor.run` stays JS-05 stub. No secrets anywhere.
- Fixed error messages: constraint/key only, never external content.
- Coordinator: label `Coordinator`, session authority `58a78927-385c-4b1d-8fa0-94db20255d6f` —
  verify EXACTLY ONE pane holds the label before messaging; halt if 0 or >1.
- If YOU relay, spawn successor with `--model claude-fable-5` (lane mandate, overrides the
  skill's Sonnet default).
- Relay trigger: context-meter 70% warning or any compaction summary → relay immediately with
  committed progress.
