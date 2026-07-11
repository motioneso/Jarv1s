# Relay — JS-04 source adapters (#933)

Successor: you are the SAME lane continuing (3rd session). Model must be `claude-fable-5` (Ben's
directive for this run). Resume via `coordinated-build`; plan is APPROVED — do NOT re-plan, do NOT
re-ask.

## Pointers (read by section, never in full)

- **Plan (approved, execute as written):** `docs/superpowers/plans/2026-07-11-js-04-source-adapters.md`
  — 11 TDD tasks with complete code. UNTRACKED on purpose (contains literal control bytes — use
  `grep -a` and `sed -n 'X,Yp'`, never plain grep/file). Read ONE task at a time. Line map:
  Task 6 (Ashby): 504–582 · Task 7 (registry): 583–612 · Task 8 (fetch-board + SSRF): 613–658 ·
  Task 9 (capture tools): 659–703 · Task 10 (monitor.save): 704–728 · Task 11 (full gate): 729–741 ·
  Self-review notes: 742–754.
- **Build handoff (rules/bans):** `docs/coordination/2026-07-11-js-04-build-handoff.md` — untracked,
  coordinator-only file: READ it, NEVER commit it.
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-04-source-adapters.md` (already verified
  current against branch — skip re-verification).
- Branch `feat/js-04-source-adapters` in THIS worktree, rooted at origin/main `aaa0888f`.

## Coordinator

Label `Coordinator` (verify EXACTLY ONE pane, fresh `herdr pane list`), session id authority
`58a78927-385c-4b1d-8fa0-94db20255d6f`. Plan approved 2026-07-11 with all 3 forks confirmed
(monitor.save query → normalized board config; +3 tools = 17 total; courtesy 60 min). Tag
escalations [SECURITY]/[SSRF]/[DESIGN-FORK].

**Approval corrections/mandates (apply during build):**

1. Compliance metadata must NOT attribute review to Ben → `reviewedBy: "coordinator/automated"` in
   `AdapterCompliance`. DONE in types.ts + greenhouse + lever (+ tests). Still to apply: ashby
   adapter (Task 6) and expose `reviewedBy` in `SourceAdapterInfo` / sources.list output + tests
   (Task 9).
2. NON-NEGOTIABLE: Task 8 adversarial SSRF tests drive the REAL `createHostPinnedFetch` from
   `@jarv1s/host-fetch` with injected resolve/request fakes — not a mock of it.
3. Zero migrations; `monitor.run` stays JS-05 stub.

## State

- **Done + committed (all tests green at each commit):**
  - Task 1 fixtures `5c30a449` (`tests/fixtures/job-search/` + README).
  - Task 2 sanitizer `fceeb1b1` (`src/adapters/sanitize.ts` + 15 tests).
  - Task 3 types + board config `d7d0e9ee` (`types.ts`, `board-config.ts`, wrap.ts error chain,
    13 config tests).
  - Task 4 greenhouse `0e907c16` (`greenhouse.ts`, 7 normalize tests; `truncateUtf8` exported from
    domain barrel).
  - Task 5 lever `3c104f4f` (`lever.ts`, 6 lever tests; shared `record`/`httpsUrl` moved to
    `board-config.ts` exports, greenhouse imports them).
  - Suite check: 41 tests green across the 3 adapter test files (sanitize/config/normalize).
- **Next action:** Task 6 — Ashby adapter (plan lines 504–582): red tests extend
  `tests/unit/external-module-job-search-adapters-normalize.test.ts`, then
  `src/adapters/ashby.ts`; remember mandate 1 (`reviewedBy: "coordinator/automated"`). Then Tasks
  7–11 in order, commit per task.

## Known plan warts (fix while implementing, already agreed)

- Control-char regexes: ALWAYS author as `\u`-escape form, e.g.
  `/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g` with `// eslint-disable-next-line no-control-regex`.
  The Write tool once emitted literal control bytes for this — if a file reads as "binary", fix via
  `perl -i -pe` on that line.
- Plan Task 6 note: reuse shared `record`/`httpsUrl`/`mapWorkMode`/`parseIsoTimestamp` from
  `./board-config.js` (already exported) — do NOT re-declare local copies.
- Never mask gate exit codes with `| tail` — redirect to scratchpad file and `echo "EXIT=$?"`.

## Run bans (unchanged)

- `git add` explicit paths only; never `-A`/`.`; never repo-wide format.
- Commits: conventional + user-facing summary line + trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Pre-push trio before EVERY push: `pnpm format:check && pnpm lint && pnpm typecheck` + fetch/rebase
  origin/main. Full gate at wrap-up (`coordinated-wrap-up`, PR `Closes #933`).
- Prettier the fixture/docs you author before committing (format:check covers md).
- Shared-PG caution: skip `test:integration` if another session is mid-build; record command+exit.

## Fixture facts (save a probe)

Ashby jobs[0] (Task 6 assertions): id `03e2d4e1-73ad-4f09-a058-2eb9ce34c2bc`, jobUrl
`https://jobs.ashbyhq.com/ramp/<id>`, isListed `true`, isRemote `true`, publishedAt
`2026-07-07T20:47:09.753+00:00`, location `Remote (US)`, secondary `[San Francisco, CA; New York,
NY (HQ)]`, employmentType `FullTime`, compensation tier summary
`$151K – $231K • Offers Equity • Multiple Ranges`. Fixture has 3 jobs. Use `jq` on
`tests/fixtures/job-search/ashby-job-board.json` for anything else.

## Context discipline

Fresh budget: BUILD. Commit per task. Relay only past ~80% meter with real progress — reading is
not progress. Message-the-Coordinator "relayed, safe to reap" flow is already done for THIS
predecessor — you only report at wrap-up or on blockers.
