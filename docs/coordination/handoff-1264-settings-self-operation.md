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

## Coordinator rulings issued mid-run — binding, survive compaction

Added 2026-07-27 after two contexts in this lane ended with no plan on disk. These were previously
delivered only as pane messages; they are recorded here so a compacted or relayed successor can
recover them by re-reading this file. **Re-read this section after any compaction.**

1. **The prerequisite PR is already satisfied — do not build it.** `callTool`'s tool lookup already
   goes through `executableTools()`, which drops `isSelfOperationExcluded` tools at
   `packages/ai/src/gateway/gateway.ts:592` ("Fail closed #0"), structurally ahead of the YOLO branch
   at `:161`. Both execute call sites (`:355` read, `:431` write) resolve only via
   `executableTools()`. Verified in code by the coordinator, not taken from a report. If you find any
   execution path that resolves a tool **without** `executableTools()`, that is stop-and-escalate.

2. **Digest is DROPPED from this lane's scope.** The spec contradicts itself — line 42 classifies
   digest settings as `granted_at_install`, line 82 lists digest scheduling under exclusion category
   7 (external effect), and the shipped denylist implements line 82 (`settings.digest.` at
   `packages/ai/src/gateway/self-operation.ts:153`). **Renaming the tool to escape the prefix was
   proposed and refused**: the denylist is prefix-matched on the tool name, so a rename resolves a
   security exclusion by choosing a different string — if that works, the denylist is decorative.
   Parked for Ben in `AWAITING-BEN.md` §3b. Build everything else; do not reintroduce digest.

3. **Three migrations, not two.** The `revision` columns are one part. The third is easy to miss:
   widening the audit `outcome` CHECK constraint at
   `packages/ai/sql/0127_jarvis_action_audit_log.sql:10` (currently
   `'success','failed','denied','cancelled'`) to admit `invalid`/`conflict`. **Never edit 0127** —
   applied migrations are hash-checked; add a new file in `packages/ai/sql/`. The TS union widening
   and the CHECK widening must land in the same commit or the two disagree at runtime.

4. **chat-response-style: in scope, but the tool belongs to the CHAT module.** The spec classifies it
   `granted_at_install`, so scope is settled; module isolation means it is declared in
   `packages/chat/src/manifest.ts` (its `assistantTools` array already exists at `:171`) and calls
   chat's own write path — settings must not reach into chat internals. There are zero `chat.`
   prefixes in `SELF_OPERATION_EXCLUSIONS`, so nothing centrally blocks it. **The closed enum is
   load-bearing**: the only reason this is not assistant-brain-excluded is that the value is a
   three-value enum rendered through a server-owned template. The tool input takes that enum and
   nothing else, validated server-side, rejecting anything unrecognised — no free-text field, no
   passthrough string, no "custom" escape. If free text can reach the system prompt through this
   tool, stop and escalate rather than granting it at install. Count consequence: this moves the
   **chat** package's inventory in `tests/unit/self-operation-manifests.test.ts`, not settings'.

5. **Write the plan to disk before further reading.** Four contexts across this epic have now ended
   with nothing committed. Reading is not progress. State assumptions inline rather than leaving to
   verify them — the coordinator corrects a wrong assumption far more cheaply than the lane pays for
   another relay.
