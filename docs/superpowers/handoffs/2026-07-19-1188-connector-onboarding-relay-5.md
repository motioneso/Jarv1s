# Relay 5 — #1188 connector onboarding (clean-branch wrap-up, gate + rebase remaining)

Context meter hit 71%. Relaying per `relay` skill / self-monitor note in relay-4. Picking up
**mid coordinated-wrap-up** on a clean branch already cut and cherry-picked; gate run interrupted,
plus a new mid-session instruction changes the push plan (rebase needed).

**Spec:** `docs/superpowers/specs/2026-07-19-1188-connector-onboarding-feedback.md`
**Plan:** `docs/superpowers/plans/2026-07-19-1188-connector-onboarding.md`
**Prior relay:** `docs/superpowers/handoffs/2026-07-19-1188-connector-onboarding-relay-4.md` (full
scope/root-cause analysis — still valid, read it if you need the "why" behind commit selection).
**Worktree:** same as before, `feedback/1188-connector-onboarding` checkout, now on branch
`fix/1188-connector-onboarding-clean`.
**Coordinator:** label `Coordinator` — re-resolve pane fresh by label via `herdr pane list`.

## Governing instructions (most recent wins)

1. (relay-4, still active) Report PR URL to Coordinator, **do not merge**.
2. (relay-4, still active) Clean branch must contain ONLY #1188-lane commits — no inherited
   `coord/1179-pdf` commits. **Verified done, see below.**
3. **NEW, mid-session (this relay's reason for existing):** Coordinator: "origin/main advanced to
   `97b5bd52` via PR #1201. Re-fetch and rebase/clean-scope verify against that tip before push; do
   not publish a behind-main PR." **Not yet done** — branch is still based on the old `d25d84e1` tip.

## What's done

- `fix/1188-connector-onboarding-clean` branch created from `origin/main` (was `d25d84e1` at the
  time).
- 8 commits cherry-picked cleanly, **no conflicts**: `8fc82720 561df38e cc4df6ef 1dced69c bce03ff8
  247fd7b9 fa43f8ab f0315c9c` (in that order, `35488a78` correctly excluded per relay-4's root-cause
  analysis).
- Scope proven clean at that point: `git log --oneline origin/main..HEAD` showed exactly 8 commits;
  `git diff --stat` touched only `google-connector-step.tsx`, `use-google-connect-flow.ts`,
  `onboarding.spec.ts`, plan doc, relay docs. (Will need re-proving after rebase — see next steps.)
- **e2e suite: 16/16 GREEN**, including the 2 originally-Opus-flagged tests, confirming relay-4's
  root-cause analysis was correct (no `35488a78`-style test changes needed).
  - **Trap hit + resolved:** first e2e run showed 6 failures (not the 2 originally flagged — 6
    *different* ones, all in #1188's own new features). Root cause: a stale Vite dev server left
    running on port 4173 from before the branch/cherry-pick, reused by Playwright's
    `reuseExistingServer: !process.env.CI` config, serving a stale module graph. Killed the stale
    PID, reran → 16/16 green with zero code changes. See `memory_save` "Stale Vite dev server
    false-failures e2e trap" (`project: "jarv1s"`) for the general pattern — check for this on any
    future post-branch-switch e2e run before treating failures as real.
- Prettier: `prettier --check .` flagged 3 files (`google-connector-step.tsx`, the plan doc, and
  `onboarding.spec.ts` — NOT the #1187 spec file relay-4 warned about; that one was clean on this
  branch as predicted). Fixed with `prettier --write` on exactly those 3 paths, committed by
  explicit path as `118914e7 style(onboarding): apply prettier formatting to #1188 lane files`.
  `prettier --check .` now clean repo-wide.
- Branch is now **9 commits** ahead of the *old* `origin/main` tip (8 cherry-picks + 1 prettier fix).

## Relay-6 update (compaction tripwire, mid gate rerun)

Context meter dropped 61%→49% (compaction happened). Coordinator tripwire fired: flush state,
spawn Sonnet successor in THIS SAME worktree (not isolated — this is a same-tree relay of one
continuing task), confirm driving, then stop. This section is the freshest state — read it first,
the rest of this doc below is still accurate background.

- `origin/main` fetched, confirmed tip **`97b5bd52`** (PR #1201, unrelated chat/DOCX feature —
  conflicts with #1188's connector files unlikely, but verify, don't assume).
- Gate rerun **launched in background**, NOT yet confirmed complete or its exit code read:
  ```bash
  JARVIS_PGDATABASE=jarv1s_gate_1188 pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "VF_EXIT=$?"
  ```
  ran via a backgrounded Bash task (id `bnbs7h608` in the prior session — that id is dead now,
  the process may still be running in the shell or may have finished/died; **check first**:
  ```bash
  tail -50 /tmp/cb-vf.log   # see how far it got / whether VF_EXIT printed
  ps aux | grep -E "vitest|verify:foundation|tsc|eslint" | grep -v grep
  ```
  If the process is gone and `/tmp/cb-vf.log` has no `VF_EXIT=` line, it died/was killed by the
  compaction — just rerun the command above fresh (isolated DB `jarv1s_gate_1188` still exists,
  confirmed present moments before this relay).
- **Do NOT rebase onto `97b5bd52` while the gate is mid-run** — rebase mutates working-tree files
  under a running test process. Wait for the gate to actually finish (green or red) first.
- Next actions, in order: (1) confirm gate VF_EXIT, fix if red per the trap notes below, (2) run
  `pnpm audit:release-hardening`, (3) only then `git rebase origin/main`, (4) re-prove scope,
  (5) pre-push trio, (6) push + PR, (7) report to Coordinator, (8) stop. Full detail in "Next
  concrete steps" below — unchanged except step 3's fetch is already done.

## In progress / interrupted

- `pnpm verify:foundation` **first run FAILED** (`VF_EXIT=1`), but only in
  `tests/uat/seed/guard.test.ts` (2 failures: "refusing: target DB already has real/bootstrap
  users"). This is the known trap in memory `verify-foundation-fresh-gate-db` — the shared dev DB
  (`jarv1s`, docker container `jarv1s-postgres`, `localhost:55433`) had durable rows from an earlier
  gate run. Everything else in the gate passed clean (lint, format, file-size, design-tokens,
  ambient-dates, package-deps, typecheck, app-map, test:unit [459 files/3790 tests passed — ignore
  the transient "1 failed" line mid-run for `external-worker-runtime.test.ts`, it self-resolved and
  the final summary is authoritative], db:migrate).
  - **Do NOT drop the shared `jarv1s` DB** — it's the live shared dev DB, other sessions may depend
    on it (see `multi-agent-pg-contention` memory: use a **per-agent isolated DB**, not the shared
    instance).
  - **Already done:** created a dedicated disposable gate DB:
    `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarv1s_gate_1188;"` (also ran
    a DROP IF EXISTS first, was a no-op). This DB exists and is empty, ready for a fresh migrate.
  - **Not yet done:** actually rerun the gate with `JARVIS_PGDATABASE=jarv1s_gate_1188` exported so
    `db:migrate`/`test:uat-seed`/`test:integration` all target the isolated DB instead of the
    default `jarv1s`.

## Next concrete steps

1. Rerun the full gate against the isolated DB:
   ```bash
   export JARVIS_PGDATABASE=jarv1s_gate_1188
   pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "VF_EXIT=$?"
   ```
   Expect 0. If `test:uat-seed` still complains about non-empty DB, the DB wasn't actually empty —
   re-drop/re-create `jarv1s_gate_1188` and retry once. If a *different* failure appears, diagnose
   fresh rather than assuming it's this same trap.
2. Run the hardening audit (same isolated DB):
   ```bash
   pnpm audit:release-hardening > /tmp/cb-audit.log 2>&1; echo "AUDIT_EXIT=$?"
   ```
   Expect 0.
3. **Critical — do this before any push:**
   ```bash
   git fetch origin main
   git log --oneline -1 origin/main   # should now show 97b5bd52 or later
   git rebase origin/main
   ```
   Resolve any conflicts by reading intent (`git show <sha>`), never blind `--ours`/`--theirs`. Note
   PR #1201 (Job Search onboarding, unrelated module) landed — conflicts are unlikely since #1188
   only touches Google/IMAP connector files, but don't assume, verify.
4. **Re-prove scope after rebase** (do not skip — the whole reason for this relay):
   ```bash
   git log --oneline origin/main..HEAD   # must be exactly the 9 commits above (or rebase-adjusted SHAs), nothing from PR #1201 or elsewhere
   git diff origin/main..HEAD --stat     # must touch only the same file set as before
   ```
5. Pre-push trio (post-rebase, files may have shifted): `pnpm format:check && pnpm lint && pnpm typecheck`.
6. Push + open PR (`coordinated-wrap-up` step 3-4):
   ```bash
   git push -u origin fix/1188-connector-onboarding-clean
   gh pr create --base main --head fix/1188-connector-onboarding-clean \
     --title "fix(onboarding): connector picker parity, one-click consent, IMAP steps (#1188)" \
     --body "<scope, spec link, VF_EXIT/AUDIT_EXIT evidence, rebased on origin/main @ 97b5bd52+, note 2 previously-flagged e2e tests pass unmodified (no 678c29b1 dependency)>"
   ```
   **Do NOT merge.**
7. Report to Coordinator via `herdr-pane-message`, caveman mode:
   "1188 clean-branch DONE. PR: <link>. VF_EXIT=0 AUDIT_EXIT=0 (isolated gate DB). Branch rebased on
   origin/main @ <sha>, 9 commits (8 cherry-picks + 1 prettier fix), no inherited coord/1179-pdf or
   #1201 commits. 16/16 e2e green (2 previously-flagged tests pass unmodified). Deferred: none.
   Ready for QA + merge." Then **stop**.
8. Cleanup (low priority, do if time permits): `docker exec jarv1s-postgres psql -U postgres -c
   "DROP DATABASE IF EXISTS jarv1s_gate_1188;"` once the gate is confirmed green and you no longer
   need to rerun it — it's a disposable scratch DB.

## Old worktree state (for reference, not to be pushed)

`feedback/1188-connector-onboarding` branch (the messy 55-commit one) still exists, untouched, HEAD
at `35488a78`. Not part of this work.

## Self-monitor reminder

Relay again immediately on the next context-meter 70% warning — don't wait to finish all remaining
steps in one session.
