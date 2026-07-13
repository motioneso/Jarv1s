# Coordination Run — 2026-07-12 UX hardening

**Date:** 2026-07-12
**Merge-authority lock:** label `Coordinator`, Claude session
`58a78927-385c-4b1d-8fa0-94db20255d6f`.
**Delegated lane owner:** label `UX Coordinator`, Codex session
`019f5a70-28e9-7600-a132-64ab2eca669c`.
**Merge policy:** the UX lane supervises specs, builders, and QA; the single locked `Coordinator`
remains final merge authority. For the 2026-07-12 overnight run, Ben explicitly delegated all
approval decisions—including security-tier sign-off—to Fable.
**Shared-tree policy:** isolated worktrees; explicit-path staging only; never `git add -A`.
**Agent runtime policy:** this UX coordinator may spawn only Codex build and QA agents, using
`codex -s danger-full-access -a never`. This user directive overrides the `coordinate` skill's
Claude/Sonnet spawn examples. Existing Claude builders must stop at their next safe checkpoint;
the coordinator replaces them with Codex before another feature task begins.
**Grounded on:** `origin/main` `3ca138eb` after #1004 and #1005 merged; post-merge deployment
smokes green, foundation/app CI still running at first-wave worktree creation.
**merges_since_relay:** 0

This is a delegated, collision-partitioned lane under the single merge-authority lock. GitHub #983
and its native sub-issues are the product source of truth; this file tracks only operational state.

## Queue

| Issue | Spec / gate | Provisional tier | Status |
| --- | --- | --- | --- |
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | Task 3 committed at `598fde88` with focused 5/5 and typecheck green; Task 4 building on `ux/984-private-history`; label `UX 984 Private History Codex`, session `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, pane `w1:pK3`; Slice 4 blocked on #868 |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | Tasks 1-3 and partial Task 4 committed through `fd73a7bb`; Task 4 remaining call-site conversions building on `ux/985-yolo-approvals`; label `UX 985 YOLO Approvals Codex`, session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, pane `w1:pK2`; `activityVerb()` release and fail-closed criterion locked |
| #986 | `2026-07-12-settings-shell-navigation-ia-hardening.md` | routine | Task 5 committed at `4bf0b50b` with focused checks/typecheck/Prettier green; Task 6 building on `ux/986-settings-build`; label `UX 986 Settings Shell Codex`, session `019f5a67-9a38-77e0-814a-bc082b0ce187`, pane `w1:pJZ` |
| #987 | `2026-07-12-notes-people-source-picker-hardening.md` | sensitive | approved; worktree/handoff ready on `ux/987-notes-people-build`; held behind #986's `settings-personal-data-panes.tsx` lock |
| #989 | `2026-07-12-sports-settings-dogfood-hardening.md` | routine | PR #1009 format fix `c1093427` green locally; live UAT blocked on bootstrap-owner session. Invalid directly activated test account `sports-uat-1009-004221@example.test` is quarantined and awaits owner-UI deletion; no evidence from it is valid. Label `UX 989 Sports Settings Codex`, session `019f5a67-99f4-7880-b8f4-e4fe04c8af67`, pane `w1:pJY` |
| #990 | `2026-07-12-news-settings-dogfood-hardening.md` | routine | Tasks 1-2 committed (`bf9300f8`, `eacd1644`); Task 3 intentional RED state resumed from `2026-07-13-news-settings-990-relay4.md` on `ux/990-news-settings-build`; label `UX 990 News Settings Codex`, session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`, pane `w1:pK1` |
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
- [x] Fable approved #986, #987, #989, and #990 on draft PR #1008.
- [x] Fable approved #987's separate manual note-first creation flow and owner `VaultContext`
      storage boundary.
- [x] Isolated worktrees and committed handoffs created for #986, #987, #989, and #990.

## CI waivers

None.

## Fable verdict

- #984: APPROVE Slices 1–3 now; Slice 4 waits for #868 and final cross-engine privacy acceptance.
- #985: APPROVE WITH CHANGES; resolver error/unavailable/non-`true` must fail closed to normal
  confirmation. The criterion is now incorporated.
- `Always approve`: remove/do not build; shipped code has no such card control.
- #986: APPROVE at routine tier; preserve the explicit non-admin deep-link regression.
- #987: APPROVE at sensitive tier. Keep manual creation separate and note-first; keep canonical
  People notes in owner `VaultContext`, separate from operator mounts. If a refresh response schema
  is added, declare all four counters and test through `app.inject`.
- #989: APPROVE at routine tier.
- #990: APPROVE at routine tier; fetch/rebase before build because #981's News settings file is a
  live collision surface.

## Reaped sessions

- Prior `UX Coordinator`, Codex session `019f57d6-8fff-7783-974a-f40333a52632`.
- Prior #985 builder, Claude session `341beba2-3ccd-4c88-b0f8-d29c1058d0ca`.
- Prior #984 builder, Claude session `1a6fcf3b-be9d-4852-b380-2ba84c6e5a1f`.
- Prior #990 builder, Claude session `7fb324d8-38fa-43be-bc2c-8304acd0e725`.
- Prior #989 builder, Claude session `888f3c71-6996-49e1-9dbe-921e829abe55`.
- Prior #986 builder, Claude session `11054b23-df91-4b09-b001-38ec31951d9d`.
- Prior #989 v2 builder, Claude session `40d0423b-3209-43c9-9998-d00e434e9897`.
- Prior #984 v2 builder, Claude session `56deb6ca-252b-4f8e-b9b9-b5f5d819c2ea`.
- Prior #990 v2 builder, Claude session `5663beab-07c4-4691-9dc8-2b1b94869ea2`.
- Prior #985 v2 builder, Claude session `1f79649d-8403-4988-a3de-317203fc3aa3`.
- Prior #986 v2 builder, Claude session `ad66ce73-17b5-462e-b3d2-615038ad39d6`.
- QA #1009 Sports Settings, Claude session `97854221-7fe3-4c3f-b7b7-e91a9e5d2036`.
- Prior #986 v3 builder, Claude session `2080b7b0-39cd-418b-869e-369c693972b9`.
- Prior #989 v3 builder, Claude session `da980b16-d458-4213-ab02-7a34ba852971`.
- Prior #986 v4 builder, Claude session `4f7ea499-7243-4415-abef-a159483d0cfe`.
- Prior `UX Coordinator`, Codex session `019f5a2e-03fd-71c3-95ab-1934cb1de973`.
- Prior #990 v3 builder, Claude session `4e2afa97-5c55-417c-9bec-a07534cb3c98`.
- Prior #984 v3 builder, Claude session `9d7e2453-ea7f-4b9c-ac1d-af73e9347197`.
- Prior #985 v3 builder, Claude session `159e8723-d2f3-40f8-8d01-c621d537081d`.

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

## Continuation note — 2026-07-12 active UX successor

- `UX Coordinator` Codex session `019f5a2e-03fd-71c3-95ab-1934cb1de973` is driving this delegated
  lane; primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge
  authority. Never merge from this lane.
- Prior UX session `019f57d6-8fff-7783-974a-f40333a52632` was verified by label plus session and
  reaped.
- #984 and #985 builders are live on Sonnet under the labels/sessions recorded in the queue and
  await plan approval before feature edits. Preserve their path locks.
- Wave-2 docs are published as draft PR #1008. Fable review was requested through the primary
  Coordinator. Fable approved all four specs and both #987 decisions in a durable PR comment.
- #986, #989, and #990 are live on Sonnet under the labels/sessions recorded in the queue. #987's
  worktree and handoff are ready but dispatch remains held behind #986's shared pane lock.
- The primary Coordinator verified the live #1007 worktree is collision-clear for #986: no edits to
  settings admin/page files, shared Playwright fixtures/selectors, or Instance-modules UI. Its UAT
  script is new and self-contained. #986 was explicitly released to open its owned settings paths.
- #984 hit the compaction tripwire with only an untracked plan draft; immediate relay was ordered.
  #985 already committed a relay handoff with no feature code; immediate successor spawn was
  ordered. Re-adopt both successors by label+session before approving either plan.
- #984's six-task plan was approved pre-code: private activation race, owner-scoped server truth,
  one-shot bounded resume replay, unified History resume, exclusive History presentation, and gate.
  The successor may build after it reports its immutable session; Slice 4/#868 stays excluded.
- #985 successor `UX 985 YOLO Approvals v2` session
  `1f79649d-8403-4988-a3de-317203fc3aa3` was verified driving the same worktree on Sonnet; its
  predecessor was identity-checked and reaped. Await the v2 plan before feature edits.
- #984 successor session `56deb6ca-252b-4f8e-b9b9-b5f5d819c2ea` was verified driving the approved
  plan in the same worktree on Sonnet; its predecessor was identity-checked and reaped.
- #989's six-task Sports plan was approved pre-code with its four-file module lock intact; its 70%
  relay is in progress. Re-adopt the Sonnet successor before code.
- #986's ten-task, four-slice Settings plan was approved pre-code after the primary Coordinator's
  live collision clearance; its checkpoint relay is in progress. Re-adopt the Sonnet successor
  before code.
- #989 successor `UX 989 Sports Settings v2` session
  `40d0423b-3209-43c9-9998-d00e434e9897` and #986 successor `UX 986 Settings Shell v2` session
  `ad66ce73-17b5-462e-b3d2-615038ad39d6` were verified driving their approved Task 1 on Sonnet;
  both predecessors were identity-checked and reaped.
- #985's four-task plan is approved. Code graph confirmed `activityVerb()` has one caller and would
  mislabel the new `allowed` outcome as Denied. #985 owns that exact three-line hunk atomically with
  Tasks 1–2 after #984 explicitly releases it; Tasks 3–4 are collision-clear now.
- #984 crossed the relay trigger during Task 3; immediate relay was ordered with the hunk-release
  question carried forward. #989 Task 1 landed at `827d37fe` with 24 focused tests green and its
  70% relay is in progress.
- #989 v3 session `da980b16-d458-4213-ab02-7a34ba852971` was verified driving Task 2 in the same
  worktree on Sonnet; v2 was identity-checked and reaped.
- #990's four-task plan was approved with one required acceptance-only change: its local stateful
  Playwright mock must prove existing Retry validation queues revalidation and exposes queued/error
  feedback. No shared retry code or new unit suite is needed. V2 was checkpoint-relayed pre-code at
  67%; re-adopt the Sonnet successor before Task 1.
- #984 Task 1 landed at `a0989815` with E2E green. V3 session
  `9d7e2453-ea7f-4b9c-ac1d-af73e9347197` was verified driving Task 2 on Sonnet; v2 was reaped.
  #984 explicitly released `activityVerb()` after confirming no overlap in Tasks 1–6.
- The exact `activityVerb()` release was delivered to #985, clearing Tasks 1–2 atomically with the
  truthful `allowed` rendering. #985 remained pre-code and hit 71%; checkpoint relay was ordered
  with plan approval carried forward.
- #990 amended Task 4 with the required Retry-validation queued/error Playwright path and committed
  the plan at `0006fd5a`. V3 session `4e2afa97-5c55-417c-9bec-a07534cb3c98` was verified driving
  TDD in the same worktree on Sonnet; v2 was identity-checked and reaped.
- #985 committed its approved plan plus lock-aware build handoff at `0003d1ac`. V3 session
  `159e8723-d2f3-40f8-8d01-c621d537081d` was verified driving Task 2 in the same worktree on
  Sonnet; v2 was identity-checked and reaped.
- #986 Tasks 1–3 landed at `f67cf52b`, `56e8cb3d`, and `51f092a4`. V2 is relaying at 72% during
  Task 4; the discovered Account-and-preferences merge plan gap is documented and folded into that
  approved task without a product fork. Await the successor identity before reaping v2.
- #989 Tasks 1–4 are committed through `26e2a2f1` and green in the same v3 session; Task 5 focused
  Playwright work is active. No coordinator action is pending.
- #986 committed its Task-4 continuation at `bf96e51f`. V3 session
  `2080b7b0-39cd-418b-869e-369c693972b9` was verified resuming Task 4 in the same worktree on
  Sonnet; v2 was identity-checked and reaped.
- #986 v3 hit 70% mid-Task-4 after completing the Profile merge and surgical `general` removal.
  Its uncommitted test/verification work is preserved while it writes a continuation and spawns a
  successor. Do not reap v3 until that successor reports its immutable session.
- #989 QA verdict is RED at
  `https://github.com/motioneso/Jarv1s/pull/1009#issuecomment-4955504323`: required CI fails on the
  unformatted plan doc, and live dev UI/screenshots evidence is absent. Code review/spec/invariants
  are otherwise clean. The spent QA pane/worktree was reaped. Owner v3 was reopened, then ordered
  to relay at its 70% trigger before fixing both blockers and requesting re-QA.
- User directive on 2026-07-13: this UX coordinator's build and QA agents are Codex-only. Do not
  use `claude` for any new build, relay successor, or QA pane even where `coordinate` says Sonnet.
  Active Claude-owned UX lanes checkpoint and stop; resume each with Codex full-access/no-approval
  invocation. The primary Coordinator's separately owned module lane is outside this fleet policy.
- Codex migration is active for UX-owned Claude sessions #984 `9d7e2453-ea7f-4b9c-ac1d-af73e9347197`,
  #985 `159e8723-d2f3-40f8-8d01-c621d537081d`, #986 v4
  `4f7ea499-7243-4415-abef-a159483d0cfe`, #989 `da980b16-d458-4213-ab02-7a34ba852971`, and #990
  `4e2afa97-5c55-417c-9bec-a07534cb3c98`. Each was ordered to checkpoint, write a durable handoff,
  stop, and avoid spawning Claude. Spawn Codex successors only after each state report is received.
- #989 stopped clean at `54601bee`; its just-spawned Claude relay was killed before file access.
  Codex session `019f5a67-99f4-7880-b8f4-e4fe04c8af67` was verified driving QA blocker fixes from
  `docs/superpowers/handoffs/2026-07-13-sports-settings-989-relay-4.md`; Claude v3 was reaped.
- #986 stopped clean at `ef716b5d` before Task 5 feature/test edits. Codex session
  `019f5a67-9a38-77e0-814a-bc082b0ce187` was verified driving from
  `docs/superpowers/handoffs/2026-07-13-986-settings-shell-halt-for-codex.md`; Claude v4 was reaped.
- #986 Task 5 found a handoff/spec contradiction. Ruling: the approved spec and plan govern; remove
  only the negative auth-provider-configuration note from merged People & access, preserving all
  real controls, guards, endpoints, and authorization behavior. The handoff's keep instruction is
  stale and does not override locked decisions.
- #986 Task 5 landed at `4bf0b50b`: registration moved into People & access, the Identity
  destination/export and negative note were removed, focused tests were 10/10, and typecheck plus
  focused Prettier passed. Codex is continuing Task 6; only the context-meter log is dirty.
- #990 voluntarily relayed at the 70% trigger after grounding. It confirmed no #981 rebase conflict,
  the PATCH client wrapper is genuinely absent, and no code or plan exists yet. Re-adopt its Sonnet
  successor and wait for that session's plan.
- #990 successor `UX 990 News Settings v2` session
  `5663beab-07c4-4691-9dc8-2b1b94869ea2` was verified driving the same worktree on Sonnet; its
  predecessor was identity-checked and reaped. Await the v2 plan before feature edits.
- Next independent work: draft #991, #992, #993, #994, #995, and #1002 specs in collision-safe
  lanes; keep #988 last and #1003 separate.
- Primary Coordinator owns #1007 QA/merge. Its builder may drive Instance-modules in Playwright but
  will not edit settings shell/chrome/nav; re-sync if its paths expand.

## Continuation note — 2026-07-13 compaction relay

- The coordinator goal was restored for Codex session
  `019f5a2e-03fd-71c3-95ab-1934cb1de973`: drive this UX fleet with Codex-only build/QA agents,
  keep this manifest current, hand verified PRs to the primary Coordinator, and never merge here.
- A context compaction triggered the coordinate skill's mandatory immediate self-relay. Spawn the
  successor as `UX Coordinator successor` in the coordinator tab with
  `codex -s danger-full-access -a never`, verify its immutable Codex session, then have it resolve
  and reap this old coordinator by label plus session id.
- Immediate #989 blocker: live stack is web `:5175`, API `:3002`, dev Postgres. Fresh signup is
  pending approval. Existing evidence points to the supported admin approval flow
  `POST /api/admin/users/:id/approve`, followed by a fresh member sign-in; no standing dev
  credential or sanctioned direct-DB activation recipe is yet confirmed. The successor must finish
  the bounded docs/scripts search, prefer real admin UI/API approval, and reply to label
  `UX 989 Sports Settings Codex`. Do not invent credentials or mutate auth tables directly.
- #990 Claude session `4e2afa97-5c55-417c-9bec-a07534cb3c98` stopped at the safe checkpoint described
  in the queue. Spawn a Codex successor in the same worktree/branch from
  `docs/superpowers/handoffs/2026-07-13-news-settings-990-relay4.md`, preserving the intentional
  uncommitted RED test and unrelated context-meter/untracked handoff state. Only after the Codex
  successor reports driving: resolve the old Claude pane fresh by label plus exact session id,
  verify the match, reap it, and add it to Reaped sessions.
- Apply that same replacement discipline to #984 and #985: do not reap their stopped Claude panes
  until their Codex successors are verified driving, then resolve by label plus immutable session
  id and reap immediately. No new UX builder or QA may use Claude.
- Current fleet identity snapshot: primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge authority; #986 Codex session
  `019f5a67-9a38-77e0-814a-bc082b0ce187` is building; #989 Codex session
  `019f5a67-99f4-7880-b8f4-e4fe04c8af67` is working the QA blockers. The primary Coordinator's
  separately owned module lane is outside the UX Codex-only replacement scope.

## Continuation note — 2026-07-13 Codex successor adopted

- `UX Coordinator` Codex session `019f5a70-28e9-7600-a132-64ab2eca669c` is driving this delegated
  lane. Primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge
  authority; this lane will not merge. The prior coordinator session
  `019f5a2e-03fd-71c3-95ab-1934cb1de973` was verified by label plus immutable session before its
  pane self-closed and disappeared from the fresh fleet list.
- The bounded dev-auth search found no standing Jarv1s application-user credential and no
  sanctioned direct-DB activation recipe. The supported flow is an existing bootstrap-owner
  session at `http://localhost:5175` → Settings → People & access → Admin Users → Pending
  Approvals → Approve, backed by authenticated `POST /api/admin/users/:id/approve`.
- #989 directly activated `sports-uat-1009-004221@example.test` before corrected guidance arrived.
  The account and all evidence from it are quarantined. No further table mutation is allowed.
  Primary coordination is routing the required owner-authenticated UI deletion to Ben; #989 may
  finish non-UAT checks but stays live-UAT blocked until owner cleanup and a fresh supported approval.
- #990 Codex session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` was verified driving the same worktree
  from relay4 before stopped Claude session `4e2afa97-5c55-417c-9bec-a07534cb3c98` was
  identity-checked and reaped.
- #984 Codex session `019f5a73-fb2a-7e13-9832-54c0503d5bd9` and #985 Codex session
  `019f5a73-f9f4-71e0-bf84-d0b5effe12ae` were each verified driving their original worktrees from
  durable handoffs before their stopped Claude predecessors were identity-checked and reaped.
  All UX-owned build and future QA replacements remain Codex-only.
- #984 Task 3 committed at `598fde88`: forced bounded replay is one-shot only after explicit resume;
  ordinary launches remain unforced. Focused tests are 5/5 and typecheck is green. The same
  immutable Codex session was re-verified and released to approved Task 4 with locks unchanged.
