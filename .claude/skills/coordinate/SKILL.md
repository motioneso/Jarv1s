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
the **manifest** (your working set — forget aggressively), not your head. **Relay on the merge
counter** (the only trigger you can actually count — token counts are not measurable by the
session): relay after **every security-tier merge** unconditionally; relay after **every 2
routine/sensitive merges**. No ranges — ranges invite deferral. Track `merges_since_relay` in the
manifest; check it at the end of Phase 3 step 6.
**No-deferral rule:** when the relay trigger fires, the only permitted action is flush + relay.
Remaining bookkeeping goes in the manifest continuation note — the successor closes the loop.
**Compaction tripwire:** if you ever see a compaction summary in your own context (the harness
compacted your prior messages), you are already past safe — flush the manifest + relay
**immediately**, **merge nothing first**. The tripwire is a backstop; the merge counter should
fire first.

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
3. Record the lock in the run manifest as **Claude session id + label** `Coordinator`. There are
   **three** identifiers and only one is authority:
   - **label** (`Coordinator`) = *routing* — stable string agents address; **re-claimable** (a stale
     pane can grab it), so NOT authority.
   - **pane number** (`w…-N`) = *ephemeral* — these **reflow on every restart / split / reap** and
     renumber repeatedly across a long run (proven in 2026-06-11-audit-remediation, which restarted
     many times). **Never trust a `w…-N` number written in the manifest as an identifier — it is
     stale the moment a pane closes.**
   - **Claude session id** (`agent_session.value` in `herdr pane list`, e.g.
     `515ad953-…`) = *authority* — immutable for the life of the session, survives pane renumbering.
   Bind authority to the **session id**. Agents escalate to the label; **you re-confirm your own
   session id against the manifest lock line before every merge** (Phase 3, step 0). Resolve your
   pane fresh by label+session at read time — do not carry a pane number forward.

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
3. **Spawn the build agent** into the run's shared **"Agents" tab** (one tab holds ALL build *and*
   QA agents — `--tab <workspace>:<agents-tab>`). **Tab discipline (Ben, 2026-06-10):** build/QA
   agents share that one tab; the coordinator's own window stays coordinator-only — the ONLY thing
   you may spawn there is your own relay successor. **Grid layout by wave size:** lay the Agents tab
   out as **2×2** for a 4-agent wave, **3×1** for a 3-agent wave (split with
   `herdr pane split <pane> --direction down|right --cwd <path> --no-focus`).
   ```bash
   herdr agent start "<Label>" --tab <workspace>:<agents-tab> --cwd $(pwd)/.claude/worktrees/<slug> --no-focus \
     -- claude --permission-mode bypassPermissions \
     "Build <slug> in this fresh worktree. STEP 1 pnpm install. STEP 2 read docs/.../<handoff>.md IN FULL and follow it via the coordinated-build skill. Begin now."
   ```
4. **Verify it actually started** (not stuck on a trust prompt): `herdr pane read <pane> --source
   visible --lines 20`; answer prompts with `herdr pane send-keys <pane> Enter`.

   **⚠️ Messaging agents — preferred path.** Use `herdr pane run <pane> "<msg>"` for messages to
   agent panes; it types the text and submits Enter in one command. Afterward, verify with
   `herdr pane read <pane> --source visible --lines 12`. If the raw text is still sitting in the
   input box, send one separate `herdr pane send-keys <pane> Enter`. Treat `herdr pane send-text`
   and `herdr agent send` as fallbacks only, because they write literal text and can leave messages
   unsubmitted unless followed by Enter.
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
  **⚠️ Never block on `herdr pane run <pane> 'sleep N'` poll-loops** (proven wasteful in
  2026-06-11-audit-remediation — six blocking 45s iterations re-sending context each turn). To wait,
  use **`ScheduleWakeup`** for fixed-interval polling, **`Monitor`** for an event-driven condition,
  or a **harness-tracked background task** (`run_in_background`) that auto-notifies on completion —
  all let you sleep without burning a turn per tick. Background-poll a Herdr PR that doesn't
  auto-notify, and let native background `Agent` QA wake you on its own.
- **On an agent relay** (it hit its countable-event threshold or saw a compaction summary): it
  spawns its own successor in the same worktree and asks to be reaped — confirm the successor is
  driving (`herdr pane read`), then **reap** the old pane and update the manifest (pane id changed).
- Keep the manifest current after every state change — it is your memory.

## Phase 3 — Verify & merge (you own it all)

When an agent reports **done** (PR open + its own green evidence — which you do NOT trust on its
own):

0. **Session-id authority check (before EVERY merge).** Re-read the manifest lock line and confirm
   your own Claude session id (your pane's `agent_session.value` in `herdr pane list`) matches the
   recorded coordinator session id. If it does **not** match, you are not the authoritative
   coordinator — **stand down, do not merge**, message the `Coordinator` label. Label = routing
   (re-claimable); pane number = ephemeral (reflows); **session id = authority** (immutable). (A
   stale duplicate once grabbed the label and ran a parallel merge loop — the session-id check is
   what stops that, and unlike a pane number it does not renumber across restarts.)

1. **Spawn an ephemeral `coordinated-qa` agent** on the PR branch via the **`Agent` tool**,
   passing the spec's **risk tier**. QA **trusts CI for the mechanical gate**
   (`gh pr checks`) and does NOT re-run `pnpm verify:foundation` unless CI is red — it spends tokens
   on review only.

   **Primary path — native subagent:**
   ```
   Agent(
     description: "QA: <slug>",
     subagent_type: "coordinated-qa",
     run_in_background: true,
     isolation: "worktree",
     model: "opus",        ← security tier only; omit for routine/sensitive
     prompt: """
   JARVIS_PGDATABASE=jarvis_qa_<n>
   PR: <PR number>
   Branch: <branch>
   Spec: <spec-path>
   Tier: <routine|sensitive|security>

   You are a QA agent. Invoke the coordinated-qa skill. Return ONLY the compact verdict as your
   final message.
   """
   )
   ```
   Await the background agent notification. Extract the compact verdict from the agent's final
   message. No reap needed — native subagents clean themselves up.

   **Fallback (Herdr):** If the `Agent` tool is unavailable (e.g., running in a context without
   native subagent support), fall back to `herdr agent start` with the same QA prompt and collect
   the verdict via `herdr pane read`. Document any fallback activation in the manifest.

   By tier:
   - `routine` / `sensitive`: **Sonnet** QA — `/code-review` + exit-criteria (+ invariant check for
     `sensitive`). Compact verdict back to you.
   - `security`: **cross-model Opus** QA (`model: "opus"` in `Agent(...)`) — `/security-review` + an
     adversarial *what's NOT tested / which trust boundary is unproven* pass. It **must `gh pr
     comment` its verdict** before you act. (Same-lens Sonnet missed the CRITICALs in the real run;
     this is the budgeted place to spend up.)
   Consume the compact verdict (cheap — never the body).

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

7. **Relay check (non-negotiable).** Increment `merges_since_relay` in the manifest. Then:
   - **security-tier merge:** relay now. No exceptions, no "just one more."
   - **routine/sensitive, `merges_since_relay` ≥ 2:** relay now.
   - Otherwise: continue, but do not take on new merge work without re-checking.
   When relay fires here, flush the manifest and invoke the self-handoff procedure below. The
   successor picks up remaining bookkeeping from the manifest continuation note.

## Phase 4 — Reap & report

- Kill spent panes to free resources; prune merged worktrees.
- Keep the manifest + GitHub consistent (no drift).
- **Report to Ben:** what merged (PR links + verified exit codes), what's in flight, what's blocked
  and where it's tracked, and anything awaiting his decision.
- **Save durable memory** for any non-obvious decision/trap (`memory_save`, `project: "jarv1s"`).

## Coordinator self-handoff (protect the long-lived session)

Trigger: **Phase 3 step 7** fires this procedure. The merge counter (`merges_since_relay` in the
manifest) is the only operative trigger — token counts are not measurable. The compaction tripwire
is a backstop for when the counter fails to fire in time; if the tripwire triggers, the counter
already failed.

1. Flush the manifest fully (every agent's status/pane/branch/PR, merge order, ci_waivers, open
   escalations); add a one-line "mid-doing" continuation note. Commit it.
2. Use **`relay`**: `herdr-handoff` a **new coordinator** pane **in the SAME TAB as your own pane**
   (NOT the agents tab, NOT a new tab). The successor opens in the same tab you're in, then closes
   you — that way there's never two coordinator tabs. Launch the successor with unattended,
   full-access permissions appropriate to the CLI:
   - Claude: `claude --permission-mode bypassPermissions`
   - Codex: `codex -s danger-full-access -a never`
   Do not spawn a Codex coordinator with the default or `workspace-write` sandbox; it must be able
   to rename/close Herdr panes, update the manifest, push, and run the local gate without approval
   prompts.
   Bootstrap = "you are the new coordinator for run <run-id>; read `docs/coordination/<run-id>.md`
   IN FULL, invoke `coordinate`, re-adopt the live fleet (`herdr pane list` + labels), confirm
   you're driving, then close my pane."
3. Confirm the successor is driving (`herdr pane read`); it reaps you. The fleet keeps running —
   the manifest is what lets a coordinator you didn't spawn adopt this run.

## Red flags — STOP

- **Spawning on an unapproved/missing spec**, or before Ben approved the manifest. Don't.
- **Reading a raw gate log or full diff in your own context.** Delegate to a QA agent; consume the
  verdict. This is the whole point.
- **Merging on a build agent's self-report.** Merge only after an independent QA agent's verified
  green on the *integrated* result.
- **Merging without re-confirming your session id** against the manifest lock line (Phase 3 step 0).
  A matching label is not authority (re-claimable); a pane number is not authority (it reflows) —
  only the immutable Claude session id is.
- **A build agent touching `docs/coordination/`** (coordinator-only), or running repo-wide
  `pnpm format` + broad `git add` instead of scoping format/staging to its own changed paths — it
  will sweep another session's uncommitted work. Encode both bans in every handoff doc.
- **A blocking `herdr pane run <pane> 'sleep N'` poll-loop** to wait on anything — use
  `ScheduleWakeup` / `Monitor` / a background task instead (Phase 2).
- **Auto-merging a `security`-tier PR**, or merging it without Ben's explicit sign-off and a posted
  `gh pr comment` verdict. Content triggers put it there; the human gate is non-negotiable.
- **Waiving a red CI check** without proving it red on `main` @ same SHA, recording it in
  `ci_waivers`, and getting Ben's approval. A check failing twice = stop-the-line + file an issue.
- **Two agents on one worktree/branch**, or assuming a migration number for a serialized spec.
- **Letting the manifest drift** from reality — a stale manifest breaks your self-handoff.
- **Hand-editing feature code** to "just fix it" — task the owning agent; you orchestrate.
- **Continuing past your relay threshold** — security-tier merge = relay immediately; 2
  routine/sensitive merges = relay immediately. Check `merges_since_relay` in Phase 3 step 7.
  Compaction summary = relay immediately, merge nothing. No "just finish this one thing."

## Quick reference

| Need | Command / skill |
| ---- | --------------- |
| Manifest / handoff templates | `.claude/skills/coordinate/templates/{manifest,handoff}.md` |
| Isolated worktree | `git worktree add .claude/worktrees/<slug> -b <slug> origin/main` |
| Spawn build agent (shared Agents tab) | `herdr agent start "<Label>" --tab <ws>:<agents-tab> --cwd <path> --no-focus -- claude …` (2×2 for 4-agent / 3×1 for 3-agent waves) |
| Spawn QA agent (native subagent) | `Agent(description: "QA: <slug>", subagent_type: "coordinated-qa", run_in_background: true, isolation: "worktree", prompt: "...")` |
| Spawn relay coordinator (SAME tab as yours) | `herdr agent start "Coordinator" --tab <your own tab> … -- claude --permission-mode bypassPermissions "<boot>"` or `… -- codex -s danger-full-access -a never "<boot>"` — successor opens in your tab, then closes you |
| Talk to an agent | `herdr pane run <pane> "<msg>"`, then verify with `herdr pane read`; use `send-text` + Enter only as fallback |
| Liveness sweep | `herdr pane list` · `herdr pane read <pane> --source visible --lines 20` |
| Reap a spent pane / worktree | kill pane · `git worktree remove .claude/worktrees/<slug>` |
| Session-id authority (pre-merge) | re-read manifest lock line · confirm your pane's `agent_session.value` matches (NOT the pane number — it reflows) |
| CI gate (don't re-run) | `gh pr checks <PR>` — QA spends tokens on review, not re-execution |
| Merge + close | `gh pr merge <PR> --squash --delete-branch` · `gh issue close` · board move |
| Security-tier merge | spawn Opus QA → `gh pr comment` verdict → Ben sign-off → merge |
| Stay resident | `ScheduleWakeup` tick between pushes |
| Relay trigger | security merge → relay immediately; 2 routine/sensitive merges → relay; compaction seen → relay, merge nothing |
| Escalate to Opus | `Agent(model: "opus", prompt: "<question + context>")` — relay compact verdict |

See also the design spec and CLAUDE.md (Hard Invariants, GitHub tracking, coordinating sessions).
