# #836 Gate + Wrap-Up — Relay Handoff

**Branch/worktree:** `832-datasets-host-pinning` at
`/home/ben/Jarv1s/.claude/worktrees/832-datasets-host-pinning` (already checked out, don't
re-clone). `node_modules` already installed — do NOT re-run `pnpm install`.

**Chain context:** issue 3 of 3 (#832 → #833 → #836). #832 and #833 are DONE and MERGED
(`ab79cdc7`, `a9fe44f8`). **This is the last issue in the chain.**

**Coordinator:** label `Coordinator` — **re-resolve fresh via `herdr pane list`, do not trust any
pane number from this doc.** Current coordinator (as of this relay) is at pane `w1:p9N` — it
explicitly confirmed the #836 plan is APPROVED (relayed from a prior coordinator at `w1:p9K`,
which reviewed the plan in full before handing off). Re-confirm exactly one `Coordinator`-labeled
pane is live before messaging; if 0 or >1 match, halt and wait.

**Spec:** `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md` (has a new
Architecture §4 paragraph from this session — see Done below).
**Plan:** `docs/superpowers/plans/2026-07-07-836-redirect-downgrade-cache-scoping.md` — approved,
both its tasks are fully built and committed (see Done). Nothing left to build.

## Done (this session)

- Wrote the plan, escalated to coordinator, got approval (see plan doc + coordinator confirmation
  above).
- **Task A** committed at `83e0a91e`: `packages/datasets/src/host-pinning.ts` — added
  `shouldDowngradeToGet(status, method)` and `downgradeToGet(init)`; `createHostPinnedFetch` now
  tracks `currentMethod` and downgrades to bodyless GET on 303 (always) or 301/302 (when method
  isn't GET/HEAD already); 307/308 never downgrade. Six new tests in
  `tests/unit/dataset-host-pinning.test.ts` (303/301/302 downgrade cases, 307/308 preservation,
  same-method-unchanged) — all pass, full file green (26/26).
- **Task B** committed at `07199082`: doc comment above `buildCacheKey` in
  `packages/datasets/src/client.ts` (user-scoping constraint) + new paragraph in the spec's
  Architecture §4 (`docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md`) recording
  the same constraint for the deferred keyed-credential slice. Doc-only, no behavior change;
  `dataset-client.test.ts` + `dataset-host-pinning.test.ts` re-verified green (38/38) after this
  commit.
- Plan doc itself needed `pnpm exec prettier --write` before it would pass `format:check` (known
  trap — plan docs must be prettier-clean before committing). Fixed, committed at `6627616e`.
- **Pre-push trio PASSED cleanly** (verified fresh, all green):
  ```
  pnpm format:check   # All matched files use Prettier code style!
  pnpm lint           # eslint . --max-warnings=0 — clean
  pnpm typecheck      # tsc --noEmit (root + apps/web) — clean
  ```
- `git fetch origin main && git rebase origin/main` — branch already up to date with `origin/main`
  (no-op rebase, nothing to replay).
- Working tree is clean (only untracked `.claude/context-meter.log`, not ours to touch).

## Not yet done / in doubt — resume here

**The full `verify:foundation` gate has NOT been cleanly completed yet — this is the only
remaining gap before `coordinated-wrap-up`.** Two attempts this session, both inconclusive due to
my own process handling, not a confirmed real failure:

1. First attempt ran in the foreground with a 10-minute tool timeout; it was still in
   `test:integration` when the timeout fired and killed it (SIGTERM, exit 143). Everything before
   `test:integration` passed cleanly in that run: lint, format:check, check:file-size,
   check:design-tokens, check:no-ambient-dates, check:package-deps, typecheck, **test:unit (273
   files / 1865 passed, 2 skipped)**, `db:migrate` (no-op, 135 current). `test:integration` had
   just started (a few `tasks.recurrence_schedule_reconciled` debug lines) when killed — no
   pass/fail signal from it at all.
2. Second attempt was started via `nohup ... &` inside a `run_in_background` Bash call — this was
   a process-management mistake: the Bash tool's background tracking followed the *wrapper shell*
   (which just echoed a PID and exited), not the detached `nohup`'d `pnpm verify:foundation`
   itself, so the "task completed exit 0" notification was misleading (it was the wrapper
   exiting, not the gate). I then ran `pkill -f "pnpm verify:foundation"` / `pkill -f "vitest run
   tests/integration"` to clean up what I thought was a stray process — this **killed the actual
   in-progress gate run mid-lint**, producing a garbled/truncated log
   (`verify-foundation-836-run2.log`, only 14 lines, showing `lint` failing via ELIFECYCLE then an
   impossible-looking `format:check` section starting right after — almost certainly torn output
   from the SIGKILL, not a real lint failure). **Do not trust that log as evidence of anything.**

**Recommended next step:** run the full gate ONE more time, cleanly, using a single foreground
`Bash` call with `run_in_background: true` (the tool's own backgrounding — do NOT wrap in your own
`nohup ... &`), redirecting to a **new** scratchpad log path (don't reuse
`verify-foundation-836-run2.log`, it's contaminated). Something like:

```bash
JARVIS_PGDATABASE=jarv1s_832_datasets pnpm verify:foundation \
  > /tmp/claude-<pid>/.../scratchpad/verify-foundation-836-run3.log 2>&1
```

with `run_in_background: true` on that single Bash tool call (no `&`, no `nohup`, no manual PID
tracking) and a generous `timeout` (e.g. 600000ms is the tool max — if that's not enough, split
into `pnpm test:integration` alone as a follow-up background call rather than re-running the whole
chain). Given `test:unit` alone took ~79s and the rest of the static checks were fast, the
remaining unknown is purely how long `test:integration` takes against
`jarv1s_832_datasets` — budget for it to need most of the 10 minutes.

Then, once `verify:foundation` is confirmed genuinely green (a real `Test Files ... passed` +
`Tests ... passed` summary from `test:integration`, not an ELIFECYCLE-only log):

```bash
JARVIS_PGDATABASE=jarv1s_832_datasets pnpm audit:release-hardening
```

Redirect that to its own fresh scratchpad log too.

**After both gates are genuinely green:**

- `coordinated-wrap-up`: push, open PR titled something like "datasets: 303 redirect method
  downgrade + cache-key user-scoping guard (#836 3/3)", body notes it's the **last** issue in the
  chain (#832, #833 both merged), cites gate evidence (paste the real pass/fail summary lines, not
  just "gate green"). Report PR + evidence to the coordinator (fresh-resolved label), then stop.
  Do not merge, touch the board, or close the issue — that's the coordinator's job, and it's the
  final issue so no further chain step follows.

## Conventions to keep following

- Caveman-mode terse messages to the coordinator.
- Re-resolve the coordinator pane via fresh `herdr pane list` before every message — never trust a
  pane number written in this doc or a prior turn.
- `git add` by explicit path only, never `-A` or repo-wide `pnpm format`.
- Never touch `docs/coordination/`, the project board, milestones, or merge.
- **DB gotcha for this worktree:** use `JARVIS_PGDATABASE=jarv1s_832_datasets` (already created +
  migrated) for any DB/gate commands — not the shared default DB.
- **Process-management gotcha (this session's mistake, don't repeat it):** for a long-running gate
  command, use the Bash tool's own `run_in_background: true` on ONE call — don't additionally
  wrap the command in your own `nohup ... &`. Doing both means the tool tracks the wrong process
  and a later cleanup `pkill` can kill the real run instead of a stray one.
