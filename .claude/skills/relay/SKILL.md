---
name: relay
description: Use when YOU (a build agent or the coordinator) are approaching your context limit and must continue the SAME work in a fresh session — flush state to a durable doc, spawn a successor with herdr-handoff, and let the coordinator reap you. This is a self-handoff to continue your own work; to start a DIFFERENT new agent use herdr-handoff, to message a running agent use herdr-pane-message.
---

# relay — hand your own work to a fresh session before you degrade

## Overview

A long-running session loses efficiency as context fills (compaction, slower, sloppier). Rather
than degrade in place, **relay**: capture everything the next session needs into a durable doc,
spawn a fresh successor pointed at it, confirm the successor is driving, then have the spent
session reaped. Used by **both** build agents (continuing one spec) and the **coordinator**
(continuing the whole run).

This is a self-handoff of YOUR work. Distinct from:
- `herdr-handoff` — start a *different* new agent on a new task (relay calls this primitive).
- `herdr-pane-message` — message an *already-running* agent.

## When to relay

At ~**70%** of your context window (the coordinated threshold), or whenever you can feel
degradation. **Relay early, not at 99%** — you need enough headroom to write a clean continuation
doc. The moment you cross the threshold, message the coordinator that you are relaying, *then* do it.

## Steps

**1. Bring the durable state fully current FIRST.** Everything the successor needs must live on
disk, not in your context:
- **Build agent:** commit your green work; write/update a continuation doc
  `docs/superpowers/handoffs/<date>-<slug>-relay.md` covering: spec link, branch/worktree, what's
  done (commits), what's left (next concrete steps), any in-flight decisions, the coordinator
  label + threshold. Commit it.
- **Coordinator:** flush the **run manifest** (`docs/coordination/<run-id>.md`) — every agent's
  status/pane/branch/PR, merge order, outstanding escalations. Commit it. Add a one-line
  continuation note (what you were mid-doing).

**2. Spawn your successor with `herdr-handoff`.** A fresh session in the appropriate place:
- **Build agent:** same worktree/branch (your work continues there), bootstrap = "continue
  <slug>; read `docs/.../<slug>-relay.md` IN FULL and resume via `coordinated-build`."
- **Coordinator:** new pane; bootstrap = "you are the new coordinator for run <run-id>; read
  `docs/coordination/<run-id>.md` IN FULL, invoke `coordinate`, re-adopt the live fleet
  (`herdr pane list` + labels), confirm you are driving, then reap the old coordinator pane."

**3. Verify the successor is actually driving** before you go (`herdr pane read <pane>` — it
should be reading the doc / re-adopting, not stuck on a trust prompt). Answer any prompt with
`herdr pane send-keys <pane> Enter`.

**4. Request reap.** Tell whoever reaps you:
- **Build agent:** message the **coordinator** "relayed to <successor pane/label>, safe to reap me."
  The coordinator kills your pane.
- **Coordinator:** the **successor** kills your old pane once it confirms it's driving
  (`herdr pane` close/kill on your old pane id) — that instruction is in its bootstrap.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Flush build state | commit work + write `docs/superpowers/handoffs/<date>-<slug>-relay.md` |
| Flush coordinator state | update + commit `docs/coordination/<run-id>.md` |
| Spawn successor | `herdr-handoff` skill |
| Confirm it's driving | `herdr pane read <pane> --source visible --lines 20` |
| Reap a spent pane | coordinator kills build agents; successor coordinator kills old coordinator |

## Common mistakes

- **Relaying with state still in your head.** If it isn't committed/written, the successor can't
  see it. Durable doc FIRST, spawn SECOND.
- **Relaying too late.** At 95% you can't write a clean continuation. Relay at the threshold.
- **Walking away before the successor is confirmed driving.** Always `herdr pane read` it first.
- **Two sessions live on the same work.** The reap must happen — don't leave the spent session
  running alongside its successor.
