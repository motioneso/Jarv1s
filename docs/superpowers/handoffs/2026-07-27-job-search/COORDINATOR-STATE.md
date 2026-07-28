# Coordinator state — epic #1280 job search

Pointer document. Everything here is a location, not a copy. Read the linked source, not this file,
for detail.

- **Branch** `feat/job-search`, worktree `~/Jarv1s/.claude/worktrees/job-search`.
- **Rulings** — `rulings-ledger.md` in this directory is the authority, through **N45**.
- **Task list** — GitHub epic #1280 and its children.

## Untracked work has been lost twice today — commit before you run

`tests/integration/job-search-rls.test.ts`, 291 lines, untracked, is **gone**: not on disk, no git
history, no stash entry, no dangling blob, no copy under the scratchpad. Unrecoverable, and nobody
has yet claimed authorship. A UAT spec file was lost the same way earlier the same day.

The open question it leaves behind is real and is now task **#72**: whether the other seven
`JOB_SEARCH_TABLES` have any per-table cross-owner/admin denial coverage, or whether generic
`installModule` RLS has been assumed without a test that proves it table by table.

**Rule: a new test file gets committed the moment it typechecks, before any run.** `git commit <path>
-m "…"` with the path on the commit itself. Waiting for a green run to commit is how both losses
happened.

## Gate

Eight non-DB links verified exit 0: `lint`, `format:check`, `check:file-size`,
`check:design-tokens`, `check:no-ambient-dates`, `check:package-deps`, `typecheck`, `build:app-map`.

`test:unit` at 3729/3732. The one failure is in-flight shape drift, not a HEAD regression — score's
uncommitted `url` key against the exact-keys assertion at `tests/unit/job-search-match-handler.test.ts:176`.

**`test:integration` at `14593694`, after dedupe's three fixes: 164/165 files, 1760/1763 tests, exit
1.** Down from 3 files / 4 tests. All four original failures are fixed, including the two that put
`job_search_custom_sources` under cross-owner and admin isolation checking for the first time.

The single remaining failure is `tests/integration/notes-write-tools.test.ts > rejects empty oldText
regardless of file length`. Nothing on this branch touches the notes module — but **"not mine" is not
"pre-existing"**. It must be reproduced on `main`, in a **separate worktree** (never `git checkout
main` here; four agents hold uncommitted work), on its own fresh gate DB, with the exit code read
back from a log file. Unproven until then.

`typecheck` re-verified exit 0 with zero errors at `bacfdc66`, after a transient red where six
job-search fixture files lacked the `getMatch` mock that score's new `store-port.ts:115` requires.
Self-resolved; noted because it will recur while that interface is mid-edit.

**DB tail** on a fresh DROP+CREATE'd `jarvis_gate_dedupe_1328` per N26, each exit code read back from
its log file:

- `db:migrate` — exit 0.
- `test:uat-seed` — exit 0, 11 files / 23 tests.
- `test:integration` — was red at `dc635e1c` (3 files / 4 tests); all four now fixed. Current
  standing recorded under **Gate** above.

**No hard-invariant breach.** Confirmed by live query, not a code read: `job_search_custom_sources`
has `relrowsecurity` and `relforcerowsecurity` both true, four policies matching
`job_search_profiles`'s exact shape on `jarvis_mod_job_search_runtime`, and no runtime role carries
`BYPASSRLS`.

Three of the four are test-lag from migration `0008`: bump `toHaveLength(7)` → 8, and add a
`seedOwnedRow` branch for the new table — the latter puts that table under cross-owner and admin
isolation checking for the **first time**, so a red there after the fix is a finding, not a nuisance.

The fourth, `release-hardening.test.ts`, is **unrelated to `0008`** — see COORDINATOR-HANDOFF.md.
Stale allowlists in `scripts/audit-release-hardening.ts` missing `notification_reads`, from the
DELETE grants in `packages/notifications/sql/0175` at `444c64d2` (Task 2b, #1283). The grant itself
is sound; I read the policy before authorising the allowlist entry. **Any migration granting DELETE
to a runtime role must add its table to those two Sets with a justification comment**, or this test
goes red with a message that reads like a security breach.

**Repo-wide finding, filed as #1335, to land on its own branch.** No `.tsx` test file is typechecked:
root tsconfig includes `tests/**/*.ts` (no match), `apps/web` covers `src/**/*.tsx` (wrong
directory), `check:external-modules` covers module sources only. 54 files in that gap, confirmed via
`tsc --listFiles`. Tests still run — what's lost is fixture/mock shape drift, which passes silently
and reads as coverage. Do not quote an error count from an ad-hoc probe config; three probes gave
three numbers, all artifacts of borrowed `compilerOptions`.

An earlier integration attempt reported exit 143: that was the Bash tool's own 10-minute timeout
SIGTERMing the wrapper shell, **not** a suite result. Never record a 143 as a gate outcome.

A second `test:integration` from another session's worktree (`1311-install-grant`) runs concurrently
on its own database. No DB collision, but the Postgres *server* is shared and has crashed under
concurrent load before — suspect it first if a run dies without a test failure.

Known pre-existing red, **not ours**: `tests/uat/run-uat.test.ts` fails identically on `main`
(an extra `withoutNewsJsonBinding` field) — settled in a scratch worktree at `9df9ba3e`.

## Agent assignments and the file locks between them

Six build agents. The locks matter more than the assignments — three of them want the same two files.

All six agents confirmed alive and active (transcript mtimes, within the minute). Silence from a lane
means mid-work, **not** stalled — check mtimes before concluding otherwise or reassigning.

| Agent          | Work                                                | Lock                           |
| -------------- | --------------------------------------------------- | ------------------------------ |
| `dedupe`       | **#63** — fixes landed; owes the `main` notes repro | **holds the Postgres slot**    |
| `score`        | #72 per-table RLS coverage audit (read-only)        | manifest edit cleared but HELD |
| `records`      | #1306 UAT, 12 phases under **N45**                  | `tests/uat/*`                  |
| `criteria`     | idle — tool/queue audit closed clean                | none                           |
| `chat-surface` | #71 — #1336 validation-placement design, no code    | none                           |
| `scaffold`     | #1305 Tier B **5/5 written, committed `8e5847b9`**  | awaits explicit slot clearance |

**The Postgres slot is serialised by me, not by inference.** scaffold has been told twice not to read
a finished log or a quiet lane as clearance — concurrent integration runs have crashed the shared
server before, and that takes both results with it.

**`score`'s manifest edit is cleared on the merits and held on timing.** Removing the vestigial
`job-search.settings` storage namespace has zero blast radius — verified: no test asserts the storage
array's contents, length or membership, and `fetchHostGrantsNamespace` already points at
`job-search.fetch-host-grants`. The `toEqual([...])` pattern that would break does exist in this
repo (the finance module's manifest test) but was never applied here. It lands once the gate is
green; a manifest edit shifts the package hash under a run in flight.

**N43 is fully paid.** The hoist landed at `cdbd795c` (one constant in `domain/records.ts` at 25,
both TS literals gone) and the third-site test at `b0371a13`: it loads the **validated** manifest and
asserts `matches.list`'s `limit.maximum` equals the imported `MATCHES_LIST_MAX_LIMIT`. Non-vacuous
because a wrong path yields `undefined` and fails loudly, and because `validate.ts:809-810` was
confirmed to pass `inputSchema` through verbatim rather than reconstructing it — so the test reads
the real shipped manifest, not raw JSON.

**Test 10 is excluded from Tier B by N41.** Do not write it; its coverage was confirmed to exist.

`criteria`'s audit is checking that every tool name invoked from `src/web/**` and `src/worker/**`
exists in the **committed** manifest. Tool names are unvalidated prose — a rename typechecks, lints,
and passes unit tests against a mock keyed on whatever string the test passed. Report only; the
manifest is `score`'s lane.

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
