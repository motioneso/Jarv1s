# Coordinator state — epic #1280 job search

Pointer document. Everything here is a location, not a copy. Read the linked source, not this file,
for detail.

- **Branch** `feat/job-search`, worktree `~/Jarv1s/.claude/worktrees/job-search`.
- **Rulings** — `rulings-ledger.md` in this directory is the authority, through **N45**. N44 and N45
  were written into it late (line 1742 onward); until then both documents claimed an authority the
  ledger did not carry, while `records` was already building UAT under N45. If a ruling is cited
  anywhere, confirm it exists in the ledger before relying on the citation.
- **Task list** — GitHub epic #1280 and its children.

## A false alarm I raised, recorded so nobody re-investigates it

I reported `tests/integration/job-search-rls.test.ts` (291 lines, untracked) as unrecoverably lost,
put it in this document, and messaged three agents about it. **Nothing was lost.** `dedupe` had begun
extracting the RLS describe block into that file, found that `scaffold`'s split into
`job-search-worker-surface.test.ts` had already brought `job-search.test.ts` under the size cap, and
deleted their own extraction so the RLS block wouldn't exist in two places. Deliberate, correct, and
theirs to delete.

The lesson is mine: I read a disappearance out of a `git status` diff and escalated before asking
whose file it was. **Ask the lane owner before declaring a loss** — an untracked file vanishing looks
identical whether it was abandoned on purpose or destroyed.

What survives from the scare is worth keeping: a new test file should be committed once it
typechecks, not once it passes, and the per-table RLS coverage question (task **#72**) is worth
answering on its own merits — and it now has an answer, below.

## RLS coverage is real, and it is 6 tables, not 8

**`JOB_SEARCH_TABLES` (`src/db/tables.ts:11-18`) holds 6:** profiles, portals, postings, matches,
resumes, custom_sources. Earlier versions of this document said 8 — that was the *migration file*
count (0001-0008, two of them index-only). Don't audit against 8.

All 6 have genuine per-table coverage in `tests/integration/job-search.test.ts`, verified at
`a4ca8676`: a cross-owner loop over `JOB_SEARCH_TABLES` asserting both directions (line 514), the
same loop under an admin actor asserting 0 rows — the direct no-admin-bypass proof (line 531), and a
`pg_policies` check (line 543) guarding the fail-open case where a table joins `ownedTables` but
`installModule` never generates a policy for it. Narrower complementary coverage in
`job-search-tables-install.test.ts` tests the owner-bound composite FK, which RLS alone does not catch.

`job_search_custom_sources` joined that coverage only at `a4ca8676`. Before it, `seedOwnedRow` had no
branch for the table and **threw** — the loop crashed rather than silently skipping, which is the only
reason it surfaced. A crash is a good failure mode; a skip would still be hidden.

## #1336: the validation boundary already exists and is dormant

Every manifest tool declaration already accepts an optional `outputSchema`
(`module-sdk/src/external-manifest.ts:168`), and `routes.ts:711` already calls
`sanitizeAssistantToolResult(manifestTool.outputSchema, toolResult)` on every read-tool REST invoke —
the exact path `board.tsx` hits. The LLM gateway path calls it too (`gateway.ts:360,433,437`).

**No module in this repo declares `outputSchema` for any tool.** The function no-ops on a missing
schema, which is why `board.tsx:219-223`'s cast has nothing behind it and why a stale test mock could
describe a shape that isn't real. This is a field to populate, **not a validator to build, and not a
platform issue** — though defaulting or enforcing it repo-wide would be, and that is a separate call.

Failure handling needs no new code: a throw propagates through `api.ts`'s `invokeTool()` into
`board.tsx:227`'s existing `MatchesState` error arm and `inspector.tsx:88`'s `detailError`, so a
malformed response becomes a real error state rather than an empty board reading as "no jobs matched".

`sanitizeAssistantToolResult` had **no dedicated test file** anywhere in the repo. It has one now:
`tests/unit/ai-output-validation.test.ts` at `c5b7d2c0`, 8 cases, verified by reading the file rather
than the report. It pins the throw, the strip, the no-op-on-absent-schema path, both branches of a
declared-nullable field, per-item recursion into arrays of objects, and `columnOrder` filtering. The
last two were beyond the brief and are the two worth having. So `score`'s `outputSchema` in **#73**
lands on tested ground, not on a function nobody had ever exercised directly.

## Gate

Eight non-DB links verified exit 0: `lint`, `format:check`, `check:file-size`,
`check:design-tokens`, `check:no-ambient-dates`, `check:package-deps`, `typecheck`, `build:app-map`.

`test:unit` at 3729/3732. The one failure is in-flight shape drift, not a HEAD regression — score's
uncommitted `url` key against the exact-keys assertion at `tests/unit/job-search-match-handler.test.ts:176`.

**`test:integration` latest run (18:15, log `scratchpad/test-integration-3.log`): `STEP_EXIT=1`,
`Test Files 1 failed | 165 passed (166)`, `Tests 1764 passed | 7 skipped (1771)`.**

**Read that summary before you believe it.** Zero tests failed. The passing count went *up*, 1760 →
1764. `165 passed` sits next to `1 failed`. Skimmed, it reads as progress. What actually happened is
that `tests/integration/job-search-worker-surface.test.ts` — scaffold's Tier B for #1305 — failed at
the **suite** level and all 5 of its tests **skipped**:

```
Error: sign-up for owner@job-search-tierb.test failed (500):
  ❯ signUp tests/integration/job-search-worker-surface.test.ts:440:11
  ❯ tests/integration/job-search-worker-surface.test.ts:93:19
```

`beforeAll` at line 93 calls `signUp`, gets a **500 with an empty body**, throws, and the file
contributes nothing. Tests 6, 9 and 11 have still never asserted anything. This was Tier B's **first
ever DB-backed execution** — it had been written and committed for hours. "Written and committed" was
true the whole time and told us nothing, which is why **#60 stayed open** and stays open now.

scaffold holds the Postgres slot to root-cause it, and must report **harness gap vs product defect
before writing a fix** — those have very different consequences for the PR, and the verdict should
exist before a commit exists to argue for one.

**The earlier `notes-write-tools.test.ts` flake is confirmed and closed.** It passed in this run and
`tuple concurrently updated` appears nowhere in the log — it cleared exactly when the other
worktree's suite finished, which is what the shared-foundation-state diagnosis predicted. Do not
spend more time on it; the `main` reproduction stays stood down.

Prior run at `14593694`: 164/165 files, 1760/1763 tests, exit 1 — down from 3 files / 4 tests. All
four of dedupe's original failures are fixed, including the two that put `job_search_custom_sources`
under cross-owner and admin isolation checking for the first time.

The single remaining failure — `notes-write-tools.test.ts > rejects empty oldText regardless of file
length` — is **a diagnosed flake, not a regression.** The error is `tuple concurrently updated` raised
inside `resetEmptyFoundationDatabase`/`runSqlFiles`, and the file reran alone against the same DB at
17/17. Cause: two integration suites from different worktrees racing to reset **shared foundation
state**, which a private gate DB does not isolate you from.

Record it as *"flake — shared foundation DB reset raced under concurrent suites"*, never as
*"unrelated to job-search"*; the second phrasing invites the next person to skip it. **Check
`ps -eo pid,etime,args | grep "[v]itest.*tests/integration"` before starting any gate run** — if
another worktree is mid-suite, wait. This is also why a `main` reproduction was stood down: error
text plus mechanism plus clean isolated rerun already settles it.

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
| `chat-surface` | **#75 web half** — audit, read-only                 | none                           |
| `scaffold`     | **#75 worker/test half** — audit, read-only         | awaits explicit slot clearance |

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

**N37's tripwire is ANSWERED — closed by N41, and this paragraph used to say otherwise.** It was
written before N41 landed and never cleaned up, while line 201 of this same file already recorded the
resolution. Left standing, it cost real time: I relayed "still unanswered" to `scaffold` as a live
work item and had to withdraw it. A doc that contradicts itself is worse than a doc that is silent,
because both halves read as authoritative and the reader picks one at random.

The resolution, per N41 (ledger line 1581): test 10 **stays out** of Tier B and no transfer to #1306's
UAT was ever needed, because its two named risks are already covered at better levels than a UAT could
reach — named to N37's own file-and-line standard:

- "the postings landed" → `tests/unit/job-search-crawl-stage.test.ts:225` (test 2), a healthy freehire
  plus a `rate_limited` LinkedIn in one pass, asserting **both** postings persisted including `li-2`,
  the partial haul from the portal that failed.
- "`lastOkAt` intact" → `tests/integration/job-search-store.test.ts:380` (case 6), asserting at `:416`
  that a failure write passing `lastOkAt: null` does not erase the prior value. Real Postgres, against
  the actual `COALESCE` at `worker/store-sql.ts:361`.
- the failure path writes a portal row at all → `job-search-crawl-stage.test.ts:263` (test 3), for
  `login_required` + `enabled: false`.

Independently re-verified against the current tree on 2026-07-27: test 2 is now at line 226 and
carries the N41-mandated assertions (`cause.kind === "rate_limited"`, `enabled === true` on the
persisted row). Cited **and** present. #1305 does not wait on this.

## Standing method

Verify every agent claim independently — reading the diffs is what produced #1330, N38, N39 and
N40, in each case against a report that said the change was internal or the plan was fine. Read gate
exit codes back **from the log file**: a background command whose script ends in `echo` reports exit
0 while the gate is red, which happened this session. Never `git add -A`/`.`/`-a`, never a bare
`git commit`, never `git stash` — the tree and the stash stack are shared.
