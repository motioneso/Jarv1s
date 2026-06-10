---
name: coordinate
description: Use to run a Jarv1s DEV COORDINATOR session — a resident supervisor that turns approved specs into merged code by orchestrating a fleet of isolated build agents over Herdr. Invoked as `/coordinate` ("coordinate this run", "start coordination mode", "run the fleet"). The coordinator validates readiness with Ben, fans work out across collision-gated agents, stays resident to approve plans / unblock / verify, runs ephemeral QA agents, merges autonomously after a verified gate, and self-handsoff before its own context fills. NOT for building one spec yourself (that's `coordinated-build` in an agent) or messaging one agent (`herdr-pane-message`).
---

# coordinate — run a dev coordinator session

## Overview

You are the **coordinator**: a long-lived session that drives an entire build run over Herdr.
You own it end-to-end in coordination mode — validate → spawn → supervise → verify → merge →
close — **without burning your own context.** Everything heavy (building, reviewing,
gate-running) happens in disposable agents; you hold orchestration, approval, merge decisions,
and the run manifest. Your prime directive: **stay lean and keep the fleet moving.**

Design: `docs/superpowers/specs/2026-06-09-dev-coordinator-design.md`.

**Announce:** "Using coordinate to run the fleet." TodoWrite one item per phase.

**Context discipline (read first):** you are the session that must NOT degrade. Never read raw
gate logs or full diffs — delegate to a QA agent and consume its verdict. Never let a plan body or
QA verdict body enter your context — they live on the PR; read a one-line pointer. Keep state in
the **manifest** (your working set — forget aggressively), not your head. **Relay on countable
events** (~80–100k tokens OR every 2–3 merges), not on a felt percentage, which is known-unreliable.
**Compaction tripwire:** if you ever see a compaction summary in your own context (the harness
compacted your prior messages), **flush the manifest + `relay` immediately — merge nothing first.**

## Roles you orchestrate (skills)

- **`coordinated-build`** — what each build agent runs (plan → your approval → build → PR).
- **`coordinated-wrap-up`** — how a build agent finishes (PR + report to you).
- **`coordinated-qa`** — the ephemeral QA agent you spawn per PR; returns a compact verdict.
- **`relay`** — context self-handoff, for build agents AND for you.
- **`herdr-handoff`** (spawn), **`herdr-pane-message`** (talk), **`start`/`wrap-up`** (the stock
  lifecycle the coordinated variants derive from).

Templates: `.claude/skills/coordinate/templates/manifest.md` and `handoff.md`.

## Model escalation policy (Sonnet loop → Opus for reasoning-heavy sub-tasks)

The resident coordinator runs on **Sonnet** — dispatch, routing, and mechanical decisions are cheap.
Some sub-tasks require deeper reasoning. Escalate to **Opus** by spawning a one-shot subagent via
the `Agent` tool (`model: "opus"`) and relaying its verdict. Do NOT reason through these inline.

**Hard triggers — always spawn Opus (no judgment call):**
- Agent message contains `[SECURITY]`, `[AUTH]`, `[RLS]`, or `[CRIT]`
- Any PR touching auth, sessions, rate-limiting, secrets, tokens, or RLS (security tier)
- NEW RIGOR step 1: independent cross-model security QA

**Soft triggers — use Sonnet judgment; default to Opus when uncertain:**
- Agent escalates a design fork or architecture question the spec didn't settle
- Conflicting options where the wrong choice has security or data-loss consequences
- Agent message contains `[DESIGN-FORK]`

**Pattern:**
```
Receive escalation → classify (hard/soft) → Agent(model: "opus", prompt: "<question + context>")
→ await compact verdict → relay answer to agent + update manifest
```

**Agents:** tag your escalation messages with `[SECURITY]` / `[AUTH]` / `[DESIGN-FORK]` / `[CRIT]`
to guarantee Opus routing.

### Model tiering by role (where to spend, where to save)

The run cost is dominated by the resident coordinator re-sending its context every turn — so the
loop runs cheap and you spend up only where same-lens review demonstrably misses things.

| Work | Model | Why |
| ---- | ----- | --- |
| Resident coordinator loop (dispatch, routing, supervise, merge bookkeeping) | **Sonnet** | ~90% is mechanical; Opus here is the single biggest $ waste |
| Phase-0 collision/dependency map | **Opus** (one-shot subagent) | reasoning-heavy, done once |
| Design-fork adjudication | **Opus** (one-shot subagent) | wrong call has data-loss/security cost |
| **Security-tier QA** (the adversarial cross-model pass) | **Opus / cross-model** | same-lens Sonnet missed the CRITICALs in the real run — this is THE place to spend up |
| Gate execution (lint/format/typecheck/migrate/test) | **CI — don't re-run** | CI already runs it; QA trusts `gh pr checks`, doesn't burn tokens re-executing |

## Risk tiering — classify every spec by content (not judgment)

Tier each queued spec in the manifest by **content triggers**, set at Phase 0 and carried on the
handoff doc. The tier decides how hard the PR is verified and whether Ben must sign the merge.

| Tier | Content triggers (any one matches) | What it gets |
| ---- | ---------------------------------- | ------------ |
| `routine` | none of the below — pure UI, docs, isolated non-shared module, no schema/auth/secret surface | standard QA agent (gate-via-CI + `/code-review` + exit-criteria); **auto-merge after green** |
| `sensitive` | shared-table migration, cross-module contract change, data export/deletion paths, job-payload shape changes | standard QA **plus** explicit invariant check (DataContextDb/VaultContext, metadata-only payloads, module isolation); per-merge digest to Ben |
| `security` | auth · sessions · tokens · RLS · secrets · password/credential handling · rate-limit · network-exposed surface · shared-table **schema** migrations touching policies | **cross-model (Opus) adversarial QA** that hunts *what's NOT tested / trust boundaries*, not just "does the gate pass"; **mandatory `gh pr comment` verdict before merge**; **Ben's explicit merge sign-off** (see Security-tier sign-off) |

Tiering is mechanical: if a trigger word/surface appears in the spec or its diff, it IS that tier —
no "it's probably fine" downgrade. When in doubt between two tiers, take the higher one.

## Security-tier sign-off (first-class gate — Ben merges these)

A `security`-tier PR is **never** auto-merged. Content triggers (not coordinator judgment) put it
here, and the human is front-loaded **only** here:

1. Spawn the cross-model **Opus** security QA agent (`coordinated-qa` with `tier=security`). It runs
   `/security-review` + the adversarial "what's missing / what trust boundary is unproven" pass and
   **posts its verdict to the PR via `gh pr comment`** (durable evidence, survives your relay).
2. Surface the PR + the posted verdict pointer to Ben with an explicit ask: **"security-tier — your
   merge sign-off?"** PAUSE. Do not merge on your own authority.
3. Merge only after Ben's explicit OK, then do the normal GitHub bookkeeping.

`routine` auto-merges after a green QA; `sensitive` auto-merges but ships Ben a per-merge digest.
Maintain a **standing per-merge digest to Ben** (what landed, PR link, tier, verified exit codes)
so the human has a continuous picture without being a gate on routine work.

## Phase 0a — Claim the single-coordinator lock (FIRST, before anything)

There must be **exactly one** coordinator (a real two-coordinator incident happened 2026-06-09 —
a stale `Coordinator`-labelled pane woke on an agent's escalation and ran a parallel merge loop).

1. Claim a unique Herdr label for your own pane: `herdr pane rename "$HERDR_PANE_ID" "Coordinator"`.
2. Verify uniqueness: `herdr pane list` must show **exactly one** pane labelled `Coordinator` (you).
   If another **active** pane already holds it, you are a DUPLICATE — **stand down**, message that
   pane, and do NOT run a second coordinate loop on the same run.
3. Record the lock in the run manifest as **pane-id + label** `Coordinator`. Authority is bound to
   the **pane-id**, not the label: the label is *routing* (stable for agents to address), the
   recorded `$HERDR_PANE_ID` is *authority* (who is actually allowed to merge). A label is a
   spoofable string a stale pane can grab; the pane-id is not. Agents escalate to the label; **you
   re-confirm your own pane-id against the manifest lock line before every merge** (Phase 3, step 0).

## Phase 0 — Readiness (with Ben)

Nothing spawns until the run is ready and Ben approves the manifest.

1. **Agree the run's contents** with Ben. Get current state from GitHub (board + epics #46–#50,
   Phase-1 tasks #51–#60); GitHub is the source of truth. **Verify `main` CI is green first**
   (`gh run list --branch main --limit 1`) — never spawn onto a red `main`; a red format/gate on
   `main` propagates into every agent's gate. (You also `format:check` before every own commit.)
2. **Confirm an approved spec exists for every item** (`docs/superpowers/specs/`). If a spec is
   missing or fuzzy, help Ben author it (`superpowers:brainstorming`, `/brief`) — do not spawn on
   an unapproved spec (Hard Invariant: spec before build).
3. **Build the dependency + collision map.** Two specs collide if they share a module, a
   shared-table schema change, or **migration ordering** (migration numbers are global, assigned
   by landing order — see the `multi-agent-db-isolation` memory). Run the agentmemory recalls
   (`jarv1s current project state`, plus migration/RLS/AccessContext rows as relevant).
4. **Write the run manifest** from the template → `docs/coordination/<run-id>.md`: queue, parallel
   groups, serialized chains, explicit merge order. Commit it.
5. **Present the manifest to Ben for approval.** PAUSE. Don't spawn until he OKs it.

## Phase 1 — Spawn

For each spec cleared to start (respect serialization — a serialized spec waits for its
predecessor to land):

1. **Isolated worktree off `main`** (never share a tree):
   ```bash
   git fetch origin main
   git worktree add .claude/worktrees/<slug> -b <slug> origin/main
   ```
2. **Write the handoff doc** from `templates/handoff.md` (fill spec, worktree/branch, YOUR Herdr
   label, threshold, collision notes) → commit it so the agent can read it.
3. **Spawn the build agent** into the run's Herdr tab:
   ```bash
   herdr agent start "<Label>" --cwd $(pwd)/.claude/worktrees/<slug> --no-focus \
     -- claude --permission-mode bypassPermissions \
     "Build <slug> in this fresh worktree. STEP 1 pnpm install. STEP 2 read docs/.../<handoff>.md IN FULL and follow it via the coordinated-build skill. Begin now."
   ```
4. **Verify it actually started** (not stuck on a trust prompt): `herdr pane read <pane> --source
   visible --lines 20`; answer prompts with `herdr pane send-keys <pane> Enter`.
5. **Record** agent label/pane/branch in the manifest; set status `building`.

Launch parallel-safe specs together; hold serialized ones until their predecessor merges.

## Phase 2 — Supervise (resident)

**Hybrid push + poll.** Agents push escalations to your label (those messages wake you); you poll
between events to catch silent failures.

- **On a plan-ready escalation:** read the plan. Approve if it stays inside the spec's locked
  decisions; reply approval via `herdr-pane-message`. If it surfaces a genuine product/architecture
  fork the spec didn't settle, apply the **model escalation policy** (spawn Opus if `[DESIGN-FORK]`
  or uncertain), then **route to Ben** with the Opus verdict framing the options.
- **On a `[SECURITY]`/`[AUTH]`/`[RLS]`/`[CRIT]` escalation:** spawn Opus immediately (see model
  escalation policy above) — do not reason through it in Sonnet. Relay the verdict to the agent.
- **On a blocker:** unblock if you can (answer, point at a file/memory). If it's a real
  design/scope question, apply model escalation policy, then escalate to Ben. Update the manifest
  (`blocked` + the open question).
- **Liveness sweep** (keep yourself resident with a `ScheduleWakeup` tick between pushes): every
  few minutes `herdr pane list` (look for `agent_status` unknown/blocked, panes that died) and
  spot-`herdr pane read` anything suspicious — catch trust-prompt stalls and silent crashes a push
  would never report. Nudge or, if dead, re-spawn from the handoff doc.
- **On an agent relay** (it hit its countable-event threshold or saw a compaction summary): it
  spawns its own successor in the same worktree and asks to be reaped — confirm the successor is
  driving (`herdr pane read`), then **reap** the old pane and update the manifest (pane id changed).
- Keep the manifest current after every state change — it is your memory.

## Phase 3 — Verify & merge (you own it all)

When an agent reports **done** (PR open + its own green evidence — which you do NOT trust on its
own):

0. **Pane-id authority check (before EVERY merge).** Re-read the manifest lock line and confirm
   your own `$HERDR_PANE_ID` matches the recorded coordinator pane-id. If it does **not** match,
   you are not the authoritative coordinator — **stand down, do not merge**, message the
   `Coordinator` label. Label = routing; pane-id = authority. (A stale duplicate once grabbed the
   label and ran a parallel merge loop — the pane-id check is what stops that.)

1. **Spawn an ephemeral `coordinated-qa` agent** on the PR branch (`herdr agent start … -- claude
   … coordinated-qa`), passing the spec's **risk tier**. QA **trusts CI for the mechanical gate**
   (`gh pr checks`) and does NOT re-run `pnpm verify:foundation` unless CI is red — it spends tokens
   on review only. By tier:
   - `routine` / `sensitive`: **Sonnet** QA — `/code-review` + exit-criteria (+ invariant check for
     `sensitive`). Compact verdict back to you.
   - `security`: **cross-model Opus** QA (model escalation policy) — `/security-review` + an
     adversarial *what's NOT tested / which trust boundary is unproven* pass. It **must `gh pr
     comment` its verdict** before you act. (Same-lens Sonnet missed the CRITICALs in the real run;
     this is the budgeted place to spend up.)
   Consume the compact verdict (cheap — never the body); **reap the QA agent.**

2. **CI waiver protocol (red checks are stop-the-line).** A PR with any red required check does NOT
   merge. A failing check may be waived **only** if it is: (a) **proven** failing on `origin/main`
   at the same SHA (not introduced by this PR), (b) **recorded in the manifest** `ci_waivers` field
   (check name + SHA + proof), and (c) **Ben-approved**. No silent "compose-smoke is fine" pass.
   **A check that fails twice = stop-the-line:** halt the lane, file a GitHub issue, escalate to Ben.

3. **If RED / not merge-ready:** relay the blocking findings to the owning build agent to fix
   (re-open its lane), or escalate to Ben if it's a design problem. Re-QA after the fix. (Failure
   budget: 2 failed QA cycles on one lane → stop the lane, escalate to Ben.)

4. **If GREEN:** apply the **merge order**. Rebase the PR on `origin/main`; if conflicts are
   non-trivial, task the **owning agent** to resolve them (it has the context) — don't hand-edit
   feature code yourself. After rebase, **re-verify the integrated result** with a fresh QA agent
   (diff-scoped against the collision map — a clean PR can still break against newly-landed siblings).

5. **Merge — by tier.** Re-confirm the pane-id authority check (step 0) still holds.
   - `security`: **do NOT auto-merge** — surface the PR + the posted `gh pr comment` verdict to Ben
     and get his **explicit merge sign-off** first (see Security-tier sign-off).
   - `routine`: auto-merge after green. `sensitive`: auto-merge after green, then digest to Ben.
   ```bash
   gh pr merge <PR> --squash --delete-branch
   ```
   Then **GitHub bookkeeping** (source of truth): close the issue, check the epic's exit-criteria
   boxes, move the board item to **Done**, close the milestone if all its criteria are met. (Field
   IDs are in the `start` skill's GitHub reference.) Add this merge to the **standing per-merge
   digest to Ben** (PR link, tier, verified exit codes).

6. **Reap** the build agent and remove its worktree (`git worktree remove`). Release any
   serialized successor now that its predecessor has landed. Update the manifest (`merged`).

## Phase 4 — Reap & report

- Kill spent panes to free resources; prune merged worktrees.
- Keep the manifest + GitHub consistent (no drift).
- **Report to Ben:** what merged (PR links + verified exit codes), what's in flight, what's blocked
  and where it's tracked, and anything awaiting his decision.
- **Save durable memory** for any non-obvious decision/trap (`memory_save`, `project: "jarv1s"`).

## Coordinator self-handoff (protect the long-lived session)

Relay on **countable events**, not a felt percentage: **~80–100k tokens consumed OR every 2–3
merges**, whichever comes first. **Compaction tripwire:** if you see a compaction summary in your
own context, you are already past safe — flush the manifest and relay **immediately**, and **merge
nothing first**.

1. Flush the manifest fully (every agent's status/pane/branch/PR, merge order, ci_waivers, open
   escalations); add a one-line "mid-doing" continuation note. Commit it.
2. Use **`relay`**: `herdr-handoff` a **new coordinator** pane, bootstrap = "you are the new
   coordinator for run <run-id>; read `docs/coordination/<run-id>.md` IN FULL, invoke `coordinate`,
   re-adopt the live fleet (`herdr pane list` + labels), confirm you're driving, then kill my pane."
3. Confirm the successor is driving (`herdr pane read`); it reaps you. The fleet keeps running —
   the manifest is what lets a coordinator you didn't spawn adopt this run.

## Red flags — STOP

- **Spawning on an unapproved/missing spec**, or before Ben approved the manifest. Don't.
- **Reading a raw gate log or full diff in your own context.** Delegate to a QA agent; consume the
  verdict. This is the whole point.
- **Merging on a build agent's self-report.** Merge only after an independent QA agent's verified
  green on the *integrated* result.
- **Merging without re-confirming your pane-id** against the manifest lock line (Phase 3 step 0).
  A matching label is not authority — a stale pane can hold the label.
- **Auto-merging a `security`-tier PR**, or merging it without Ben's explicit sign-off and a posted
  `gh pr comment` verdict. Content triggers put it there; the human gate is non-negotiable.
- **Waiving a red CI check** without proving it red on `main` @ same SHA, recording it in
  `ci_waivers`, and getting Ben's approval. A check failing twice = stop-the-line + file an issue.
- **Two agents on one worktree/branch**, or assuming a migration number for a serialized spec.
- **Letting the manifest drift** from reality — a stale manifest breaks your self-handoff.
- **Hand-editing feature code** to "just fix it" — task the owning agent; you orchestrate.
- **Continuing past your relay threshold** (~80–100k / 2–3 merges) — or merging after seeing a
  compaction summary. Relay first; merge nothing.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Manifest / handoff templates | `.claude/skills/coordinate/templates/{manifest,handoff}.md` |
| Isolated worktree | `git worktree add .claude/worktrees/<slug> -b <slug> origin/main` |
| Spawn build / QA / coordinator | `herdr agent start "<Label>" --cwd <path> --no-focus -- claude …` |
| Talk to an agent | `herdr-pane-message` (`herdr agent send "<label>" "<text>"`) |
| Liveness sweep | `herdr pane list` · `herdr pane read <pane> --source visible --lines 20` |
| Reap a spent pane / worktree | kill pane · `git worktree remove .claude/worktrees/<slug>` |
| Pane-id authority (pre-merge) | re-read manifest lock line · confirm `$HERDR_PANE_ID` matches |
| CI gate (don't re-run) | `gh pr checks <PR>` — QA spends tokens on review, not re-execution |
| Merge + close | `gh pr merge <PR> --squash --delete-branch` · `gh issue close` · board move |
| Security-tier merge | spawn Opus QA → `gh pr comment` verdict → Ben sign-off → merge |
| Stay resident | `ScheduleWakeup` tick between pushes |
| Relay trigger | ~80–100k tokens OR 2–3 merges OR compaction summary seen (then merge nothing) |
| Escalate to Opus | `Agent(model: "opus", prompt: "<question + context>")` — relay compact verdict |

See also the design spec and CLAUDE.md (Hard Invariants, GitHub tracking, coordinating sessions).
