# Handoff — #1311: the install-time grant never applies to default-enabled modules

**Issue:** #1311 · **Branch:** `1311-install-grant` off `origin/main` ·
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/1311-install-grant` · **Tier:** `security` —
this changes how self-operation trust is granted, so it does not merge without Ben's sign-off.

**Coordinator:** label `Coordinator`, Claude session `43e5f5e2-0deb-4ab5-9237-436e8795b611`.
Report to the `Coordinator` label via the `herdr-pane-message` skill. Follow `coordinated-build`.

**This unblocks other work.** PR #1273's mandatory exit criterion is a real dev-instance Playwright
run in which *no confirmation card appears anywhere*. It cannot pass while this bug exists. Land
this and that criterion becomes reachable — so treat it as on the critical path, not as cleanup.

## The defect

A tool declaring `selfOperationGrant: "granted_at_install"` is supposed to be trusted from the
moment its module is installed — the user consented by installing it, and should not be asked again.
In practice the assistant shows a confirmation card on the first write, every time, because no grant
row is ever written.

What the coordinator observed (verify all of it yourself — do not trust this brief):

- The install-time trust row appears to be written **only** by a module *enable* PATCH handler.
- `news` and `sports` both declare `availability: { defaultEnabled: true, required: false }`
  (`packages/news/src/manifest.ts:69`, `packages/sports/src/manifest.ts:56`). A default-enabled
  module is never explicitly enabled by anyone, so that handler never fires and the grant is never
  recorded. Same for a `required` module such as `settings`.
- `tasks` appears to work only because it carries its own compatibility helper that writes the row
  itself. Its healthy behaviour therefore proves nothing about the generic path — do not use it as
  evidence the mechanism works.
- The declaration-time validation in `packages/ai/src/gateway/self-operation.ts` (around line 312)
  is the vocabulary to read first: `granted_at_install` requires write risk, auto execution policy,
  and a trusted action family allowing both `trusted_auto` and `always_confirm`.

Start by finding every writer of that trust row and proving which module lifecycle paths reach it.

## What must be true when you're done

1. A module whose tools declare `granted_at_install` is trusted from install — **including modules
   that are `defaultEnabled` and modules that are `required`**, which are never explicitly enabled.
2. The `tasks` compatibility helper is no longer the thing making `tasks` work. Either it becomes
   redundant and is removed, or you state plainly why it must stay.
3. **A confirmation card does not appear** for a `granted_at_install` tool on a real dev instance.
   Prove it with an e2e UAT that drives chat turn → tool → DOM and asserts on what the user sees.
4. Existing behaviour for `confirm_always` and `user_promotable` is unchanged — those still prompt.
   A test proving a `confirm_always` tool **still asks** is required; otherwise this fix is
   indistinguishable from "we stopped prompting for everything".
5. `pnpm verify:foundation` green with a real exit code. Never `| tail` or `| head` a gate command.

## Hard stops — read these twice

- **Never widen a family `defaultTier`, change a grant value, edit `allowedTiers`, or loosen
  `policy.ts` to make a test pass.** Change the test, never the policy. Never revert to fail-open.
  If a policy change looks genuinely necessary, stop and escalate `[SECURITY]` to the coordinator.
- The three grant values are `granted_at_install` | `confirm_always` | `user_promotable`. The tier
  vocabulary is `ask_each_time` | `trusted_auto` | `always_confirm`. `confirm_once` is not real.
- This must not become a way for a module to grant itself authority it did not declare.

## Bans and constraints

- Do not edit `docs/coordination/` (coordinator-only). Do not run repo-wide `pnpm format`.
- Never `git add -A` / `git add .` — stage explicit paths only.
- Any test or DB operation must set `JARVIS_PGDATABASE` to an isolated database. Never the shared
  dev DB.
- CLAUDE.md hard invariants apply — private by default, `DataContextDb` only, `AccessContext` is
  `{ actorUserId, requestId }` only, secrets never escape, metadata-only job payloads, module
  isolation. Migrations `0175`/`0176`/`0177` are applied and FROZEN; add a new file if you need SQL,
  and module SQL lives in the owning module's `sql/` directory.
- Two other lanes are live: PR #1276 on `1264-settings-self-operation` (settings + web shell) and
  PR #1273 on `1265-module-content-self-operation` (news/sports content tools). Expect to rebase
  after they land. Do not edit either branch.
- Escalate with `[SECURITY]` / `[DESIGN-FORK]` / `[CRIT]` tags so the coordinator routes correctly.
