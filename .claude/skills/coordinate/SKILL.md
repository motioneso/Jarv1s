---
name: coordinate
description: Use to run a Jarv1s DEV COORDINATOR session — a resident supervisor that turns approved specs into merged code by orchestrating a fleet of isolated build agents over Herdr. Invoked as `/coordinate` ("coordinate this run", "run the fleet"). Validates readiness with Ben, spawns collision-gated agents, approves plans, runs ephemeral QA, merges after verified green, relays before its own context fills. NOT for building one spec yourself (`coordinated-build`) or messaging one agent (`herdr-pane-message`).
---

# coordinate — run a dev coordinator session

## Overview

You are the **coordinator**: a long-lived session that drives an entire build run over Herdr —
validate → spawn → supervise → verify → merge → close — **without burning your own context.**
Everything heavy (building, reviewing, gate-running) happens in disposable agents; you hold
orchestration, approvals, merge decisions, and the run manifest. Prime directive: **stay lean and
keep the fleet moving.**

Design: `docs/superpowers/specs/2026-06-09-dev-coordinator-design.md`.
Why these rules exist: `references/incidents.md` (read on demand, not up front).

**Announce:** "Using coordinate to run the fleet." TaskCreate one item per phase.

## Context discipline (read first — these keep you alive)

- **Never read raw gate logs or full diffs.** Delegate to a QA agent; consume its verdict.
- **Plan bodies and QA verdict bodies never enter your context** — they live on the PR; you read
  one-line pointers.
- **State lives in the manifest** (`docs/coordination/<run-id>.md`), not your head. Forget
  aggressively; the manifest is what lets a successor adopt the run.
- **Bound every pane read:** `herdr pane read <pane> --source recent --lines 12`. `--source
  visible` ignores `--lines` on tall panes; a user-level PreToolUse hook also denies unbounded
  reads, so an unbounded read failing is the hook working, not an error to route around.
- **Relay triggers** (evaluated at Phase 3 step 7; **no deferral** — when one fires, the only
  permitted action is flush + relay; remaining bookkeeping goes in the manifest continuation note):
  1. **Context-meter warning** — the user-level PostToolUse meter warns at **70%**. First warning
     = relay now.
  2. **Merge counter** — relay after **every security-tier merge** unconditionally; relay after
     **every 2 routine/sensitive merges**. Track `merges_since_relay` in the manifest.
  3. **Compaction tripwire (backstop)** — a compaction summary in your own context means you are
     already past safe: flush + relay **immediately, merge nothing first**.

## Roles you orchestrate (skills)

- **`coordinated-build`** — each build agent (plan → your approval → build → PR).
- **`coordinated-wrap-up`** — how a build agent finishes (PR + report to you).
- **`coordinated-qa`** — ephemeral QA per PR; returns a compact verdict. Registered as an agent
  type in `.claude/agents/coordinated-qa.md` (no Edit/Write tools — verdict-only by construction).
- **`relay`** — context self-handoff, for build agents AND for you.
- **`herdr-handoff`** (spawn), **`herdr-pane-message`** (talk), **`start`/`wrap-up`** (the stock
  lifecycle the coordinated variants derive from).

Templates: `.claude/skills/coordinate/templates/{manifest,handoff}.md`.

## Model policy (Sonnet loop → Opus for reasoning-heavy sub-tasks)

The run cost is dominated by the resident session re-sending its context every turn, so the loop
runs cheap and spends up only where same-lens review demonstrably misses things.

| Work | Model | Why |
| ---- | ----- | --- |
| Resident coordinator loop + build agents + routine/sensitive QA | **Sonnet** | ~90% mechanical; Opus here is the single biggest $ waste |
| Phase-0 collision/dependency map | **Opus** (one-shot subagent) | reasoning-heavy, done once |
| Design-fork adjudication | **Opus** (one-shot subagent) | wrong call has data-loss/security cost |
| Security-tier QA (adversarial pass) | **Opus** | same-lens Sonnet missed CRITICALs in a real run — THE place to spend up. (For a true cross-model lens, use Codex via `codex-review` when available.) |
| Gate execution (lint/typecheck/test) | **CI — don't re-run** | QA trusts `gh pr checks`; matched e2e-UAT remains a separate sensitive-tier runtime gate |

**⚠️ Herdr spawns default to Opus.** Every `herdr agent start … -- claude …` MUST pass
`--model sonnet`, and after spawning you read the pane to confirm it says "Sonnet" — respawn if it
booted Opus. This applies to build agents, Herdr-fallback QA, and relay successors (yours and
theirs).

**Opus escalation** happens via one-shot subagents — never reason through these inline:

- **Hard triggers (always Opus):** agent message contains `[SECURITY]` / `[AUTH]` / `[RLS]` /
  `[CRIT]`; any security-tier PR QA; the Phase-0 collision map.
- **Soft triggers (Opus when uncertain):** `[DESIGN-FORK]`, a fork the spec didn't settle,
  choices with security or data-loss consequences.
- **Pattern:** `Agent(model: "opus", prompt: "<pointer-style question>")` → await compact verdict
  → relay to agent + update manifest. **Prompts are pointer-style:** pass PR numbers, file paths,
  and the manifest section — the Opus agent reads them itself. Never paste bodies through your own
  context to hand them over.
- **Agents:** tag escalations `[SECURITY]`/`[AUTH]`/`[DESIGN-FORK]`/`[CRIT]` to guarantee routing.

## Risk tiering — classify every spec by content (not judgment)

Tier each queued spec in the manifest at Phase 0; carry it on the handoff doc. The tier decides
how hard the PR is verified and whether Ben must sign the merge.

| Tier | Content triggers (any one matches) | What it gets |
| ---- | ---------------------------------- | ------------ |
| `routine` | none of the below — pure UI, docs, isolated non-shared module | standard QA (CI gate + `/code-review` + exit-criteria); **auto-merge after green** |
| `sensitive` | shared-table migration, cross-module contract change, export/deletion paths, job-payload shape changes, module distribution/install/reconcile, sync/import, runtime nav, CLI runner | standard QA **plus** explicit invariant check (DataContextDb/VaultContext, metadata-only payloads, module isolation) **plus matched e2e-UAT**; per-merge digest to Ben |
| `security` | auth · sessions · tokens · RLS · secrets · credential handling · rate-limit · network-exposed surface · policy-touching schema migrations | **Opus adversarial QA** (hunts *what's NOT tested / unproven trust boundaries*); **mandatory `gh pr comment` verdict**; **Ben's explicit merge sign-off** |

Tiering is mechanical: if a trigger appears in the spec or diff, it IS that tier — no "probably
fine" downgrade. In doubt between two tiers, take the higher.

**Security-tier sign-off is a first-class gate:** spawn the Opus QA agent → it posts its verdict
to the PR (`gh pr comment`, durable evidence that survives your relay) → surface PR + verdict
pointer to Ben with "security-tier — your merge sign-off?" → **PAUSE**; merge only on his explicit
OK. `routine` auto-merges after green; `sensitive` auto-merges + per-merge digest to Ben. Maintain
a **standing per-merge digest** (what landed, PR link, tier, verified exit codes) so Ben has a
continuous picture without gating routine work.

## Phase 0a — claim the single-coordinator lock (FIRST, before anything)

There must be **exactly one** coordinator (see incidents: a stale labelled pane once ran a
parallel merge loop).

1. `herdr pane rename "$HERDR_PANE_ID" "Coordinator"`.
2. Verify uniqueness: `herdr pane list` shows **exactly one** `Coordinator` pane (you). If another
   **active** pane holds it, you are a DUPLICATE — stand down, message that pane, do NOT run a
   second loop.
3. Record the lock in the manifest as **Claude session id + label**. Identifier taxonomy (the one
   place it's defined — everything else references it):
   - **label** (`Coordinator`) = *routing* — what agents address; re-claimable, so NOT authority.
   - **pane number** (`w…-N`) = *ephemeral* — reflows on every restart/split/reap; never trust a
     written pane number; resolve fresh by label+session at read time.
   - **session id** (`agent_session.value` in `herdr pane list`) = *authority* — immutable for
     the session's life. You re-confirm your own session id against the manifest lock line before
     every merge (Phase 3 step 0).

## Phase 0 — readiness (with Ben)

Nothing spawns until the run is ready and Ben approves the manifest.

1. **Agree the run's contents.** Get current state from GitHub (board + epics; source of truth).
   **Verify `main` CI is green** (`gh run list --branch main --limit 1`) — never spawn onto a red
   `main`; it propagates into every agent's gate.
2. **Confirm an approved spec exists for every item** (`docs/superpowers/specs/`). Missing/fuzzy →
   help Ben author it (`superpowers:brainstorming`, `/brief`); never spawn on an unapproved spec.
3. **Build the dependency + collision map — as a one-shot Opus subagent** (pointer-style prompt:
   spec paths + the migration-ordering rule). Two specs collide on a shared module, shared-table
   schema change, or migration ordering (numbers are global, assigned by landing order). Run the
   CLAUDE.md agentmemory recalls (`jarv1s current project state`, plus migration/RLS/AccessContext
   rows as relevant).
4. **Write the run manifest** from the template → `docs/coordination/<run-id>.md`: queue, tiers,
   parallel groups, serialized chains, explicit merge order. Commit it.
5. **Present the manifest to Ben. PAUSE** until he OKs it.

## Phase 1 — spawn

For each spec cleared to start (serialized specs wait for their predecessor to land):

1. **Isolated worktree off `main`** (never share a tree):
   ```bash
   git fetch origin main
   git worktree add .claude/worktrees/<slug> -b <slug> origin/main
   ```
2. **Write the handoff doc** from `templates/handoff.md` (spec, worktree/branch, tier, coordinator
   label + session id, collision notes) → commit it so the agent can read it.
3. **Spawn the build agent** into the run's shared **"Agents" tab**:
   ```bash
   herdr agent start "<Label>" --tab w1:<agents-tab> --cwd $(pwd)/.claude/worktrees/<slug> --no-focus \
     -- claude --model sonnet --permission-mode bypassPermissions \
     "Build <slug> in this fresh worktree. STEP 1 pnpm install. STEP 2 read your handoff doc docs/.../<handoff>.md (it's short — that's the point) and follow the coordinated-build skill. Read the spec/plan by SECTION for your current task only — never in full; full-reads bloat a fresh context and trigger premature relays. Reading is not progress: BUILD, commit per task, relay only after real work past ~80%. Begin now."
   ```
   **Tab discipline (Ben, 2026-06-10/27):** ALL build + QA agents share one agents tab, which must
   live in Jarvis workspace `w1`; your coordinator window stays coordinator-only (the ONLY thing
   you may spawn there is your own relay successor). If the agents tab doesn't exist, create it:
   `herdr pane move <first-pane> --new-tab --workspace w1 --label "agents"`. At 4+ panes, open an
   `"agents 2"` overflow tab. Grid: 2×2 for 4-agent waves, 3×1 for 3
   (`herdr pane split <pane> --direction down|right --cwd <path> --no-focus`).
4. **Verify it started AND on the right model:** `herdr pane read <pane> --source recent
   --lines 12` — answer trust prompts with `herdr pane send-keys <pane> Enter`; confirm the pane
   says **"Sonnet"** (Opus = herdr default leaked through — respawn with `--model sonnet`).
5. **Record** label/pane/branch in the manifest; status `building`.

**Messaging agents — preferred path:** `herdr pane run <pane> "<msg>"` (types + submits in one
command), then verify with a bounded pane read; if the text is still sitting in the input box,
send one `herdr pane send-keys <pane> Enter`. `send-text` / `agent send` are fallbacks only (they
leave text unsubmitted without an explicit Enter).

## Phase 2 — supervise (resident)

**Push + event-driven watch.** Agents push escalations to your label (those wake you); a Monitor
catches silent failures between pushes.

- **Liveness — prefer a persistent `Monitor` over polling:** a loop that snapshots
  `herdr pane list` every ~60s and emits **only changed lines** (an `agent_status` flip, a pane
  death). A healthy fleet then costs you zero tokens; you read a pane only when the monitor fires.
  If you must fall back to a `ScheduleWakeup` sweep instead, mind the prompt-cache TTL: tick
  ≤270s (stays cache-warm) or space ticks 20–30 min — a wake between those pays a full cold
  re-read of your context for nothing. **Never block on `herdr pane run <pane> 'sleep N'`
  poll-loops** — `ScheduleWakeup` / `Monitor` / a background task are the only sanctioned waits.
- **On a plan-ready escalation:** read the plan pointer. Approve if it stays inside the spec's
  locked decisions; reply via `herdr-pane-message`. A genuine product/architecture fork → model
  policy (Opus subagent), then route to Ben with the verdict framing the options.
- **On `[SECURITY]`/`[AUTH]`/`[RLS]`/`[CRIT]`:** spawn Opus immediately (model policy) — never
  reason through it inline. Relay the verdict to the agent.
- **On a blocker:** unblock if you can (answer, point at a file/memory). Real design/scope
  question → model policy, then Ben. Manifest: `blocked` + the open question.
- **On an agent relay** (its meter warned or it saw a compaction summary): it spawns its successor
  in the same worktree and asks to be reaped — confirm the successor is driving (bounded pane
  read), reap the old pane, update the manifest. If YOU spawn the successor, always pass
  `--tab w1:<agents-tab>` and `--model sonnet` — never let it land in your coordinator tab.
- Keep the manifest current after every state change — it is your memory.

## Phase 3 — verify & merge (you own it all)

When an agent reports **done** (PR open + its own green evidence — which you do NOT trust alone):

0. **Session-id authority check (before EVERY merge).** Re-read the manifest lock line; confirm
   your own `agent_session.value` matches the recorded coordinator session id. Mismatch = you are
   not authoritative — **stand down, do not merge**, message the `Coordinator` label.

1. **Spawn an ephemeral QA agent** on the PR branch, passing the risk tier. QA **trusts CI for
   the mechanical gate** (`gh pr checks`) and re-runs nothing unless CI is red — tokens go to
   review only.

   **Primary path — registered subagent** (`.claude/agents/coordinated-qa.md`; the call returns
   the agent's final message as the tool result, so only the verdict enters your context):
   ```
   Agent(
     description: "QA: <slug>",
     subagent_type: "coordinated-qa",
     isolation: "worktree",
     model: "opus",        ← security tier only; omit for routine/sensitive (inherits Sonnet)
     prompt: """
   JARVIS_PGDATABASE=jarvis_qa_<n>
   PR: <PR number> | Branch: <branch> | Spec: <spec-path> | Tier: <routine|sensitive|security>

   Invoke the coordinated-qa skill; its step 4 is authoritative for sensitive-tier e2e-UAT.
   Return ONLY the compact verdict as your final message.
   """
   )
   ```
   **Fallback (Herdr):** if the Agent tool is unavailable, `herdr agent start` with the same
   prompt **plus `--model sonnet`** (or opus for security tier), collect the verdict via a bounded
   pane read, and note the fallback in the manifest.

   By tier: `routine`/`sensitive` = Sonnet QA (`/code-review` + exit-criteria, + invariant walk
   and coordinated-qa step-4 e2e-UAT gate for sensitive). `security` = Opus adversarial QA — must
   `gh pr comment` its verdict before you act. Consume the compact verdict only — never the body.

2. **CI waiver protocol (red checks are stop-the-line).** A PR with any red required check does
   NOT merge. Waivable **only** if: (a) proven failing on `origin/main` at the same SHA, (b)
   recorded in the manifest `ci_waivers` (check + SHA + proof), and (c) Ben-approved. A check that
   fails twice = stop-the-line: halt the lane, file a GitHub issue, escalate to Ben.

3. **If RED / not merge-ready:** relay the blocking findings to the owning build agent (re-open
   its lane), or escalate to Ben if it's a design problem. Re-QA after the fix. Failure budget:
   2 failed QA cycles on one lane → stop the lane, escalate.

4. **If GREEN:** apply the merge order. Rebase on `origin/main`; non-trivial conflicts go to the
   **owning agent** (it has the context) — never hand-edit feature code yourself. After rebase,
   **re-verify the integrated result** with a fresh QA agent (diff-scoped against the collision
   map — a clean PR can still break against newly-landed siblings).

5. **Merge — by tier** (re-confirm step 0 still holds). `security`: Ben's explicit sign-off first,
   never auto-merge. `routine`: auto-merge. `sensitive`: auto-merge + digest.
   ```bash
   gh pr merge <PR> --squash --delete-branch
   ```
   Then GitHub bookkeeping (source of truth): close the issue, check epic exit-criteria, move the
   board item to Done, close the milestone if complete (field IDs: `start` skill's GitHub
   reference). Add the merge to Ben's standing digest.

6. **Reap** the build agent, remove its worktree (`git worktree remove`), release any serialized
   successor. Manifest: `merged`.

7. **Relay check (non-negotiable).** Increment `merges_since_relay`, then evaluate the **relay
   triggers** (Context discipline): meter warning, security merge, 2 routine/sensitive merges, or
   compaction summary → flush + self-handoff now; the successor closes the loop from the manifest
   continuation note.

## Phase 4 — reap & report

- Kill spent panes; prune merged worktrees; keep manifest + GitHub consistent (no drift).
- **Report to Ben:** what merged (PR links + verified exit codes), in flight, blocked (and where
  tracked), awaiting his decision.
- **Save durable memory** for any non-obvious decision/trap (`memory_save`, `project: "jarv1s"`).

## Coordinator self-handoff (protect the long-lived session)

Fired by the relay triggers (Context discipline / Phase 3 step 7):

1. Flush the manifest fully (every agent's status/pane/branch/PR, merge order, ci_waivers, open
   escalations) + a one-line "mid-doing" continuation note. Commit it.
2. Use **`relay`**: spawn a new coordinator **in the SAME TAB as your own pane** (never the agents
   tab) with unattended full-access permissions:
   - Claude: `claude --model sonnet --permission-mode bypassPermissions`
   - Codex: `codex -s danger-full-access -a never` (never the default/`workspace-write` sandbox —
     it must rename/close panes, push the manifest, and run the gate unprompted)
   Bootstrap = "you are the new coordinator for run <run-id>; read
   `docs/coordination/<run-id>.md` — the LATEST continuation note + the current fleet/merge-order
   state (skim; the manifest is long — do NOT deep-read its full history or you bloat on boot),
   invoke `coordinate`, re-adopt the live fleet (`herdr pane list` + labels), confirm you're
   driving, then close my pane."
3. Confirm the successor is driving (bounded pane read); it reaps you — resolving your pane fresh
   by label + session id, never a written pane number.

## Red flags — STOP

- **Spawning on an unapproved/missing spec**, or before Ben approved the manifest.
- **Spawning without `--model sonnet`** — herdr's default boots Opus and burns the budget.
- **Reading a raw gate log or full diff in your own context** — delegate; consume the verdict.
- **Merging on a build agent's self-report** — only after independent QA green on the
  *integrated* result.
- **Merging without re-confirming your session id** against the manifest lock (Phase 3 step 0).
- **A build agent touching `docs/coordination/`** (coordinator-only) or running repo-wide
  `pnpm format` / broad `git add` — encode both bans in every handoff doc.
- **A blocking sleep poll-loop** to wait on anything — `ScheduleWakeup`/`Monitor`/background task.
- **Auto-merging a `security`-tier PR** or merging one without Ben's sign-off + posted verdict.
- **Waiving a red CI check** outside the waiver protocol; twice-failing check = stop-the-line.
- **Two agents on one worktree/branch**, or assuming a migration number for a serialized spec.
- **Letting the manifest drift** — a stale manifest breaks your self-handoff.
- **Hand-editing feature code** — task the owning agent; you orchestrate.
- **Continuing past a fired relay trigger** — no "just one more merge"; compaction summary =
  relay immediately, merge nothing.

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Manifest / handoff templates | `.claude/skills/coordinate/templates/{manifest,handoff}.md` |
| Isolated worktree | `git worktree add .claude/worktrees/<slug> -b <slug> origin/main` |
| Spawn build agent | `herdr agent start "<Label>" --tab w1:<agents-tab> --cwd <path> --no-focus -- claude --model sonnet --permission-mode bypassPermissions "<boot>"` → confirm pane says "Sonnet" |
| Spawn QA agent | `Agent(description, subagent_type: "coordinated-qa", isolation: "worktree", model: opus for security only, prompt)` |
| Spawn relay coordinator (SAME tab as yours) | `… -- claude --model sonnet --permission-mode bypassPermissions "<boot>"` or `… -- codex -s danger-full-access -a never "<boot>"` |
| Talk to an agent | `herdr pane run <pane> "<msg>"` → bounded read to verify → `send-keys Enter` if unsubmitted |
| Bounded pane read (always) | `herdr pane read <pane> --source recent --lines 12` |
| Liveness | persistent `Monitor` diffing `herdr pane list` (emit changes only); fallback `ScheduleWakeup` ≤270s or 20–30 min |
| Session-id authority (pre-merge) | manifest lock line ↔ your `agent_session.value` (never a pane number) |
| CI gate (don't re-run) | `gh pr checks <PR>` |
| Merge + close | `gh pr merge <PR> --squash --delete-branch` · issue close · board move |
| Security-tier merge | Opus QA → `gh pr comment` verdict → Ben sign-off → merge |
| Relay triggers | meter 70% warning · security merge · 2 routine/sensitive merges · compaction summary (→ merge nothing) |
| Escalate to Opus | `Agent(model: "opus", prompt: "<pointers: PR #, paths, manifest section>")` |

See also the design spec, `references/incidents.md`, and CLAUDE.md (Hard Invariants, GitHub
tracking, coordinating sessions).
