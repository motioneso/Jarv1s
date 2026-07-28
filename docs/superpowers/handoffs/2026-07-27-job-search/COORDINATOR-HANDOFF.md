# Coordinator handoff — epic #1280 job search

Pointer document. Read the linked sources; nothing is copied here.

- **Branch** `feat/job-search`, worktree `~/Jarv1s/.claude/worktrees/job-search`. Never pushed.
- **Rulings** — `rulings-ledger.md` in this directory, authority through **N43**.
- **State** — `COORDINATOR-STATE.md` in this directory (gate, file locks, agent table).
- **Parked for Ben** — `~/Jarv1s/docs/coordination/AWAITING-BEN.md`.

## The one blocker that matters

**`test:integration` is RED at `dc635e1c`** — exit 1, 3 files / 4 tests. Log at
`scratchpad/test-integration.log`. The known pre-existing `run-uat.test.ts` red is **not** among
them. All four trace to migration `sql/0008_create_job_search_custom_sources.sql` (Task 24, #1309).
Full breakdown in task **#63** and in agentmemory (`memory_recall "module migration seedOwnedRow"`).

Assigned to `dedupe`. The first question is **not** a code read: confirm by live query that
`app.job_search_custom_sources` has both `relrowsecurity` and `relforcerowsecurity`.

**Do not verify module-table RLS by grepping the migration.** No job-search migration declares RLS —
all eight have zero `ENABLE ROW LEVEL SECURITY`, zero `CREATE POLICY`, zero `GRANT`. The installer
applies it generically. Grepping produces a false alarm; I raised one.

Two of the four failures are the cross-owner-isolation and admin-sees-nothing tests dying in
`seedOwnedRow`. That means the new table is currently **outside** RLS coverage. Teaching the seed
helper is the point of the fix, not a side effect.

`db:migrate` and `test:uat-seed` are confirmed exit 0 on a fresh DROP+CREATE'd gate DB. The eight
non-DB gate links are green; `typecheck` re-verified at `bacfdc66`.

## Live work

| Agent          | Owns                                     | State                                          |
| -------------- | ---------------------------------------- | ---------------------------------------------- |
| `dedupe`       | the gate, Postgres slot                  | **on #63** — the blocker                       |
| `score`        | `matches.ts`, `board.tsx`, manifest      | cleared for phase 2; must land the N43 hoist   |
| `criteria`     | `root.tsx` (taken)                       | #1331 one line from done                       |
| `chat-surface` | `discuss.tsx`                            | #1304, second half unwritten                   |
| `scaffold`     | Tier B tests 6, 8, 9, hash gate, 11      | **0 of 5 written; no count ever returned**     |
| `records`      | `tests/uat/specs/job-search-*`            | 12 UAT phases; spec file was deleted off disk  |

**`score` owes a phase-2 commit** that hoists the matches limit into one `domain/` constant at **25**
(N43, task #62). Three sites drifted, not two — manifest `maximum`, handler `MATCHES_LIST_MAX_LIMIT`,
board `MATCHES_LIMIT`. `a999a081` moved two to 15 and left the board at 40, which threw on every
board load; the manifest rejects it before the handler even runs.

**`records`** — `tests/uat/specs/job-search-board.uat.spec.ts` is gone from disk and was never
committed. Asked whether that was a deliberate delete; unanswered. Nothing recoverable from git.

## Method that produced every real finding

Read the diffs, never the reports. `git show --stat <sha>` on **every** commit as it lands — that
caught three accidental index sweeps and the `a999a081` board break. Read gate exit codes back from
a log file; a background command ending in `echo`/`tail` reports exit 0 over a red gate, and a Bash
tool timeout reports 143, which is not a result.

Three of `score`'s reports have misdescribed their own diff while the code was fine — including
"manifest max unchanged at 15" when their commit changed it from 40. Verify before acting.

Never `git add -A`/`.`/`-a`, never a bare `git commit` — paths go on the `commit` itself
(`git commit -m "…" -- <paths>`), because the index is shared across agents.
