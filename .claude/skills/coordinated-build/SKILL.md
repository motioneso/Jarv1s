---
name: coordinated-build
description: Use when you are a BUILD AGENT spawned by a dev coordinator to implement one approved spec in your own worktree/branch. Derived from the `start` skill but adapted for coordination mode — plan approval comes from the COORDINATOR (not a human gate), you escalate via herdr-pane-message, you self-monitor context, and you never touch the board/milestone/merge. Triggered by your handoff doc.
---

# coordinated-build — implement one spec under a coordinator

## Overview

You were spawned by a **coordinator** with a committed **handoff doc** and an **approved spec**.
Your job: take that spec from plan → build → PR, escalating to the coordinator at each gate.
This is the `start` skill's plan+build stages adapted for coordination mode.

**Key differences from stock `start`:**
- The plan approval gate is the **coordinator**, not a human. You message it and wait.
- You **escalate** blockers / forks / reviews / done to the coordinator's **unique Herdr label**
  (from your handoff — e.g. `Coordinator`) via `herdr-pane-message` — you do not sit silently and
  you do not decide product/architecture forks. **Before messaging, run `herdr pane list` and
  confirm EXACTLY ONE pane holds that label.** If 0 or >1, do NOT guess a pane and do NOT message a
  different one — halt and wait (a mis-routed escalation once woke a stale duplicate coordinator).
  Never escalate by a raw `…-N` pane-id alone; those reflow when panes close.
- You **self-monitor context** and relay before you degrade.
- You **never** move the project board, close issues/milestones, or merge — those are the
  coordinator's. Your closeout is `coordinated-wrap-up` (PR + report), nothing more.
- **Communicate in caveman mode to save tokens.** For every status update, escalation, and report
  to the coordinator — and your own narration — drop articles, filler, and pleasantries; keep full
  technical accuracy (invoke the `caveman` skill if registered, else just write terse). EXCEPTION:
  commit messages, PR bodies, and code/comments keep their normal conventional form (they have
  readers and conventions). Terse to the coordinator; conventional in the artifacts.

## Procedure

**0. Orient + guardrails.**
- **Spawn-time env check (first).** Confirm you can resolve the skills you'll need
  (`coordinated-build` itself, `coordinated-wrap-up`, `relay`). If a skill does NOT resolve by name
  in your spawn environment, use the **absolute build-skill path** from your handoff doc and follow
  it directly — don't silently proceed half-equipped.
- Read your handoff doc and the spec it points at, IN FULL. Note your worktree/branch, the
  coordinator label, your **risk tier**, and any collision notes. A `security`-tier spec ships to a
  higher bar (cross-model QA + Ben merge sign-off) — build defensively and document trust boundaries.
- **Install only if needed:** `[ -d node_modules ] || pnpm install`. Worktrees share the pnpm
  store; if `node_modules` already exists (e.g. you're a relay successor), don't re-install.
  Confirm you are on your own branch, not `main`.
- Run the agentmemory required recalls from CLAUDE.md for the work you're doing (state, plus the
  row matching RLS / migrations / AccessContext / integration-test / frontend).
- Honor every CLAUDE.md **Hard Invariant**. Respect collision notes — **never assume a migration
  number**; the coordinator assigns landing order.

**½. Verify the spec against the actual branch (before planning).**
- Specs go stale. Related work lands between spec-authoring and your build, and the spec's premises
  (line numbers, "X doesn't exist yet", "add Y") may no longer hold. **Verify before you plan — don't
  inherit a stale spec.**
- For each spec item, grep/read the cited files on YOUR branch and confirm the gap or state the spec
  describes is still real. Specifically check:
  - "X doesn't exist" claims → grep for X; confirm it's still absent.
  - "Add Y" / "Change Z" claims → confirm Y is absent and Z is in the described state.
  - Cited line numbers / function names → confirm they still match (or note the drift).
- **If any spec item's premise has already shipped or drifted**, do NOT silently absorb it into your
  plan. **Escalate to the coordinator** with: which items are already done / stale, what the current
  branch state actually is, and your re-scoped plan reflecting reality. Let the coordinator confirm
  the re-scope before you proceed. (Proven necessary: 2026-06-24, #456 — spec written against pre-`202c638b`
  state, 3 of 5 items already shipped in intermediate commits; the build agent caught it by grounding
  in the branch, saving a rework cycle. Make that standard, not luck.)
- Only when every spec item's premise is verified current do you proceed to step 1 (plan).

**1. Plan — then escalate for approval.**
- **REQUIRED SUB-SKILL:** `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`
  (bite-sized TDD tasks, exact files, green per commit). Read the spec with fresh eyes; verify
  coverage of its Exit Criteria.
- **Message the coordinator** (label from your handoff doc) via `herdr-pane-message`: "plan ready
  for <slug>: <path>. Approve, or flag a fork." **STOP and wait** — do not write code.
- If the plan surfaces a genuine product/architecture fork the spec didn't settle, say so in the
  message; the coordinator routes it. If the coordinator approves, proceed.

**2. Build (only after coordinator approval).**
- Execute the plan with **`superpowers:test-driven-development`**. Each task commits green with
  the `Co-Authored-By: Claude` trailer; `git add` only that task's files.
- The superpowers *execution* skills (`executing-plans`, `subagent-driven-development`) are
  disabled in this repo by design — drive the plan yourself, task by task.
- **Escalate immediately** (don't burn turns spinning) if you hit a real blocker — a failing
  invariant, an ambiguous requirement, a missing dependency, a flaky gate you can't resolve.
  Message the coordinator with the specific question.

**3. Self-monitor context on countable events.** Relay at **~80–100k tokens**, or **immediately**
if you see a compaction summary in your own context (don't trust felt %). Message the coordinator
that you're relaying, then use the **`relay`** skill (commit work, write a continuation doc, spawn
your successor in this same worktree, request reap). Relay early enough to write a clean handoff.

**3b. Pre-push fast checks (before EVERY push).** Cheap trio + fresh rebase catch most CI
round-trips locally:
```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```
Fix anything red before pushing. This is in addition to your full gate at wrap-up.

**4. Close out with `coordinated-wrap-up`.** When the spec's Exit Criteria are met: invoke the
**`coordinated-wrap-up`** skill — clean tree, your own gate, push (after the pre-push trio), open
PR, report the PR + verified evidence to the coordinator. Then stop. The coordinator owns QA,
merge, board, and close.

## Red flags — STOP

- About to **write code with no coordinator plan approval** → violates the gate. Message and wait.
- About to **assume a migration number** or change a shared table flagged in your collision notes
  → coordinate first; the coordinator serializes ordering.
- About to **decide a product/architecture fork** yourself → that's the coordinator's (or Ben's)
  call. Escalate.
- About to **move the board / close an issue / merge** → not yours. Report to the coordinator.
- About to push past your relay threshold (~80–100k / compaction summary seen) without relaying →
  you'll degrade and lose state. Relay now.
- About to push **without the pre-push trio** (`format:check && lint && typecheck`) + fresh rebase →
  you'll burn a CI round-trip. Run them first.

## Common mistakes

- **Going quiet on a blocker.** The coordinator can't unblock what it can't see. Escalate early.
- **Treating `git add -A` as safe.** Stage only your task's files — other sessions share the repo
  host (though you have your own worktree, keep the habit).
- **Doing the coordinator's closeout.** PR + report is your finish line; merge/board/milestone are not.

See also: `start` (the stock lifecycle this adapts), `coordinated-wrap-up`, `relay`,
`herdr-pane-message`, and CLAUDE.md (Hard Invariants, recalls).
