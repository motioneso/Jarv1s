# Brief — thin the Job Search plan

Let `SP=/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-job-search-reset/99c69073-3651-4332-b477-badc3ae3f8a2/scratchpad`

Cwd `/home/ben/Jarv1s/.claude/worktrees/compass`. Do not `cd` out. Do not `git add -A` / `git add .`.
Never bare `git stash` / `git stash pop`. The plan file is uncommitted and yours; nothing else is.

## The ruling

Ben, 2026-07-26: **"the plan doesn't need that kind of detail."**

`docs/superpowers/plans/2026-07-26-job-search-module.md` pre-writes ~6000 lines of real
implementation code. Six adversarial review rounds never converged — blockers per round 5 → 4 → 4 →
6, all `NOT LOCKED`. The findings were genuine but mostly _new_ surface each time: every wholesale
rewrite of a task manufactured fresh code for the next round to attack. There is no floor.

Your job: rewrite the plan so it carries **contracts, invariants and test cases** instead of
implementations.

**This overrides the `superpowers:writing-plans` skill**, which mandates complete code in every step
and forbids "placeholders". Ben's instruction beats the skill. Do not restore code to satisfy it.

## Keep

- Task boundaries, **numbering (frozen)**, ordering, and stated dependencies. Tasks are
  cross-referenced by number throughout.
- Exact file paths: create / modify / test.
- **Contracts** — exported type definitions and function signatures, verbatim. These are how one
  task's implementer learns what a neighbouring task produces. Interfaces stay complete.
- **Manifest JSON** and **SQL DDL**, verbatim. A migration is hash-checked and can never be edited
  after it applies, so its DDL is a decision, not an implementation.
- **Invariants and rulings** — see the ledger below. Every one, with its `file:line` evidence.
- **Test cases as behaviour statements** — the test's name, what it asserts, and why it would fail
  against a plausible broken implementation. Not the test body. A reviewer must be able to tell a
  real test from a tautological one from the statement alone.
- Verification commands with expected exit codes.

## Cut

- Function bodies. Illustrative code that is not a contract.
- The repeated five-step TDD ceremony per task ("write the failing test / run it / see it fail /
  implement / run it / commit"). State once, globally, that every task is TDD and commits at the
  end. Do not repeat it 23 times.
- Anything that exists only to look thorough.

Target: the plan should read as a specification an experienced engineer implements against, not a
transcript of the implementation. Expect it to land somewhere near a quarter of its current length.
Do not pad to hit a number in either direction.

## The ledger is the thing that survives

`$SP/rulings-ledger.md` — every finding from review rounds 1–6 that is a **fact about the tree** or
a **decision taken**, with `file:line`, including the ones judged invalid. Four rounds of review
bought those. The code they critiqued is being deleted; **the constraints must not be.**

Give the plan a top-level section that carries them — "Constraints proven against the tree" — and
reference the relevant ones from each task. If a ruling is currently only expressed implicitly by
some code you are cutting, write it out explicitly before the code goes.

`$SP/r6-status.md` lists which round-6 findings were applied and which were not. The unapplied ones
must still be honoured — as constraints now, not as code.

Findings by round: `$SP/codex-r3-findings.md`, `$SP/codex-r4-findings.md`, verdicts
`$SP/codex-r[456]-verdict.txt`. Transcripts `$SP/codex-r*.txt` are ~1 MB each — grep, never read
whole.

## Editing technique

The file is large. Editing big spans with the Edit tool has failed here. Draft the replacement into
a scratchpad file, locate the span with `grep -n`, splice by index in `python3` with assertions on
the boundary lines first, and re-check landmark headings after each splice.

**Check NUL bytes after every splice, in python3:** `print(open(p,'rb').read().count(b'\x00'))`. Do
not use grep — bash cannot embed a NUL, so `grep -c $'\x00' f` degenerates to `grep -c ""` and
matches every line. NUL bytes have been written into this file before; the tell is `grep` returning
no output at all for the whole file.

Run `pnpm prettier --write` on the plan when you are done.

## When the rewrite is done

Run **one** final review round. Reuse `$SP/review-prompt-r4.md` as the template, but rewrite it for
the new shape — the reviewer must be told the plan deliberately carries no implementation code, so
"this step doesn't show how" is not a finding. Ask it to attack the contracts, the invariants, the
DDL, the ordering, and whether the test cases would actually catch a broken implementation.

```bash
codex exec -s read-only --json -o $SP/codex-r7-verdict.txt "$(cat $SP/review-prompt-r7.md)" \
  2>/dev/null > $SP/codex-r7.txt
```

Read-only. `~/.codex/config.toml` already defaults to `gpt-5.6-sol` / `high` — confirm in the output
rather than assuming. Takes 20+ minutes; background it and poll the file size.

Apply what round 7 returns. Then **stop** — do not start round 8. Report the verdict and what is
left, and let Ben decide.

## Standing constraints

- Never reference any previous job-search build's failure history.
- No subagents, no workflows, no deep research. The Codex review is the one sanctioned exception.
- Never trust a "done" — real exit codes, never `| tail`.
- Ben wants concision. A few lines per report.
