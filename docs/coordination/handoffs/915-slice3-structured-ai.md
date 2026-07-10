# Build Handoff — #915 Slice 3: Structured-AI Seam

**Spec (approved):** docs/superpowers/specs/2026-07-09-external-worker-capabilities-design.md
(rev 2, `6019f94f`, Ben-approved 2026-07-09) — this build covers **Slice 3 only** (D6, the
`packages/ai` seam). Slices 1/2/4 are NOT in scope — they serialize behind #917/#919 and are not
ready.
**GitHub issue:** #915
**Implementation plan (already approved):** docs/superpowers/plans/2026-07-09-structured-ai-seam.md
(commit `1dc1a346`, merged to main via PR #922) — a 9-task TDD plan. This plan was independently
reviewed by a fresh general-purpose subagent (not the plan's author) and confirmed to stay inside
Slice 3's `packages/ai`/`packages/shared` footprint, honor provider-agnostic routing precedence
(admin pin → module binding → `module.worker` → automatic), and keep secrets-never-escape intact.
**Follow this plan directly — do not re-author or re-litigate its task breakdown.** If you find a
genuine defect in the plan while building, stop and escalate to the Coordinator rather than
silently deviating.
**Risk tier:** `sensitive` — new cross-module shared contract (`ai-service-binding-api.ts` in
`packages/shared`), no migration, no auth/RLS/secrets/rate-limit/network-surface trigger. Standard
QA + an explicit invariant check on completion (DataContextDb/VaultContext use, module isolation,
provider-agnostic AI — no hardcoded provider/model). No Ben sign-off required for merge; auto-merge
+ per-merge digest to Ben once green.
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/915-slice3-structured-ai
**Branch:** feat/915-slice3-structured-ai (off origin/main @ `17eda21c`, which already includes the
merged spec+plan from PR #922 and #913's epic spec from PR #921)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow
this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `ffba9610-00cc-4ebd-b52c-203ab8b521bf` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store; relay successors skip).
2. Read the spec's Slice 3 section (D6) AND the full implementation plan doc IN FULL.
3. Since the plan is already coordinator-approved, you may skip straight to the TDD build step of
   **`coordinated-build`** (no new plan-authoring, no separate plan-approval round-trip) — but
   still follow **`coordinated-wrap-up`** for the PR + report. If your read of the plan surfaces
   any ambiguity or a spec/plan mismatch, stop and escalate to the Coordinator before writing code.
4. Escalation rules, gate commands, and comms conventions are defined in `coordinated-build` — this
   doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.
- Do NOT touch Slices 1/2/4, `#917`'s in-flight worktree, or any other module's internals —
  module isolation invariant applies.

## Collision notes (from the coordinator)

- No migration in this slice — global migration sequence (`#917→#914→#918→#919`) is untouched by
  this build; do not add one.
- New shared contract `packages/shared/ai-service-binding-api.ts` — this is the only new
  cross-module surface; keep it scoped to what the plan specifies (`generateStructured` contract).
  Codex (`w1:pCK`) has already been briefed on this contract for #913 epic alignment — no action
  needed from you there, just build to the plan.
- `foundation.test.ts`'s full-migration-list `toEqual` assertion is NOT touched by this slice (no
  migration) — do not edit it.
