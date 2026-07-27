# Build Handoff — module self-operation, settings commands

**Spec (approved):** `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`
**GitHub issue:** #1264 (Part of epic #1262)
**Risk tier:** `security` — this PR gets adversarial Opus QA plus a posted verdict before it can
merge. Build to that bar. You add a core-owned migration on the shared `app.preferences` table, a
per-tool authorization callback, and the rule that decides what the model may change about its own
permissions. The spec's own exit line is "Security QA on Opus."
**Worktree:** `~/Jarv1s/.claude/worktrees/1264-settings-self-operation`
**Branch:** `1264-settings-self-operation` (off `origin/main`, **after #1263 has merged**)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`. Before messaging, confirm
`herdr pane list` shows exactly one pane with that label, resolved fresh (never a cached pane
number — they reflow).
**Coordinator session id:** `43e5f5e2-0deb-4ab5-9237-436e8795b611` (immutable authority; the label
is only routing).
**Relay trigger:** your context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately. Relaying is protocol, not failure.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read the spec **by section, for your current task only** — never in full. A full read bloats a
   fresh context before you write any code and forces a relay with nothing to show for it. Reading
   is not progress: build, commit per task, relay only past ~80%.
3. Invoke **`coordinated-build`** and follow it end to end: verify the spec against your actual
   branch → plan → coordinator approval (do **not** write code before it) → TDD build →
   **`coordinated-wrap-up`** (PR + report).

## What #1263 already did — do not redo or undo it

The chassis has landed. Build on it; do not re-litigate it.

- Every write tool carries `selfOperationGrant`, one of `granted_at_install` | `confirm_always` |
  `user_promotable`. **A tool that declares nothing fails the build.** That build failure is the
  safety property — never "fix" a failure by deleting the declaration requirement.
- All 39 already-shipped write tools were classified in #1263 (Ben's fork-A ruling). Your new
  settings tools need declarations; the existing ones are done.
- The startup assertion covers built-in manifests only. External modules are #1267 and are out of
  scope here — an external write tool with no family already confirms via
  `packages/ai/src/gateway/policy.ts:40`.

## Standing rulings — binding, carry them into every task

1. **Widening any `defaultTier` is a hard stop condition for this epic.** If a tool cannot do what
   it needs to, the fix comes from the **grant** side, never by loosening a family's default. If you
   think a default must widen, stop and message the coordinator.
2. **Every family must include `always_confirm` in `allowedTiers`.** The user can always demand the
   prompt back. A family that cannot be set back to always-confirm is a defect.
3. **`confirm_always` implies NOT PROMOTABLE** — never "implies destructive". `web.read` is a
   deliberate exception living at `risk: "write"` with no `actionFamilyId`; do not tidy it to match
   the others.
4. **No tool may take a preference key as a parameter.** A key-taking tool is a hole straight
   through the whole design — the model could promote itself. `settings.yolo.*` and
   `settings.actionPolicy.tier.*` are centrally excluded; keep them that way and prove it with a
   test that fails if the exclusion list is emptied.
5. **Audit every reader of the action-policy preference keys** —
   `assistant.action_policy.v1.<moduleId>.<familyId>` — **including legacy keys and compatibility
   resolvers**, not just callers of `listActionPolicies`. This rule is amended from the narrower
   one: a security review of #1263 found a legacy dual-key resolver in
   `packages/tasks/src/action-policy.ts` that reads the preference key directly and was invisible to
   a `listActionPolicies` audit by construction. If you add a reader, say so in your PR.
6. **Ben's fork-B ruling stands:** `memory.remember` is `granted_at_install`, `memory.forget` is
   `confirm_always`. An agent proposing to "correct" this is wrong — cite this line.

## Collision notes (from the coordinator, verified at Phase 0 — not assumed)

- **#1265 runs in parallel with you.** Verified non-overlapping on source: you own
  `packages/settings/src/*` and `packages/structured-state/src/preferences-repository.ts`; it owns
  `packages/news/src/*` and `packages/sports/src/*`.
- **The one real shared surface is the built-in inventory assertion** in
  `tests/unit/self-operation-manifests.test.ts`. Both of you add write tools, so both change the
  exact counts. Whichever PR lands second rebases and updates the numbers. **Do not loosen the
  assertion into a range or a `toBeGreaterThan` to dodge the conflict** — the exactness is the
  point, and a rebase conflict there is cheap. Counting gotcha: People declares its grants in
  `packages/people/src/tools.ts`, not a `manifest.ts`; a count derived by grepping only
  `manifest.ts` files is wrong.
- **Yours is the only migration in this run**, so there is no global migration-number race — but
  migration numbers are still assigned by landing order. Never edit an applied migration; add a new
  file. Module SQL lives in the owning module's `sql/` directory.

## Run-specific bans (non-negotiable)

- Work only in this worktree/branch. `git add` by explicit path — never `git add -A`, `git add .`,
  or a repo-wide `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), `docs/superpowers/plans/`, the project board,
  milestones, or merge anything.
- Any test run sets `JARVIS_PGDATABASE` to an isolated database — never the shared dev DB.
- Never pipe a gate command through `tail` or `head`; it masks a failing gate as exit 0. Report real
  exit codes.
- No secrets in any doc, payload, log, or prompt.
