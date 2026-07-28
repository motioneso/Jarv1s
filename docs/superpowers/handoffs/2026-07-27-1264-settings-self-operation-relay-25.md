# Relay 25 handoff — #1310 (PR #1276), post-Fable-approval rebase in progress

Read relay-24 first (`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-24.md`)
for full background. This doc only covers what changed since.

## State as of end of relay 25

- Item 9 (live UAT) and the gate rerun from relay 24 are both done — see relay-24. PR #1276 was
  force-pushed (with lease) to `f369e61d` and the body updated with the cross-lane declaration,
  live UAT evidence, #1311 cross-ref, and #1265/#1273 `as const` rebase heads-up. **All of that is
  done and does not need to be redone.**
- **Coordinator ruling received**: PR #1276 is cleared to merge, merge order reversed to
  **#1276 first** (ahead of #1311 — #1311 isn't ready; Fable confirmed #1276 landing without #1311
  fails closed, no unsafe intermediate state). CI on `f369e61d` was confirmed green by the
  Coordinator (`gh run view <id> --json jobs` — `gh pr checks` under-reports, showed pending long
  after actually passing). Fable security verdict: GREEN, 0 blocking, posted on the PR at that head.
  Ben delegated security sign-off to the Fable verdict.
- **Coordinator then required a rebase before merge**: origin/main had moved to `45b8a424`
  ("test(e2e): realign the browser specs with the recovered profile and finish steps"), which
  touches `tests/e2e/app-shell.spec.ts`, `settings-shell.spec.ts`, `onboarding.spec.ts` — the first
  of which this branch also touches (added a "Chat drawer — Approve/Reject card" describe block).
  GitHub reported MERGEABLE (no textual conflict) but the Coordinator wanted semantic verification,
  not just that.
- **Rebase: DONE, clean.** `git rebase origin/main` replayed 69 commits with zero conflicts. Old
  head `f369e61d` → new head **`0e8a5d26`**. Verified `origin/main` (`45b8a424`) is now an ancestor
  of HEAD. Confirmed our commits never touched `settings-shell.spec.ts` or `onboarding.spec.ts` at
  all (`git log <old-merge-base>..f369e61d -- <those two files>` returns empty), and our
  `app-shell.spec.ts` addition (the "Chat drawer" describe block, line ~292) is textually and
  functionally separate from 45b8a424's change to that same file (the "Member" role-badge
  assertion, lines ~74-130 — an unrelated admin sign-out test area). **Low risk assessed, but not
  yet proven by running the actual suites** — that's the next step.
- One unrelated pre-existing local change survived the rebase untouched: `.claude/context-meter.log`
  (was already modified at session start before any of this work; stashed and popped around the
  rebase to keep the tree clean; not part of this PR's scope — leave it alone, don't commit it as
  part of this work).
- **Not yet done**: full gate rerun on the rebased head (fresh `JARVIS_PGDATABASE`,
  docker-exec drop/create — see `verify-foundation-fresh-gate-db` in agentmemory), with particular
  attention to `test:e2e` (NOT included in `verify:foundation` — see
  `verify-foundation-excludes-e2e` in agentmemory, run it separately) and `tests/uat/specs` for the
  three specs 45b8a424 touched. Then push with `--force-with-lease` (pin the lease to the current
  known origin head — check `git ls-remote origin 1264-settings-self-operation` fresh before
  pushing, since the Coordinator may have observed a different head than what's in this doc), confirm
  CI reruns green via `gh run view --json jobs` (not `gh pr checks` — proven unreliable this relay),
  and report the new head sha to the Coordinator.

## Next step (do this first)

1. Fresh gate DB (`jarvis_gate_1264` — drop/create via `docker exec jarv1s-postgres psql -U postgres
   -c ...`, then `export JARVIS_PGDATABASE=jarvis_gate_1264` in the SAME shell invocation that
   launches the background run — env vars do not persist across separate Bash tool calls).
2. Run `pnpm verify:foundation` in the background (it takes ~14 min), log to a file, never pipe to
   tail/head — read the `### FINAL ... rc=$?` marker (append it yourself) or confirm every stage in
   the `&&` chain reached the final stage with a clean summary (that's how relay 24 confirmed rc=0
   without a captured `$?`, since the process was backgrounded/disowned).
3. Separately run `pnpm test:e2e` (not part of verify:foundation) — this is the step CI's
   "Verify foundation and app" job may or may not cover; check what CI actually runs before assuming
   it's redundant. Pay specific attention to `tests/e2e/app-shell.spec.ts`,
   `tests/e2e/settings-shell.spec.ts`, `tests/e2e/onboarding.spec.ts`, and anything under
   `tests/uat/specs` touched by or related to 45b8a424's changes.
4. If green: push rebased branch —
   `git push --force-with-lease=1264-settings-self-operation:<current-known-origin-head> origin 1264-settings-self-operation`.
   Get `<current-known-origin-head>` fresh via `git ls-remote origin 1264-settings-self-operation`
   immediately before pushing (last known from this relay: it should be `f369e61d`, the head from
   relay 24's push, but re-verify — do not trust this doc's number blindly). If the lease fails,
   STOP, do not retry with plain `--force`, report to Coordinator.
5. Confirm CI reruns and goes green on the new head: `gh run list --branch
   1264-settings-self-operation --limit 3` then `gh run view <id> --json jobs` — do NOT rely on
   `gh pr checks`, it under-reported this relay (showed "pending" long after the job had actually
   passed).
6. Report the new head sha to the Coordinator. **Do not merge** — Coordinator-only, per explicit
   repeated instruction this relay.
7. Coordinator is at herdr agent name `coord-1262` (pane `w1:p11T` as of this relay — re-resolve via
   `herdr pane list` fresh, pane ids reflow). Session id `43e5f5e2-0deb-4ab5-9237-436e8795b611`.

## Rules reiterated this relay (still apply)

- DO NOT MERGE — coordinator-only, stated explicitly multiple times.
- Never plain `--force` push — always `--force-with-lease` pinned to a specific expected remote oid,
  and stop + report (don't retry blindly) if the lease fails.
- Never pipe a gate command through `tail`/`head` — a pipeline returns the filter's exit code and
  masks a red result as green.
- This is a genuinely shared branch (`1264-settings-self-operation` is PR #1276's head branch, being
  advanced by a chain of relay agents plus direct Coordinator rulings) — do not `git checkout` /
  `stash --include-untracked` broadly / `reset` the shared tree; this worktree is isolated so normal
  operations are fine, just stay scoped to files this PR actually owns.
