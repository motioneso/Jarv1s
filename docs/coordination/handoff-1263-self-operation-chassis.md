# Build Handoff — self-operation chassis (#1263)

**Spec (approved):** `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`
— you build the **chassis half only**. No new assistant tools ship in this issue.
**GitHub issue:** #1263 (part of epic #1262)
**Risk tier:** `security` — this PR gets adversarial Opus QA + **Ben's merge sign-off**. Build to
that bar. You rewrite the gateway authorization path and introduce the denylist that decides what the
model may ever do.
**Worktree:** `~/Jarv1s/.claude/worktrees/1263-self-operation-chassis`
**Branch:** `1263-self-operation-chassis` (off `origin/main`)
**Build skill path (absolute):**
`~/Jarv1s/.claude/worktrees/1263-self-operation-chassis/.claude/skills/coordinated-build/SKILL.md`
(follow this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `43e5f5e2-0deb-4ab5-9237-436e8795b611` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec above **by section** for your current task only — never in full. A full-read bloats
   a fresh context toward the relay threshold before you write any code. Reading is not progress:
   BUILD, commit per task, relay only past ~80%.
3. Invoke **`coordinated-build`** and follow it end-to-end: verify the spec against your actual
   branch → plan → **coordinator approval (do NOT write code before it)** → TDD build →
   **`coordinated-wrap-up`** (PR + report).

## Scope — six parts, and it is bigger than the issue title

Parts 1–5 are issue #1263 as written. **Part 6 was moved onto you by Ben on 2026-07-26** and is the
bulk of the work.

1. **Declaration field** `granted_at_install | confirm_always` on `ModuleAssistantToolManifest`
   (`packages/module-sdk/src/index.ts:499`). **Do not build a parallel command registry** — the
   manifest already owns name, permission id, action family, risk, execution policy, handler, schemas
   and services, and `gateway.ts:585` executes handlers off it. The denylist is the only new central
   artifact in this entire epic. An agent that starts writing a registry has misread the spec.
2. **Central immutable exclusion set (denylist).** Seven rule categories, enumerated in the spec's
   "Central exclusion set" section. Rules, not just a list: a new operation matching a rule and not
   classified fails the build. A tool author cannot opt out.
3. **Startup/build assertion.** A write tool declaring nothing fails the build. It must **also**
   catch the silent-prompt combination — `granted_at_install` **without** `executionPolicy: "auto"`
   still prompts forever, because `policy.ts:49` requires tier **and** `executionPolicy` **and**
   `allowedTiers`, all three.
4. **Gateway policy ordering.** `gateway.ts:160` evaluates the YOLO branch before `resolvePolicy`.
   Hoist **only** the exclusion check above it. Final order: excluded → deny regardless of YOLO; YOLO
   on → run, still bypassing `confirm_always`, `risk: "destructive"` and `requiresConfirmation`;
   otherwise → ordinary policy, unchanged.
5. **Install-time grant.** No SDK type widening. `defaultTier` is typed
   `"ask_each_time" | "always_confirm"`, so `trusted_auto` can never be a _declared_ default — but
   `policy.ts:47` reads `(await lookup.getFamilyTier(...)) ?? manifest.defaultTier`, so the **stored**
   tier wins. Install persists `trusted_auto` for families whose `allowedTiers` already permit it.
6. **Classify every already-shipped write tool** (moved here from #1265). Your build assertion and
   this classification must land together or your own exit criterion is unreachable.

## Ben's rulings — binding, and they override the spec where they differ

These are reproduced in full below — the coordinator's run manifest is not in your worktree, so this
section is your authoritative copy. Do not re-litigate them; they are the output of two rounds of
adversarial cross-model review plus Ben's own calls. If you believe one is wrong, escalate to the
coordinator and keep building the rest.

- **Nothing in round one is `confirm_always` — with exactly one approved exception,
  `memory.forget`.** If you find yourself wanting a second one, you are wrong about the tool, not
  right about the risk. Escalate instead of declaring it.
  - `memory.remember` (`packages/memory/src/manifest.ts:234`) = `granted_at_install`.
  - `memory.forget` (`:242`, `risk: "destructive"`) = `confirm_always`. Note `policy.ts:37` already
    returns `confirm` for any destructive tool regardless of tier, so this is
    preserved-by-declaration, not new behaviour.
- **`confirm_always` means durable unrecoverable loss and nothing else.** Third-party disclosure,
  scheduled work and externally observable writes are explicitly **not** grounds for a prompt. An
  earlier draft used them as bars, over-classified, and Ben rejected it twice.
- **Do not move `resolvePolicy` ahead of YOLO.** That exact proposal was rejected. YOLO keeps
  bypassing `confirm_always`, `risk: "destructive"` and `requiresConfirmation` — the user accepted the
  risk by turning it on. The only ordering change in this PR is hoisting the **exclusion** check.
- **Every action family in this epic must include `always_confirm` in its `allowedTiers`, and you
  assert that at build.** Reason, verified in code:
  `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId` rejects any tier the family does not list
  (`packages/ai/src/action-policy-routes.ts:90`). A family declared `allowedTiers: ["trusted_auto"]`
  could never be set to always-confirm by the user — and Ben requires that the user can always
  demand a prompt. The policy layer already honours `always_confirm` (it fails the `trusted_auto`
  check and falls through to `confirm`), so **no gateway change is needed for this** — only the
  `allowedTiers` requirement plus the assertion.
- **The install grant must never clobber a user-set tier.** Install persists `trusted_auto`; if a
  reinstall/reconcile re-applies it over a user's `always_confirm`, the override is silently lost.
  Write the precedence rule and a regression test for it.
- **`people.merge` / `people.splitIdentity`** (`packages/people/src/tools.ts:161,179`, both
  destructive): **verify the round-trip before classifying.** If `splitIdentity` restores exact prior
  state → `granted_at_install`. If it does not → escalate to the coordinator, do not guess. "A
  reverse exists" and "the reverse restores exact prior state" are different claims and the spec
  demands a _tested_ reverse.

## The write-tool inventory — the specs undercount it

The specs say 29. Measured on `main` at Phase 0
(`grep -rn 'risk: *"write"\|risk: *"destructive"' packages/*/src`): **39 tools across 11 packages.**

| Package          | Tools | In spec 2's list? |
| ---------------- | ----- | ----------------- |
| tasks            | 13    | yes               |
| news             | 5     | yes               |
| **people**       | **4** | **no**            |
| notes            | 3     | yes               |
| goals            | 3     | yes               |
| commitments      | 3     | yes               |
| **memory**       | **2** | **no**            |
| email            | 2     | yes               |
| calendar         | 2     | yes               |
| **web-research** | **1** | **no**            |
| ai               | 1     | yes               |

Re-measure on your own branch rather than trusting this table — it is a Phase-0 snapshot, and it is
here so you size the work correctly, not so you skip the count.

## Traps that will cost you a day each

- **The auto-run trap.** `trusted_auto` can never be a _declared_ default (the `defaultTier` type
  forbids it). The stored tier wins. Install persists it as **data**. No SDK widening.
- **The silent-prompt combination.** `granted_at_install` without `executionPolicy: "auto"` prompts
  forever and **no test catches it** unless your assertion does. This is why part 3 is explicit.
- **The no-family trap.** `policy.ts:40` returns `confirm` for any write tool with no
  `actionFamilyId`. That is why all five news write tools prompt on every call today.
- **Never edit an applied migration** — the runner hash-checks applied files. New file only. Module
  SQL lives in the owning module's `sql/`, never `infra/postgres/migrations/`.
- **Background bash ending in `tail` masks a failing gate as exit 0.** Never `| tail` the gate.

## Exit

`pnpm verify:foundation` green **with a real exit code** (never `| tail`). No user-visible behaviour
change — nothing for the release note beyond enabling what follows. Your PR body needs the
user-facing summary line anyway; "Nothing directly; this is the groundwork for Jarvis being able to
change its own settings" is accurate.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`. Other sessions share `~/Jarv1s`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.

## Collision notes (from the coordinator)

- **You land first and alone.** #1264 (settings tools) and #1265 (news/sports content) are both
  blocked on your merge because they build on the exact `ModuleAssistantToolManifest` shape you
  define. Nothing else is in flight — you will not hit a rebase conflict from a sibling.
- **You own the only migration in this run**, if you need one. #1264 adds one after you; do not
  assume a migration number — landing order assigns it.
- Issue **#1266** (user-facing always-confirm override screen) is **not yours** and has no approved
  spec. Build the `allowedTiers` requirement and the install-grant precedence rule; do **not** build
  a settings screen.
