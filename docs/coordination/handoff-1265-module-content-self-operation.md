# Build Handoff — module content self-operation (news retrofit + sports)

**Spec (approved):** `docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md`
**GitHub issue:** #1265 (Part of epic #1262)
**Risk tier:** `security` — this PR gets adversarial Opus QA plus a posted verdict before it can
merge. Build to that bar. You are changing what executes without a prompt, and you add an SSRF
containment check on a network-exposed surface (`news.previewSource`, `externalContent: true`).
**Worktree:** `~/Jarv1s/.claude/worktrees/1265-module-content-self-operation`
**Branch:** `1265-module-content-self-operation` (off `origin/main`, **after #1263 has merged**)
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

## Scope correction — read this before you plan

**The bulk retrofit is NOT yours.** Your spec's scope item 7 says #1265 classifies the shipped write
tools. Ben ruled otherwise at Phase 0 (fork A): **the classification of all 39 already-shipped write
tools landed in #1263**, alongside the build assertion. Do not redo it, and do not reclassify what
#1263 already declared.

What remains yours: the news action-family and `executionPolicy` work, the `guidance` prompt-shaping
question, the `previewSource` SSRF check, and the sports follow/unfollow build. If the spec text and
this section disagree, this section wins — and tell the coordinator which line disagreed rather than
silently reconciling it.

## What #1263 already did — do not redo or undo it

- Every write tool carries `selfOperationGrant`, one of `granted_at_install` | `confirm_always` |
  `user_promotable`. **A tool that declares nothing fails the build.** That build failure is the
  safety property — never "fix" a failure by deleting the declaration requirement.
- The startup assertion covers built-in manifests only. External modules are #1267 and out of scope
  — an external write tool with no family already confirms via
  `packages/ai/src/gateway/policy.ts:40`.

## Standing rulings — binding, carry them into every task

1. **Widening any `defaultTier` is a hard stop condition for this epic.** If a tool cannot do what
   it needs to, the fix comes from the **grant** side, never by loosening a family's default. If you
   think a default must widen, stop and message the coordinator.
2. **Every family must include `always_confirm` in `allowedTiers`.** The user can always demand the
   prompt back.
3. **`confirm_always` implies NOT PROMOTABLE** — never "implies destructive". `web.read` is a
   deliberate exception at `risk: "write"` with no `actionFamilyId`; do not tidy it to match the
   others, and do not give it a family. Web research has no approved spec and is out of scope for
   the whole epic.
4. **Audit every reader of the action-policy preference keys** —
   `assistant.action_policy.v1.<moduleId>.<familyId>` — **including legacy keys and compatibility
   resolvers**, not just callers of `listActionPolicies`. A security review of #1263 found a legacy
   dual-key resolver in `packages/tasks/src/action-policy.ts` that reads the preference key directly
   and was invisible to a `listActionPolicies` audit by construction. If you add a reader, say so in
   your PR.
5. **Ben's fork-B ruling stands:** `memory.remember` is `granted_at_install`, `memory.forget` is
   `confirm_always`. An agent proposing to "correct" this is wrong — cite this line.
6. **`risk: "destructive"` can never auto-run** (`policy.ts:36-37` confirms regardless of tier). So
   declaring `granted_at_install` on a destructive tool is a silent lie that prompts forever. If a
   tool needs to auto-run, it has to genuinely not be destructive — that is a product decision, so
   escalate it rather than downgrading the risk field to make a test pass.

## Collision notes (from the coordinator, verified at Phase 0 — not assumed)

- **#1264 runs in parallel with you.** Verified non-overlapping on source: you own
  `packages/news/src/*` and `packages/sports/src/*`; it owns `packages/settings/src/*` and
  `packages/structured-state/src/preferences-repository.ts`.
- **The one real shared surface is the built-in inventory assertion** in
  `tests/unit/self-operation-manifests.test.ts`. Both of you add write tools, so both change the
  exact counts. Whichever PR lands second rebases and updates the numbers. **Do not loosen the
  assertion into a range or a `toBeGreaterThan` to dodge the conflict** — the exactness is the
  point, and a rebase conflict there is cheap. Counting gotcha: People declares its grants in
  `packages/people/src/tools.ts`, not a `manifest.ts`; a count derived by grepping only
  `manifest.ts` files is wrong.
- **#1264 owns the only migration in this run.** No migration was identified for you — sports
  follows and news tables already exist. If you conclude you need one, stop and message the
  coordinator first; migration numbers are global and assigned by landing order.

## Run-specific bans (non-negotiable)

- Work only in this worktree/branch. `git add` by explicit path — never `git add -A`, `git add .`,
  or a repo-wide `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), `docs/superpowers/plans/`, the project board,
  milestones, or merge anything.
- Any test run sets `JARVIS_PGDATABASE` to an isolated database — never the shared dev DB.
- Never pipe a gate command through `tail` or `head`; it masks a failing gate as exit 0. Report real
  exit codes.
- No secrets in any doc, payload, log, or prompt.
