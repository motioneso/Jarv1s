# Incident history — why the coordinate rules exist

Read on demand when you want the rationale behind a rule. The rules themselves live in
`coordinate/SKILL.md`, `relay/SKILL.md`, and `coordinated-*/SKILL.md` — this file is evidence,
not instructions.

## 2026-06-09 — two coordinators ran a parallel merge loop

A stale pane still labelled `Coordinator` woke on an agent's escalation and started merging
independently alongside the live coordinator. → **Single-coordinator lock (Phase 0a)** and the
**session-id authority check before every merge** (Phase 3 step 0). Label = routing only
(re-claimable); only the immutable Claude session id is authority.

## 2026-06-11 (audit-remediation run) — pane numbers reflow constantly

The run restarted many times; `w…-N` pane numbers renumbered on every restart/split/reap. A reap
target baked into a bootstrap doc had become **the user's chat pane** by read time (near-miss).
→ Never write a `…-N` number into a manifest/handoff as an identifier; resolve panes fresh by
**label + session id** at read time.

## 2026-06-11 — blocking sleep poll-loops burned the coordinator's context

Six blocking `herdr pane run <pane> 'sleep 45'` iterations, each re-sending the coordinator's
full context per turn. → **Never block to wait.** Use `ScheduleWakeup` (fixed interval),
`Monitor` (event-driven), or a harness-tracked background task.

## Real run — same-lens Sonnet QA missed CRITICAL security findings

Sonnet QA reviewing Sonnet-built security-tier code passed CRITICALs that an adversarial
stronger-model pass caught. → **Security tier always gets Opus adversarial QA** ("what's NOT
tested / which trust boundary is unproven"), posted durably via `gh pr comment`, plus Ben's
explicit merge sign-off.

## 2026-06-23 — herdr spawns boot Opus by default

`herdr agent start … -- claude …` launches **Opus** unless `--model sonnet` is passed (Ben cost
policy: build/QA/coordinator loops run Sonnet). → Every spawn command carries `--model sonnet`,
and the spawner reads the pane to confirm "Sonnet" (respawn if wrong).

## 2026-06-24 — stale spec nearly caused a rework cycle (issue #456)

The spec was written against pre-`202c638b` state; 3 of 5 items had already shipped in
intermediate commits. The build agent caught it by grounding every spec premise in its branch
before planning. → **Spec-vs-branch verification is step ½ of `coordinated-build`**, and drift is
escalated, never silently absorbed.

## 2026-06-27 — unbounded pane reads were the dominant coordinator context leak

Measured on a live coordinator: bare `herdr pane read` ≈ 960 tokens vs `--source recent
--lines 12` ≈ 402; sweeps hit the whole fleet every loop, compounding to ~hundreds of k overnight.
`--source visible` **ignores `--lines`** on tall panes. → Only `--source recent --lines N` is
bounded; a user-level PreToolUse hook (`~/.claude/scripts/enforce-bounded-pane-read.sh`) now
denies unbounded reads, and a PostToolUse context-meter warns at 70% (self-calibrating — this is
what makes context % a *countable* relay trigger).
