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

## When to relay — countable events, not a felt %

Self-perceived context % is known-unreliable, so trigger on things you can **count or see**:

- **Anyone — context-meter warning (primary):** the user-level PostToolUse meter warns at **70%**
  (self-calibrating, fires in every session on this box). First warning = relay now.
- **Coordinator — merge counter:** additionally relay after **every security-tier merge** and
  after **every 2 routine/sensitive merges**, whichever fires first.
- **Either — compaction tripwire:** the instant you see a **compaction summary** in your own
  context (the harness compacted your prior messages), you are already past safe. Relay
  **immediately**. **Coordinator: merge nothing first** — flush the manifest and hand off before
  any further merge, or you risk merging on degraded judgement.

**Relay early, not at 99%** — you need enough headroom to write a clean continuation doc. The moment
a trigger fires, message the coordinator that you are relaying, *then* do it.

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

**2. Spawn your successor with `herdr-handoff`.** A fresh session in the appropriate place. The
successor **skips `pnpm install`** — `node_modules` already exists in the reused worktree (shared
pnpm store); re-installing is wasted time/tokens. Bootstrap should say `[ -d node_modules ] || pnpm install`.

**⚠️ Always pass `--tab <your-own-tab_id>` on the spawn command.** `herdr agent start` without
`--tab`/`--split` **auto-places into any free pane** — which can land the successor in a totally
unrelated tab (someone's Codex/review tab, a scratch tab) instead of the tab it belongs in.
Resolve your own `tab_id` from `herdr pane list` (find your own `pane_id`'s entry) and pass it
explicitly, e.g. `herdr agent start "<Label>" --tab <your-own-tab_id> --cwd <path> --no-focus -- claude --model sonnet ...`.
- **Build agent:** your successor must land in the **same agents tab you're in** — pass your own
  current `tab_id`.
- **Coordinator:** your successor must land in the **same tab as your own coordinator pane, never
  the agents tab** — pass your own current `tab_id`.

See incidents.md for a real case where a build agent's relay successor landed in a stray tab
because `--tab` was omitted; the coordinator had to `herdr pane move` it back afterward.

Use unattended full-access launch permissions for coordinator relays — and **always pass the
model explicitly**: `herdr … -- claude` boots **Opus** by default (cost policy is Sonnet for
build agents and coordinator loops; confirm the new pane says "Sonnet", respawn if not):
- Claude coordinator: `claude --model sonnet --permission-mode bypassPermissions`
- Codex coordinator: `codex -s danger-full-access -a never`

Do **not** spawn a Codex coordinator with the default, `read-only`, or `workspace-write` sandbox.
The coordinator must be able to update/push the manifest, run Herdr pane operations, and run local
verification without approval prompts.
- **Build agent:** same worktree/branch (your work continues there), bootstrap = "continue
  <slug>; `[ -d node_modules ] || pnpm install`; read `docs/.../<slug>-relay.md` IN FULL and resume
  via `coordinated-build`."
- **Coordinator:** new pane; bootstrap = "you are the new coordinator for run <run-id>; read
  `docs/coordination/<run-id>.md` IN FULL, invoke `coordinate`, re-confirm the **session-id
  authority line** (your own pane's `agent_session.value` from `herdr pane list` — session id is
  authority; label is routing; the `…-N` pane number is ephemeral and reflows), re-adopt the live
  fleet (`herdr pane list` + labels), confirm you are driving, then reap the old coordinator —
  **resolving it fresh by label + session id, never by a `…-N` number written in this doc**." (No
  `pnpm install` — the coordinator pane doesn't build.)

  **⚠️ Never bake a `…-N` pane number into the bootstrap or the doc as a reap/address target.** Pane
  numbers reflow the instant any pane opens or closes, so a number written here is very likely stale
  by the time the successor reads it — it can point at an unrelated live session (a real near-miss:
  a baked-in reap number had become the user's chat pane). Identify panes by **label + session id**
  and have the successor resolve the number at read time.

**3. Verify the successor is actually driving** before you go (`herdr pane read <pane> --source recent --lines 12` — it
should be reading the doc / re-adopting, not stuck on a trust prompt). Answer any prompt with
`herdr pane send-keys <pane> Enter`.

**4. Request reap.** Tell whoever reaps you:
- **Build agent:** message the **coordinator** "relayed to <successor pane/label>, safe to reap me."
  The coordinator kills your pane.
- **Coordinator:** the **successor** kills your old pane once it confirms it's driving — it
  **resolves your pane fresh by label + session id and verifies the session id before closing**
  (never a bare `…-N` number from the bootstrap — it reflows). That instruction is in its bootstrap.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Flush build state | commit work + write `docs/superpowers/handoffs/<date>-<slug>-relay.md` |
| Flush coordinator state | update + commit `docs/coordination/<run-id>.md` |
| Spawn successor | `herdr-handoff` skill; always `--model sonnet` for claude spawns; coordinator relays use `claude --model sonnet --permission-mode bypassPermissions` or `codex -s danger-full-access -a never` |
| Confirm it's driving | `herdr pane read <pane> --source recent --lines 12` |
| Reap a spent pane | resolve target fresh by label + session id, verify session id, then close (never a baked `…-N` number) |

## Common mistakes

- **Relaying with state still in your head.** If it isn't committed/written, the successor can't
  see it. Durable doc FIRST, spawn SECOND.
- **Relaying too late.** If you wait for felt degradation you can't write a clean continuation.
  Relay on the countable trigger (meter 70% warning / merge counter / compaction summary seen).
- **Re-running `pnpm install` in the successor.** The worktree already has `node_modules` — guard it.
- **Walking away before the successor is confirmed driving.** Always `herdr pane read <pane> --source recent --lines 12` it first.
- **Two sessions live on the same work.** The reap must happen — don't leave the spent session
  running alongside its successor.
- **Reaping by a stale pane number.** Pane `…-N` numbers reflow on every open/close, so a number
  baked into a doc/bootstrap is likely pointing somewhere else by read time (a baked-in reap target
  once became the user's chat pane). Before any `herdr pane close`, resolve the target fresh by
  **label + session id** and confirm the session id matches what you intend to kill.
