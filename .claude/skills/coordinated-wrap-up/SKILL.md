---
name: coordinated-wrap-up
description: "Use when you are a BUILD AGENT under a dev coordinator and your spec's work is done — close out YOUR slice only. Derived from the `wrap-up` skill but scoped down: clean tree, your own green gate, push your branch, open the PR, then report the PR + verified evidence to the coordinator. You do NOT touch the board, milestones, or merge — those are the coordinator's."
---

# coordinated-wrap-up — close out your slice and hand it to the coordinator

## Overview

The stock `wrap-up` closes out a whole session including board/milestone/merge bookkeeping. Under
a coordinator, **that bookkeeping is the coordinator's, not yours.** Your finish line is a green,
pushed branch with an open PR and a truthful report to the coordinator. It then runs QA, merges,
and updates GitHub.

**Announce:** "Using coordinated-wrap-up to close out my slice." TaskCreate one item per step.

## Procedure

### 1. Clean tree — your files only

```bash
git status --porcelain
```
Commit your remaining green work by **explicit path** (`Co-Authored-By: Claude`). If a
linter/Prettier reformatted files, `pnpm format` then commit — `format:check` is part of the gate.
You have your own worktree, but still stage by path; never `git add -A` reflexively.

### 2. Your own green gate — on an ISOLATED gate DB, verified, not assumed

**The gate writes to a database. Pick the wrong one and you break Ben's running instance.** With
`JARVIS_PGDATABASE` unset, `verify:foundation` falls through to the live dev database `jarv1s` —
that happened on 2026-07-25 and took Ben's chat down for ~90 minutes (uat-seed rewrote the AI
provider rows; every request came back 400 "No active chat-capable model is configured"). Durable
uat-seed rows also survive between runs, so a reused gate DB fails the *next* run for no real
reason. Both are fixed by a fresh, per-agent gate DB.

```bash
# 1. Fresh gate DB. jarv1s-postgres is the DEV container (:55433).
#    NEVER target jarv1s-prod-postgres-1 — that is production.
GATEDB=jarvis_gate_<your-slug>
docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS $GATEDB;"
docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE $GATEDB;"

# 2. export it — an inline `VAR=x pnpm …` prefix does NOT survive a backgrounded call.
export JARVIS_PGDATABASE=$GATEDB

# 3. Run it in the BACKGROUND (the full gate exceeds the 10-minute foreground cap) and write a
#    marker you can grep, so the exit code cannot be lost or faked by a wrapper.
( pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "### FINAL verify:foundation rc=$?" >> /tmp/cb-vf.log ) &
( pnpm audit:release-hardening > /tmp/cb-audit.log 2>&1; echo "### FINAL audit rc=$?" >> /tmp/cb-audit.log ) &

# 4. Read the real result from the log — not from any wrapper's echo.
grep '### FINAL' /tmp/cb-vf.log /tmp/cb-audit.log
```
- **Never pipe a gate to `tail`/`grep` as the final stage** — a pipeline returns the *filter's*
  exit code and masks the failure. This is measured: 44% of gate invocations in one sampled run
  were piped, and a blocking PreToolUse hook (`.claude/hooks/check-gate-pipe.sh`) now denies them.
  A denial is the hook working; fix the command, don't route around it.
- **Never trust a wrapper `echo $?`** either — read `### FINAL` out of the log. That masked a real
  rc=1 during the #1270 recovery.
- **Don't run the gate while another agent is running theirs.** Concurrent `test:integration` has
  crashed the shared dev Postgres into recovery. Separate gate DBs prevent data collisions, not
  resource contention — if a sibling lane is mid-gate, wait or tell the coordinator.
- **Run the FULL suite**, not just your module — a shared-table/contract change can break other
  suites. If red, fix it (`superpowers:systematic-debugging`) before reporting done.
- This is *your* check so the PR isn't dead-on-arrival; the coordinator re-verifies independently
  via a QA agent (verify-never-trust). Don't treat your green as the final word.
- Drop the gate DB when you're done (`DROP DATABASE IF EXISTS $GATEDB;`) — unreaped gate DBs and
  UAT images have filled this box's disk before.

### 3. Pre-push fast checks + push + open the PR

Before pushing, run the cheap trio + a fresh rebase (catches most CI round-trips locally):
```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```
Then push and open the PR:
```bash
git push -u origin <your-branch>
gh pr create --base main --head <your-branch> \
  --title "<type>(<scope>): <spec> (#NN)" \
  --body "<scope shipped · spec link · VF_EXIT/AUDIT_EXIT evidence · what remains, if anything>"
```
Body states scope, the spec link, your verified gate result (exit codes), and anything deferred
(with where it's tracked). Open follow-up issues for deferred scope so it never silently vanishes.

### 3b. ⛔ Live-path proof — the real finish line for anything user-facing

If the PR adds or changes a **user-facing feature, module, or UI surface**, a green gate and an
open PR are *not* done. The PR needs a live end-to-end proof comment, and without it the
coordinator must refuse the merge — so produce it here, not after a rejection.

```bash
# Run the UAT spec(s) your diff triggers, capturing a real exit:
gh pr diff <PR> --name-only | .claude/skills/coordinate/resolve-uat-triggers.sh
( pnpm test:uat -- "<spec>" > /tmp/cb-uat.log 2>&1; echo "### FINAL test:uat rc=$?" >> /tmp/cb-uat.log ) &

gh pr comment <PR> --body "Live-path proof: <UAT run + rc, screenshots, what was clicked through>"
```
The proof must show the feature **exercised through the real UI on a live dev instance** — owner
signup → the real Settings/module path → the feature actually running. Screenshots land under
`test-results/…` (UAT config sets no `screenshot` option, so specs capture frames explicitly).

**A passing headless test alone is not the artifact** — it doesn't prove a person can reach the
path. If you can't produce the proof (no live instance, or a step that needs Ben in person), say
exactly that in the PR body and report the honest status: **code-complete, unverified**. Never
report it as done. Full rule: `docs/DEVELOPMENT_STANDARDS.md` → Live-Path Gate.

### 4. Report to the coordinator — then STOP

Report **terse and result-first** — lead with the outcome, no recap, no option survey, but in
normal English (caveman/telegraph style was removed from this family on 2026-07-27; it saved few
tokens and mangled the messages that need precision). The PR body stays conventional.

Via `herdr-pane-message` to your coordinator label:

> "<slug> DONE. PR: <link>. VF_EXIT=0 AUDIT_EXIT=0 (full suite, gate DB jarvis_gate_<slug>).
> Live-path: <proof comment posted | n/a, no user-facing surface | NOT MET — code-complete,
> unverified because <reason>>. Branch <b> pushed, rebased on origin/main as of <sha>.
> Deferred: <none | issue #NN>. Ready for QA + merge."

Then stop. **Do not** move the board, close the issue/milestone, or merge — the coordinator owns
QA, merge order, conflict resolution, and all GitHub bookkeeping.

### 5. Durable memory (only if you discovered something non-obvious)

If you hit a real trap or made a non-obvious decision, `memory_save` (`project: "jarv1s"`) now —
or tell the coordinator so it's captured. Don't store secrets.

## Red flags — STOP

- Claiming "green" from an exit code obtained through a pipe, or from a wrapper `echo $?` instead
  of the `### FINAL` line in the log.
- **Running the gate without `export JARVIS_PGDATABASE=<fresh gate DB>`** — you are writing to
  Ben's live dev instance.
- Moving the board / closing an issue / **merging** — not yours; report instead.
- Reporting "done" with a red or unrun full gate.
- **Reporting a user-facing PR "done" with no live-path proof comment** — the honest status is
  *code-complete, unverified*, and saying "done" instead is the failure the gate exists to stop.
- Letting deferred scope evaporate (no follow-up issue).

## Quick reference

| Need | Command |
| ---- | ------- |
| Clean tree (your paths) | `git status --porcelain` · `pnpm format` |
| Fresh gate DB | `docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS $GATEDB;"` then `CREATE DATABASE` · `export JARVIS_PGDATABASE=$GATEDB` |
| Gate (real exit) | background it, then `grep '### FINAL' /tmp/cb-vf.log` — never a pipe, never a wrapper `echo $?` |
| Pre-push trio + rebase | `pnpm format:check && pnpm lint && pnpm typecheck` · `git fetch origin main && git rebase origin/main` |
| Push + PR | `git push -u origin <b>` · `gh pr create --base main` |
| Live-path proof (UI-facing) | `resolve-uat-triggers.sh` → `pnpm test:uat -- <spec>` → `gh pr comment` with run + screenshots |
| Report done | `herdr-pane-message` → coordinator label (PR link + exit codes + live-path status) |

See also: `wrap-up` (the stock skill this scopes down), `coordinated-build`, `relay`.
