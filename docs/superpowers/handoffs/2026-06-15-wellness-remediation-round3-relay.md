# Build-agent handoff — Wellness Codex round-3 fixes (C1 bug-class + C2 test depth)

**You are a BUILD AGENT** under the Wellness dev coordinator (Herdr label
**`Wellness-Coordinator`**, session `ea8e89af`). Invoke **`coordinated-build`** and follow it. This is
the **last planned remediation cycle** before merge — be thorough. **Do NOT push/PR/merge or touch
`docs/coordination/`.** Stage only paths you change (no repo-wide `pnpm format` + `git add -A`).

## Worktree / branch (shared primary worktree — no new worktree)

- CWD: `~/Jarv1s/.claude/worktrees/feat+wellness-design`
- Branch: `worktree-feat+wellness-design`, current HEAD remediation commit **`6e23402`** (round-2
  fixes). `node_modules` present — **do NOT `pnpm install`**.
- Resolve the coordinator pane fresh by label `Wellness-Coordinator` (pane numbers reflow). Message
  via two-call path: `herdr pane send-text <pane> "<msg>"` then `herdr pane send-keys <pane> Enter`.

## Context

Codex has reviewed 3 rounds. Round-1 (9 findings) and round-2 (4 regressions) are fixed. Round-3
returned **DO-NOT-MERGE, BLOCKERS:1**. The independent gate at `6e23402` is **green (exit 0, 728
tests)** — so this is a correctness/data-loss footgun, not a test failure. Two issues remain:

### C1 [HIGH] — fix the partial-update DATA-LOSS bug CLASS (not just one field)

`packages/wellness/src/repository.ts` (~line 317) `updateCheckin`: R1 fixed `sensations`, but the
same pattern remains for **`feelingSecondary`** — `parseUpdateCheckinBody` returns `undefined` when
omitted, then `updateCheckin` writes `feeling_secondary = input.feelingSecondary ?? null`, **erasing
the existing feeling word** on any partial energy/details PATCH. A round-4 finding on yet another
field is likely unless you fix the whole class.

**Fix:** make `updateCheckin` a true partial update. Audit the ACTUAL check-in columns it writes
(feeling_core, feeling_secondary, feeling_tertiary, sensations, intensity, energy, mood_index,
details/notes — verify against the schema). For EVERY optional field: only include the column in the
UPDATE SET when the parsed input field is `!== undefined`; **omitted ⇒ leave existing value
unchanged**; **explicit `null`/`[]` ⇒ clear**. Remove all `?? null` / `?? []` defaults on the update
path. Keep the taxonomy invariant (`feeling_tertiary` always null). **Re-validate the feeling PATH
against the final COMBINED (existing + patched) values**, not just the patch payload (fetch the
existing row, merge, validate).

**Tests (regression):** partial PATCH omitting `feelingSecondary` RETAINS it; PATCH with
`feelingSecondary: null` clears it; same omit-retains / explicit-clears coverage for `sensations`
and one more optional field (e.g. `intensity` or `details`).

### C2 [LOW] — deepen the R2 energy-trend test

`tests/integration/wellness-phase2.test.ts` (~line 386): the round-2 energy-trend test only asserts
the PATCH response, so it would still pass if `refreshEnergyTrendFact` were deleted. Strengthen it to
assert the **`[wellness:energy-trend]` memory/recall fact is actually inserted/updated** after the
PATCH (query the memory/recall store for the fact, not just the HTTP response).

## Process

1. Fix C1 (bug class) + C2.
2. `pnpm verify:foundation` — read the **REAL exit code** (no `| tail` mask). Run the cleanup `rg`
   gate for stale vocab. DB up on `localhost:55433` (`postgres:postgres`, db `jarv1s`); migrations
   `0088`/`0089` applied — **never edit applied migrations**.
3. Commit green, staging only changed paths. Trailer:
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
4. Report to `Wellness-Coordinator` (two-call path): commit SHA, REAL gate exit code, per-issue
   status. **Do NOT push/PR/merge** — the coordinator runs round-4 Codex + merges.

## Escalate

Tag `[DESIGN-FORK]`/`[CRIT]` if the partial-update semantics or feeling-path revalidation surface a
question the above doesn't settle. Self-monitor context: relay (don't `/compact`) at ~80k tokens or a
compaction summary — write a continuation doc, `herdr-handoff` a successor in THIS worktree, tell the
coordinator "relayed, safe to reap."
