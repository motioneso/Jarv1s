# Rewrite method + progress — thinning the Job Search plan

`SP=/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-job-search-reset/99c69073-3651-4332-b477-badc3ae3f8a2/scratchpad`

Task spec: `$SP/BRIEF-thin-plan.md`. Read it first, every session. Its standing constraints hold.
Cwd `/home/ben/Jarv1s/.claude/worktrees/compass`. Do not `cd` out. Never `git add -A` / `git add .`.

## Why this method

The old plan is 8179 lines. Reading it whole and then writing the new one whole does not fit in one
context window — the first attempt ran out at Task 15. So the rewrite is **incremental and
file-backed**: one part file per section, drafted from that section's line span only, concatenated
at the end. No session ever needs more than one task's source in context.

## Procedure

1. Pick the next unstarted row in the progress table below.
2. `Read` the plan at exactly that line span (`offset`/`limit`; keep `limit` ≤ 1050 or the Read
   tool overflows its 25k-token cap).
3. Draft the thinned section into `$SP/parts/<NN>-<slug>.md`. Shape below.
4. Tick the row here, with the part file's line count.
5. Stop when context gets tight. The next session repeats from step 1.

When every row is done: concatenate the parts in order into the plan file with `python3`, NUL-check
(`print(open(p,'rb').read().count(b'\x00'))` — never grep for NULs), re-check the landmark headings,
`pnpm prettier --write` it. Then the single Codex round 7 per the brief.

## Shape of a thinned task section

Frozen heading (`### Task N: <original title>`), then:

- One or two sentences of intent — why the task exists, not how it works.
- **Files:** create / modify / test, exact paths.
- **Depends on:** task numbers.
- **Contracts:** exported types and function signatures **verbatim**. Manifest JSON and SQL DDL
  **verbatim**. Nothing else in a code fence.
- **Constraints:** bullet list, each referencing a `Constraints proven against the tree` ID (see
  below) or carrying its own `file:line`.
- **Tests:** a numbered list of behaviour statements — the test's name, what it asserts, and why it
  would fail against a plausible broken implementation. No test bodies.
- **Verify:** commands with expected exit code 0.

No per-task TDD ceremony. The global preamble states once that every task is TDD, and commits at the
end with a `feat(job-search):`-style message.

## Global sections (write these too)

- Keep and lightly edit: title/preamble (1–29), Global Constraints (30–62), Decision required
  before Phase 1 (63–74), File Structure (75–133).
- **New:** `## Constraints proven against the tree`, immediately after Global Constraints. Built
  from `$SP/rulings-ledger.md` (601 lines, sections A–M) — every entry, with its `file:line`, given
  a stable ID (`A1`, `B3`, …) so tasks can cite it. This is the artifact the brief cares most about.
- **The 7 unapplied round-6 findings** (`$SP/r6-status.md`, "Not applied") must appear as explicit
  constraints on their tasks: 5b→Task 20, 6→Task 22, 7→Task 18, 8→Task 18, 9→Task 15, 10→Task 15,
  11→Task 14, 12→Task 5.
- Fix while rewriting: Task 2e's prose still says `WorkerLane = "queue" | "tool"`; the correct union
  is `"queue" | "tool" | "briefing"` (round-6 #1, applied in the Interfaces block only).

## Progress

| #   | Part file                   | Source lines | Done   |
| --- | --------------------------- | ------------ | ------ |
| 00  | `00-preamble.md`            | 1–133        | ✅ 176 |
| 01  | `01-constraints.md`         | ledger       | ✅ 600 |
| 02  | `02-task01-embed.md`        | 136–440      | ✅ 143 |
| 03  | `03-task02-briefing.md`     | 441–1052     | ✅ 232 |
| 04  | `04-task02b-notify.md`      | 1053–1484    | ✅ 212 |
| 05  | `05-task02c-chatsurface.md` | 1485–1821    |        |
| 06  | `06-task02d-badge.md`       | 1822–2038    |        |
| 07  | `07-task02e-deadline.md`    | 2039–2626    |        |
| 08  | `08-task03-scaffold.md`     | 2627–2876    |        |
| 09  | `09-task04-schema.md`       | 2877–3431    |        |
| 10  | `10-task05-records.md`      | 3432–3700    |        |
| 11  | `11-task06-excludes.md`     | 3701–3863    |        |
| 12  | `12-task07-dedupe.md`       | 3864–4036    |        |
| 13  | `13-task08-triage.md`       | 4037–4337    |        |
| 14  | `14-task09-score.md`        | 4338–4607    |        |
| 15  | `15-task10-criteria.md`     | 4608–4930    |        |
| 16  | `16-task11-freehire.md`     | 4931–5303    | ✅ 151 |
| 17  | `17-task12-linkedin.md`     | 5304–5431    | ✅ 71  |
| 18  | `18-task13-worker.md`       | 5432–5934    | ✅ 300 |
| 19  | `19-task14-crawl.md`        | 5935–6133    | ✅ 121 |
| 20  | `20-task15-pass.md`         | 6134–6987    | ✅ 420 |
| 21  | `21-task16-tools.md`        | 6988–7117    | ✅ 77  |
| 22  | `22-task17-seed.md`         | 7118–7250    | ✅ 72  |
| 23  | `23-task18-web.md`          | 7251–7551    | ✅ 191 |
| 24  | `24-task19-onboarding.md`   | 7552–7577    | ✅ 44  |
| 25  | `25-task20-board.md`        | 7578–7660    | ✅ 117 |
| 26  | `26-task21-integration.md`  | 7661–7845    | ✅ 122 |
| 27  | `27-task22-e2e.md`          | 7846–8108    | ✅ 176 |
| 28  | `28-task23-gate.md`         | 8109–8152    | ✅ 44  |
| 29  | `29-selfreview.md`          | 8153–8179    | ✅ 31  |

Line spans are against the **current, untouched** plan file (8179 lines, 27 `### Task` headings,
0 NUL bytes). Do not splice into the plan until every part is drafted, or the spans go stale.
