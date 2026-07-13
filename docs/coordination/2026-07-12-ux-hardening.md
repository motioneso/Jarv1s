# Coordination Run — 2026-07-12 UX hardening

**Date:** 2026-07-12
**Merge-authority lock:** label `Coordinator`, Claude session
`58a78927-385c-4b1d-8fa0-94db20255d6f`.
**Delegated lane owner:** label `UX Coordinator`, Codex session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`.
**Merge policy:** the UX lane supervises specs, builders, and QA; the single locked `Coordinator`
remains final merge authority. For the 2026-07-12 overnight run, Ben explicitly delegated all
approval decisions—including security-tier sign-off—to Fable.
**Shared-tree policy:** isolated worktrees; explicit-path staging only; never `git add -A`.
**Grounded on:** `origin/main` `3ca138eb` after #1004 and #1005 merged; post-merge deployment
smokes green, foundation/app CI still running at first-wave worktree creation.
**merges_since_relay:** 0

This is a delegated, collision-partitioned lane under the single merge-authority lock. GitHub #983
and its native sub-issues are the product source of truth; this file tracks only operational state.

## Queue

| Issue | Spec / gate | Provisional tier | Status |
| --- | --- | --- | --- |
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | building on `ux/984-private-history`; label `UX 984 Private History`, session `1a6fcf3b-be9d-4852-b380-2ba84c6e5a1f`, pane `w1:pJB`; Slice 4 blocked on #868 |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | building on `ux/985-yolo-approvals`; label `UX 985 YOLO Approvals`, session `341beba2-3ccd-4c88-b0f8-d29c1058d0ca`, pane `w1:pJC`; fail-closed criterion locked |
| #986 | dedicated settings-shell spec required | routine unless permission behavior changes | needs spec; coordinate-first |
| #987 | dedicated Notes/People UX spec required | sensitive | needs spec |
| #989 | dedicated Sports UX spec required | routine | needs spec |
| #990 | dedicated News UX spec required | routine | needs spec |
| #991 | dedicated Assistant/Priorities delta spec required | sensitive | needs spec; after #985/#986 |
| #992 | dedicated memory-presentation delta spec required | sensitive | needs spec |
| #993 | dedicated host/account/operator delta spec required | security | needs spec; after #986 |
| #994 | dedicated Skills UX spec required | routine | needs spec |
| #995 | dedicated connected-accounts delta spec required | security | needs spec; after #987 |
| #1002 | dedicated promise-inventory spec required | routine | needs spec; after affected UI settles |
| #1003 | Apple protocol/auth design spike + approved feature spec required | security | future feature stream; not a #983 closure blocker |
| #988 | final acceptance/polish checklist | routine/manual | strictly last |

No build agent may start while its spec or latest-main CI gate is unresolved.

## Locked ownership and collisions

The primary Coordinator owns #965 module run-now/install behavior and #1000 UAT install selectors.
The UX lane must not edit `RunNowButton`, `external-module-jobs`, or `module-jobs.ts` for #986.
#986 owns only settings chrome, navigation, grouping, layout, and the two approved section merges; it
must land before #1000 finalizes selectors. Re-sync before touching the Instance-modules pane.

#984 and #985 may run in parallel only when exact chat path locks do not overlap. Serialize
`chat-drawer.tsx`, chat route composition, action cards, and chat styles when either lane needs them.
#1005/#979 merged at `3ca138eb`; the `tests/integration/chat-mcp-transport.test.ts` fence is released.
#985 owns that test and must preserve its deterministic wait.

## Dependency and merge order

1. **Trust wave:** #984 and #985 after spec approval and green latest-main CI. #868 lands before
   #984 final privacy acceptance.
2. **Settings shell:** #986 alone and early, before #1000 selector finalization.
3. **Independent configuration wave:** #987, #989, #990, #992.
4. **Post-shell wave:** #991, #993, #994, then #995 after #987.
5. **Promise reconciliation:** #1002 after the affected settings/module UI settles.
6. **Future promise:** keep #1003 open and honest; it is not part of this UX merge train.
7. **Closing acceptance:** #988 desktop+narrow walkthrough and final polish, last.

## First-wave path locks

### #984

- Frontend: `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/api/client.ts`,
  `apps/web/src/styles/kit-chat.css`, focused chat drawer tests.
- Backend: chat session manager, persistence/live routes, focused resume/private tests.
- #868 alone owns provider transcript cleanup/runtime files.

### #985

- Security: AI gateway native-permission path, chat MCP/route composition, focused gateway/transport
  tests.
- `tests/integration/chat-mcp-transport.test.ts` is released to this lane; preserve #979's merged
  deterministic wait.
- Routine UI: action-request card/styles; smallest shared menu helper plus inventoried menu call sites.
- Any need for `chat-drawer.tsx` waits for #984's lock to release.

## Current gates

- [x] Ownership split confirmed with the primary Coordinator.
- [x] Specs #1004 and flake fix #1005/#979 merged into `origin/main` at `3ca138eb`.
- [x] Post-merge `main` CI run `29228378966` completed green at `3ca138eb`; both deployment smokes
      are green.
- [x] Fable approved #984 Slices 1–3; Slice 4 waits for #868.
- [x] Fable approved #985 with fail-closed effective-YOLO resolution added before security QA.
- [x] Fable ruled that per-card `Always approve` remains absent.
- [x] Exact builder path locks sent to the primary Coordinator before dispatch.
- [x] Isolated worktrees and committed handoffs created for #984 and #985.

## CI waivers

None.

## Fable verdict

- #984: APPROVE Slices 1–3 now; Slice 4 waits for #868 and final cross-engine privacy acceptance.
- #985: APPROVE WITH CHANGES; resolver error/unavailable/non-`true` must fail closed to normal
  confirmation. The criterion is now incorporated.
- `Always approve`: remove/do not build; shipped code has no such card control.

## Reaped sessions

- Prior `UX Coordinator`, Codex session `019f57d6-8fff-7783-974a-f40333a52632`.

## Continuation note — 2026-07-12 UX Coordinator successor adoption

- Successor `UX Coordinator` is driving under Codex session
  `019f5a2e-03fd-71c3-95ab-1934cb1de973`; the primary `Coordinator` remains sole merge authority.
- Re-adopted primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` and active
  `Module Fix 1006+1007` session `37605c40-a379-418a-9dbd-54ac9142aeea` by label and session.
- Main CI run `29228378966` is green at the required `3ca138eb`, releasing #984/#985 dispatch.
- Primary Coordinator acknowledged the successor and retains QA/merge authority for #1007; its
  builder may drive Instance-modules in Playwright but will not edit settings shell/chrome/nav.
- #984 and #985 builders are running on Sonnet in isolated worktrees under the recorded labels and
  sessions; both await coordinator plan approval before feature edits.

## Continuation note — 2026-07-12 UX Coordinator relay

The prior UX Coordinator context compacted before builder dispatch, so the next UX Coordinator must
resume from this note before taking any merge-sensitive action.

- Re-resolve all Herdr pane IDs by label. The primary merge authority remains `Coordinator`, Claude
  session `58a78927-385c-4b1d-8fa0-94db20255d6f`; do not merge from this delegated lane.
- First recheck `main` CI run `29228378966`. If green, dispatch the already-approved #984 and #985
  builders from their committed handoffs, using Sonnet and isolated worktrees, then record their
  labels/panes here as `building`.
- Wave-2 specs for #986, #987, #989, and #990 are consolidated in
  `~/Jarv1s/.claude/worktrees/spec-983-ux-wave2` on branch `spec/983-ux-wave2` at `e6c5afc4`.
  Review them to EOF, push the branch, open one draft docs PR, and request Fable review through the
  primary Coordinator. #987 has two explicit Fable questions about supported manual person creation
  and owner `VaultContext` storage for People canonical notes.
- Then draft #991, #992, #993, #994, #995, and #1002 specs in safe parallel lanes. Keep #988 last
  and #1003 as a separate future iCloud Mail + Calendar feature.
- The primary Coordinator's #1006/#1007 lane does not edit settings UI. This lane explicitly replied
  that it is not mid-edit on Instance-modules and that the #1007 work may proceed. Re-sync only if
  that lane expands into `InstanceModulesPane` or other settings UI code.
