# Coordinator state — epic #1280 job search

Pointer document. Everything here is a location, not a copy. Read the linked source, not this file,
for detail.

- **Branch** `feat/job-search`, worktree `~/Jarv1s/.claude/worktrees/job-search`.
- **Rulings** — `rulings-ledger.md` in this directory is the authority, through **N40**.
- **Task list** — GitHub epic #1280 and its children.

## Gate

Eight non-DB links verified exit 0: `lint`, `format:check`, `check:file-size`,
`check:design-tokens`, `check:no-ambient-dates`, `check:package-deps`, `typecheck`, `build:app-map`.

`test:unit` at 3729/3732. The one failure is in-flight shape drift, not a HEAD regression — score's
uncommitted `url` key against the exact-keys assertion at `tests/unit/job-search-match-handler.test.ts:176`.

**The DB tail has never run on this branch.** `db:migrate`, `test:uat-seed`, `test:integration` are
all outstanding. dedupe holds the exclusive Postgres slot; everyone else is told to hold. Fresh
exported gate DB, DROP+CREATE, per N26.

Known pre-existing red, **not ours**: `tests/uat/run-uat.test.ts` fails identically on `main`
(an extra `withoutNewsJsonBinding` field) — settled in a scratch worktree at `9df9ba3e`.

## Agent assignments and the file locks between them

Six build agents. The locks matter more than the assignments — three of them want the same two files.

| Agent          | Work                                             | Lock                                     |
| -------------- | ------------------------------------------------ | ---------------------------------------- |
| `chat-surface` | #1304 `discuss.tsx` + 8 cases, board gap 15 → 17 | **owns `board.tsx` and `root.tsx` now**  |
| `score`        | #1329 / #1330, then N39's row-shape change       | **queued behind chat-surface** for board |
| `criteria`     | #1331 onboarding Surface                         | **queued** for `root.tsx`                |
| `records`      | #1306 UAT spec, 12 phases                        | owns `tests/uat/specs/job-search-*`      |
| `dedupe`       | #1328, then the DB tail                          | holds the Postgres slot                  |
| `scaffold`     | #1305 Tier B: tests 6, 8, 9, hash gate, 11       | no file lock; 0 written as of handoff    |

`score` must **not** land `MATCHES_LIST_MAX_LIMIT` until it can edit `board.tsx` in the same commit —
`board.tsx`'s `MATCHES_LIMIT` is the same number, and a mismatch means `InputError` on every read.

## Open issues filed this session

- **#1331** onboarding renders no assistant Surface — spec §7 wants a full-width chat interface.
- **#1332** core drawer renders empty while a module surface is active. `apps/web`, not a module.
- **#1333** board paging, split out of #1330 so a real product consequence gets a real issue.
- **#1334** the one notify-port budget-isolation case that catches a misplaced counter.

Plus the pre-existing **#1329** (unscored postings never reach the board), **#1330** (board read
path too thin) and **#57** (UAT has no functional AI provider).

## Two blockers a new coordinator will hit

**UAT scoring cannot succeed as seeded.** `packages/ai/src/structured/generate-structured.ts:84-95`
rejects any `provider_kind` outside `anthropic | openai-compatible | google`; the UAT seed's provider
is `"custom"` (`tests/uat/seed/chunks/ai.ts:25`). Model resolution succeeds first, then the kind
check fails, so `runScore()` retries once and halts with `provider_error`, `scored: 0`, in every run.
Fix is an `openai-compatible` provider pointed at the fixture server — not a reshaped phase.

**N37's tripwire is still unanswered.** #1305's test 10 was scoped out on the basis that it transfers
to #1306's UAT. Nobody has named the file and line where its assertion now lives. scaffold correctly
refuses to guess; it needs confirming against records' spec before #1305 closes.

## Standing method

Verify every agent claim independently — reading the diffs is what produced #1330, N38, N39 and
N40, in each case against a report that said the change was internal or the plan was fine. Read gate
exit codes back **from the log file**: a background command whose script ends in `echo` reports exit
0 while the gate is red, which happened this session. Never `git add -A`/`.`/`-a`, never a bare
`git commit`, never `git stash` — the tree and the stash stack are shared.
