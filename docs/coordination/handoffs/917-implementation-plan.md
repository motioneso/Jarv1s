# Plan Handoff — #917 Open module system Slice 1

**Spec (approved):** `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md`
(§Build slices — Slice 1). Merged to main via PR #911 (`90cc89d7`).
**GitHub issue:** #917 — "Open module system Slice 1: external manifest loader + fail-closed activation"
**Risk tier:** `security` (external manifest loader, `JARVIS_ENABLE_EXTERNAL_MODULES` gate,
fail-closed activation semantics, path-bounds/hash validation on untrusted package input — treat
build to the adversarial-QA bar even though this task is plan-authoring only, not code).
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/917-implementation-plan`
**Branch:** `plan/917-open-module-system-slice1` (off `origin/main` @ `204aca0f`)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time.
**Coordinator session id:** `395b82b5-c8a5-40fe-95a9-dc8575d8380c` (immutable authority).
**Relay trigger:** context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Task

This is a **plan-authoring task, not a build task.** #917 already has an approved spec (above) —
what's missing is the implementation plan that `coordinated-build` requires before any code is
written. Per Ben (2026-07-09): move this planning work to Opus xhigh, running alongside the
existing Fable 5 agent (`w1:pCR`, worktree `review-913-job-search-spec`) which continues its own
`#915` spec-review work undisturbed — you are not replacing it, you are a parallel lane.

1. `[ -d node_modules ] || pnpm install`.
2. Read the approved spec IN FULL (path above), focusing on §Build slices — Slice 1, and its
   scope as restated in the #917 issue body:
   - Read `jarvis.module.json` from `JARVIS_MODULES_DIR` only when
     `JARVIS_ENABLE_EXTERNAL_MODULES=1`.
   - Add `app.external_modules` migration in `packages/settings/sql/` (+ its row in the
     `foundation.test.ts` full-list `toEqual` assertion; run full `test:integration`).
   - Validate external package manifests: path bounds, module-id prefixes, duplicate ids, package
     hash, contract versions.
   - List discovered modules in `/api/modules` and settings; inactive unless `status = 'enabled'`;
     auto-disable on manifest/package hash drift; trusted-operator warning.
   - Server-only loader (`@jarv1s/module-registry/node` or equivalent) — no `node:*`/`fs` imports
     reachable from browser bundles.
   - No custom UI, credentials, KV, or assistant tool execution in this slice (later slices).
3. Invoke **`superpowers:writing-plans`** to author the implementation plan for #917 against this
   scope. Ground every file/module claim by reading current code first (do not assume prior specs'
   structure still matches — the module-registry/settings packages may have moved since the spec
   was written).
4. When the plan is drafted, message the `Coordinator` (this session) with a pointer to the plan
   doc/PR — do NOT self-approve. The coordinator (and/or Ben, given `security` tier) reviews before
   any build lane spawns against it.
5. Do not write feature code in this worktree — this lane's deliverable is the plan only.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.
- Do not touch `.claude/worktrees/review-913-job-search-spec` (Fable 5's active lane) or
  `/tmp/jarv1s-913-spec` (Codex's draft epic spec, exempt from cleanup) — read-only reference only
  if you need cross-context, never edit.

## Collision notes (from the coordinator)

- #917 is the dependency root for this wave (Phase-0 collision map, `docs/coordination/2026-07-09-job-search-overnight.md`):
  #914/#918/#919/#916/#915 all serialize strictly behind it. Your plan does not need to account
  for their content, but should not preclude #914's already-merged spec assumptions (per-module
  ledger, `ctx.db` seam) — read `docs/superpowers/specs/2026-07-09-module-data-plane.md` on main
  for that context if useful.
- Migration numbering is global by landing order (CLAUDE.md hard invariant) — your plan should
  flag that #917's migration number is NOT yet assigned (assigned by the coordinator at build
  time, based on what's landed by then), not hardcode a specific number.
