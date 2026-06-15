# Coordination Run — wellness-design-2026-06-15

**Date:** 2026-06-15
**Coordinator lock:** label `Wellness-Coordinator`, **stable anchor = Claude session id
`ea8e89af-52a7-4c41-9c63-09a3866ace1b`** (match `agent_session.value` in `herdr pane list`). Exactly
one pane with this session id holds authority. ⚠️ **Pane numbers (`w…-N`) reflow constantly this run
(observed multiple renumbers within seconds) — NEVER trust a pane number written here; resolve fresh
by label + session id at read time, and verify session id before any reap/close.**

**Merge policy — ⚠️ OVERRIDE (Ben, 2026-06-15):** Ben explicitly authorized, replacing his standing
"no merge to main without my OK" **for these two runs only**:

1. **Wellness slice:** I merge it to `main` **autonomously** once gate is green (REAL exit 0) +
   2nd Codex pass = MERGE-READY + an independent QA pass is green. No human sign-off ping.
2. **Calendar run (next):** a **fully-autonomous** coordinator — authors spec, Codex-adversarial-
   reviews plan/spec in lieu of human approval, builds, Codex code-review + remediate, **and merges
   to main itself** + GitHub bookkeeping, then reports. Zero Ben input.
   This override is scoped to wellness + calendar; it does NOT change the default policy for future runs.

**Relay threshold:** routine/sensitive `merges_since_relay` ≥ 2 → relay; security merge → relay
immediately; compaction summary in own context → relay, merge nothing first.
**merges_since_relay:** 0

> Coordinator's externalized memory. Keep CURRENT — lets a fresh coordinator adopt this run after a
> self-handoff. GitHub is source of truth for spec/issue/board status; this file holds in-flight state.

## Queue

| Spec                                                      | Issue            | Tier      | Status   | Agent label          | Session id | Branch                        | PR                                                  |
| --------------------------------------------------------- | ---------------- | --------- | -------- | -------------------- | ---------- | ----------------------------- | --------------------------------------------------- |
| Codex code-review remediation (9 findings) — relay doc §1 | epic #50 (slice) | sensitive | building | Wellness-Remediation | `3bc2277f` | worktree-feat+wellness-design | — (no PR; in-worktree commit, merge by coordinator) |

**Tier rationale (sensitive):** med-data exposure reduction (H2+M5 drops dose/prnReason), new
owner-scoped `PATCH /api/wellness/checkins/:id` (RLS-applicable), cross-owner leakage handling (M4).
Not auth/sessions/tokens/secrets/rate-limit → not `security`. Autonomous-merge per override above.

## Branch model (NOTE — differs from standard coordinate flow)

This is a single-branch remediation on the existing wellness feature branch
`worktree-feat+wellness-design` (HEAD `476f943`), NOT an isolated-worktree-off-main PR flow. The
remediation agent commits directly on that branch in the shared primary worktree. "Merge" = land
this branch onto `main` (mechanism TBD with gate green + Codex MERGE-READY — likely fast-forward/PR
then squash). The wellness work (Phases 1–3) already lives only on this branch, not yet on `main`.

## Verify-before-merge checklist (wellness slice)

- [ ] Remediation commit lands; `git show --stat` shows ONLY intended paths (agent ran repo-wide
      `pnpm format` — confirm no unrelated files swept into the commit).
- [x] `pnpm verify:foundation` REAL exit 0 — independently confirmed at `6ebda42`+manifest (335 unit + 725 integration, 2 skipped). MUST RE-RUN after round-2 fixes land.
- [ ] 2nd Codex pass (session `019eca17`) → **ROUND 2 = DO-NOT-MERGE, BLOCKERS:1** (all 9 original findings confirmed fixed, but 4 regressions introduced — see escalations). Round-3 re-review needed after fixes.
- [ ] Independent coordinated-qa pass green (sensitive tier: + invariant check).
- [ ] Then autonomous merge to `main` + GitHub bookkeeping (epic #50 progress comment — slice, do
      NOT close epic) + agentmemory lesson + remove `wellness-web` worktree.

## DEFERRED ACTION — fires after wellness merges cleanly

**Spawn a NEW fully-autonomous coordinator for the Calendar implementation.** "Do the same thing as
wellness, without Ben's input." Concretely:

- Design source: `Calendar.jsx` + `calendar-data.js` in the design bundle
  `/home/ben/.claude/jobs/914af5c0/tmp/design/jarvis-design-system/project/ui_kits/jarvis-app/`.
- No calendar _design_ spec exists yet (only old `m-b1-google-connector-oauth` spec + slice-1c
  connectors plan + audit issue #145). New coordinator AUTHORS the spec + build plan, runs a Codex
  adversarial plan-review loop (stands in for human sign-off), builds via Sonnet agents, Codex
  code-review + remediate, gate green, **then merges to main autonomously** + bookkeeping + reports.
- Mirror everything learned here: session-id pane identity, REAL gate exit code, never edit applied
  migrations, sensitive/security tiering, relay discipline, no broad `pnpm format` + `git add -A`.
- Spawn via `herdr-handoff` into the fleet (own coordinator pane); write its own run manifest
  `docs/coordination/calendar-design-<date>.md` and bootstrap it to invoke `coordinate`.

## CI waivers

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding escalations

- **[LANE STOPPED — escalated to Ben 2026-06-15]** QA cycle 2 (Codex round-3) returned
  **DO-NOT-MERGE, BLOCKERS:1**. Per failure budget, lane is halted pending Ben's decision.
  - Round-2 (cycle 1, commit `6ebda42`): 4 regressions found (R1 HIGH data-loss, R2 MED stale fact,
    R3/R4 LOW) — all reported fixed in commit `6e23402`.
  - Round-3 (cycle 2, commit `6e23402`): **HIGH** `repository.ts:317` — R1 fixed for `sensations`
    but the SAME partial-update clearing bug remains on **`feelingSecondary`** (omitted → `?? null`
    erases existing feeling word). **LOW** — R2 test is shallow (passes even if refresh call
    removed; should assert `[wellness:energy-trend]` fact updated after PATCH).
  - Convergence: 9 → 4 → 1. The blocker is narrow + same-pattern as R1 (mechanical fix). Meta-flag
    for Ben: agent fixed the reported instance but not the bug CLASS — relevant to whether the
    Calendar run should merge fully autonomously.
  - Independent gate at `6e23402`: unit 335 green; integration run was in progress (Codex blocks
    merge regardless).

## Paused side-task (Ben, from relay doc §3)

Make Ben's **dev** account instance admin once it exists (dev `jarv1s` currently has only
`*@example.test` seed users). Also file GitHub issue: owner/primary account should auto-be instance
admin. Wait for Ben.

## Reaped sessions

- `w653f42bef3ac02-2` / label `Coordinator`, session `a6291c05` — prior (Ben-session) coordinator,
  reaped 2026-06-15 after confirming successor (this session) driving. (Bootstrap's stale reap
  target `-4` had reflowed to Ben's Jarvis chat — NOT reaped; identified real target by session id.)
