# Coordination Run — 2026-07-12 UX hardening

**Date:** 2026-07-12
**Merge-authority lock:** label `Coordinator`, Claude session
`58a78927-385c-4b1d-8fa0-94db20255d6f`.
**Delegated lane owner:** label `UX Coordinator`, Codex session
`019f57d6-8fff-7783-974a-f40333a52632`.
**Merge policy:** the UX lane supervises specs, builders, and QA; the single locked `Coordinator`
remains final merge authority. Security-tier work also needs Ben's explicit sign-off.
**Shared-tree policy:** isolated worktrees; explicit-path staging only; never `git add -A`.
**Grounded on:** `origin/main` `3614ad1e` (preflight green in detached worktree).
**merges_since_relay:** 0

This is a delegated, collision-partitioned lane under the single merge-authority lock. GitHub #983
and its native sub-issues are the product source of truth; this file tracks only operational state.

## Queue

| Issue | Spec / gate | Provisional tier | Status |
| --- | --- | --- | --- |
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | draft awaiting Ben approval; #868 dependency |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | draft awaiting Ben approval |
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
While #979 is in flight, #985 must not edit
`tests/integration/chat-mcp-transport.test.ts`; the primary Coordinator will release that lock after
#979 merges.

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
- Temporary exclusion: `tests/integration/chat-mcp-transport.test.ts` remains locked by #979 until
  its merge ping.
- Routine UI: action-request card/styles; smallest shared menu helper plus inventoried menu call sites.
- Any need for `chat-drawer.tsx` waits for #984's lock to release.

## Current gates

- [x] Ownership split confirmed with the primary Coordinator.
- [x] Detached grounding preflight green at `3614ad1e`.
- [ ] Latest `main` CI run `29225249135` completes green (deployment-smoke jobs already green;
      foundation/app still running at manifest creation).
- [ ] Ben approves the two first-wave delta specs and this manifest.
- [ ] Ben decides whether per-card `Always approve` is removed (recommended) or separately specified.
- [ ] Exact builder path locks sent to the primary Coordinator before dispatch.

## CI waivers

None.

## Outstanding escalations

- [ ] Product decision: remove per-card `Always approve` (recommended), or define a separate granular
      trust policy; true YOLO itself is already locked.

## Reaped sessions

- None.
