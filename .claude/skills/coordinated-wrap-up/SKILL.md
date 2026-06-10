---
name: coordinated-wrap-up
description: Use when you are a BUILD AGENT under a dev coordinator and your spec's work is done — close out YOUR slice only. Derived from the `wrap-up` skill but scoped down: clean tree, your own green gate, push your branch, open the PR, then report the PR + verified evidence to the coordinator. You do NOT touch the board, milestones, or merge — those are the coordinator's.
---

# coordinated-wrap-up — close out your slice and hand it to the coordinator

## Overview

The stock `wrap-up` closes out a whole session including board/milestone/merge bookkeeping. Under
a coordinator, **that bookkeeping is the coordinator's, not yours.** Your finish line is a green,
pushed branch with an open PR and a truthful report to the coordinator. It then runs QA, merges,
and updates GitHub.

**Announce:** "Using coordinated-wrap-up to close out my slice." TodoWrite one item per step.

## Procedure

### 1. Clean tree — your files only

```bash
git status --porcelain
```
Commit your remaining green work by **explicit path** (`Co-Authored-By: Claude Sonnet 4.6`). If a
linter/Prettier reformatted files, `pnpm format` then commit — `format:check` is part of the gate.
You have your own worktree, but still stage by path; never `git add -A` reflexively.

### 2. Your own green gate — verified, not assumed

```bash
pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "VF_EXIT=$?"
pnpm audit:release-hardening > /tmp/cb-audit.log 2>&1; echo "AUDIT_EXIT=$?"
```
- **Never pipe a gate to `tail`/`grep` as the final stage** — you'd capture the filter's exit
  code and mask a failure. Redirect to a file, capture `$?`, read the exit code AND the summary.
- **Run the FULL suite**, not just your module — a shared-table/contract change can break other
  suites. If red, fix it (`superpowers:systematic-debugging`) before reporting done.
- This is *your* check so the PR isn't dead-on-arrival; the coordinator re-verifies independently
  via a QA agent (verify-never-trust). Don't treat your green as the final word.

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

### 4. Report to the coordinator — then STOP

Report in **caveman mode** (terse — drop filler/articles/pleasantries, keep full technical accuracy)
to save tokens. The PR body itself stays normal/conventional (it has human readers).

Via `herdr-pane-message` to your coordinator label:

> "<slug> DONE. PR: <link>. VF_EXIT=0 AUDIT_EXIT=0 (full suite). Branch <b> pushed, rebased on
> origin/main as of <sha>. Deferred: <none | issue #NN>. Ready for QA + merge."

Then stop. **Do not** move the board, close the issue/milestone, or merge — the coordinator owns
QA, merge order, conflict resolution, and all GitHub bookkeeping.

### 5. Durable memory (only if you discovered something non-obvious)

If you hit a real trap or made a non-obvious decision, `memory_save` (`project: "jarv1s"`) now —
or tell the coordinator so it's captured. Don't store secrets.

## Red flags — STOP

- Claiming "green" from an exit code obtained through a pipe.
- Moving the board / closing an issue / **merging** — not yours; report instead.
- Reporting "done" with a red or unrun full gate.
- Letting deferred scope evaporate (no follow-up issue).

## Quick reference

| Need | Command |
| ---- | ------- |
| Clean tree (your paths) | `git status --porcelain` · `pnpm format` |
| Gate (real exit) | `pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "EXIT=$?"` then audit |
| Pre-push trio + rebase | `pnpm format:check && pnpm lint && pnpm typecheck` · `git fetch origin main && git rebase origin/main` |
| Push + PR | `git push -u origin <b>` · `gh pr create --base main` |
| Report done | `herdr-pane-message` → coordinator label (PR link + exit codes) |

See also: `wrap-up` (the stock skill this scopes down), `coordinated-build`, `relay`.
