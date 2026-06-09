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

## Procedure

**0. Orient + guardrails.**
- Read your handoff doc and the spec it points at, IN FULL. Note your worktree/branch, the
  coordinator label, and any collision notes.
- `pnpm install` (fresh worktree). Confirm you are on your own branch, not `main`.
- Run the agentmemory required recalls from CLAUDE.md for the work you're doing (state, plus the
  row matching RLS / migrations / AccessContext / integration-test / frontend).
- Honor every CLAUDE.md **Hard Invariant**. Respect collision notes — **never assume a migration
  number**; the coordinator assigns landing order.

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

**3. Self-monitor context.** At ~**70%** of your window: message the coordinator that you're
relaying, then use the **`relay`** skill (commit work, write a continuation doc, spawn your
successor in this same worktree, request reap). Relay early enough to write a clean handoff.

**4. Close out with `coordinated-wrap-up`.** When the spec's Exit Criteria are met: invoke the
**`coordinated-wrap-up`** skill — clean tree, your own green gate, push, open PR, report the PR +
verified evidence to the coordinator. Then stop. The coordinator owns QA, merge, board, and close.

## Red flags — STOP

- About to **write code with no coordinator plan approval** → violates the gate. Message and wait.
- About to **assume a migration number** or change a shared table flagged in your collision notes
  → coordinate first; the coordinator serializes ordering.
- About to **decide a product/architecture fork** yourself → that's the coordinator's (or Ben's)
  call. Escalate.
- About to **move the board / close an issue / merge** → not yours. Report to the coordinator.
- About to push past ~70% context without relaying → you'll degrade and lose state. Relay now.

## Common mistakes

- **Going quiet on a blocker.** The coordinator can't unblock what it can't see. Escalate early.
- **Treating `git add -A` as safe.** Stage only your task's files — other sessions share the repo
  host (though you have your own worktree, keep the habit).
- **Doing the coordinator's closeout.** PR + report is your finish line; merge/board/milestone are not.

See also: `start` (the stock lifecycle this adapts), `coordinated-wrap-up`, `relay`,
`herdr-pane-message`, and CLAUDE.md (Hard Invariants, recalls).
