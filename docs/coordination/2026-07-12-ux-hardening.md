# Coordination Run — 2026-07-12 UX hardening

**Date:** 2026-07-12
**Merge-authority lock (#983):** label `UX Coordinator`, Codex session
`019f5ee8-8a0a-7da2-a186-8170ea85e76a`.
**Peer coordinator boundary:** label `Coordinator`, Claude session
`58a78927-385c-4b1d-8fa0-94db20255d6f`, owns its separate #1000/UAT and other recorded lanes.
**Merge policy:** the locked `UX Coordinator` owns specs, builders, QA, and merges for #983.
The peer `Coordinator` owns its separate lanes. For the 2026-07-12 overnight run, Ben explicitly
delegated all approval decisions—including security-tier sign-off—to Fable.
**Shared-tree policy:** isolated worktrees; explicit-path staging only; never `git add -A`.
**Agent runtime policy:** this UX coordinator may spawn only Codex agents, using
`codex -s danger-full-access -a never`. Planning/spec agents use `gpt-5.6-sol` at high reasoning;
implementation agents use Luna (`gpt-5.6-luna`) at medium reasoning. QA remains independent and
risk-tiered. This user directive overrides the `coordinate` skill's Claude/Sonnet spawn examples.
**Grounded on:** `origin/main` `3ca138eb` after #1004 and #1005 merged; post-merge deployment
smokes green, foundation/app CI still running at first-wave worktree creation.
**merges_since_relay:** 1

This is a delegated, collision-partitioned lane under the single merge-authority lock. GitHub #983
and its native sub-issues are the product source of truth; this file tracks only operational state.

## Queue

| Issue | Spec / gate | Provisional tier | Status |
| --- | --- | --- | --- |
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | PR #1015 head `57c484ac`; Slices 1–3 preserved and timer workaround reverted. Ben approved #1020 rev2; serialized expanded #868/#1020 dependency lane is planning under session `019f5ce4-cce4-7a13-be05-cfc3834cc529`. #984 remains held until dependency landing, then fresh no-wait 3x UAT/security QA/Ben sign-off |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | MERGED via PR #1012 as squash `031eb67e`; #985 closed and lane reaped. Non-blocking hardening remains tracked separately in #1018 |
| #986 | `2026-07-12-settings-shell-navigation-ia-hardening.md` | sensitive | MERGED via PR #1010 to main at `7d852092`; #986 closed. Fresh QA pane/worktree and build pane reaped; build worktree retained because protected `.claude/context-meter.log` is dirty |
| #987 | `2026-07-12-notes-people-source-picker-hardening.md` | sensitive | draft plan PR #1044 approved at `33de3a37`; CI pending, Luna blocked until docs land |
| #989 | `2026-07-12-sports-settings-dogfood-hardening.md` | routine | MERGED via PR #1009 as squash `b0d57265`; #989 closed and build/UAT lane reaped |
| #990 | `2026-07-12-news-settings-dogfood-hardening.md` | routine | MERGED via PR #1021 as squash `b205f1c7`; #990 closed and build/QA agents reaped. Post-merge main CI run `29275470092` completed 4/4 GREEN including image publish |
| #991 | `2026-07-13-991-assistant-priorities-dogfood-hardening.md` | sensitive | spec/plan PR #1046 merged at `52b9e29c`; Luna building on `ux/991-assistant-priorities-build`, session `019f5ed2-b01a-7610-95d6-da3024b4b82f` |
| #992 | dedicated memory-presentation delta spec required | sensitive | draft spec/plan PR #1043 approved; CI pending, Luna blocked until docs land |
| #993 | dedicated host/account/operator delta spec required | security | draft security spec/plan PR #1045 with #995; compose-recreation blocker returned to Sol; Luna blocked |
| #994 | `2026-07-13-994-skills-list-first-invocation.md` | routine | PR #1049 at `caa2263d`; code-complete, unproven until isolated CI and live desktop+narrow UI artifact are green; Luna session `019f5ed2-b0ed-7cf0-ba53-f956f4185b81` |
| #995 | dedicated connected-accounts delta spec required | security | draft security spec/plan PR #1045; per-capability failure-truth blocker returned to Sol; build remains behind #987 |
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
- QA #1012 YOLO Approvals, Codex session `019f5a9b-685d-7fa0-9a32-11e83ecd0ef3`.
- Planner #991/#994, Codex session `019f5e9b-bf81-73e2-aac4-70d9c637e344`.
- Aborted misconfigured #991 builder, Codex session `019f5ecc-9993-7850-9e88-d1aad518a22d`.
- Aborted misconfigured #994 builder, Codex session `019f5ecc-9997-7a72-b8b1-7fdd76f23e54`.
- Stopped #991 Terra builder, Codex session `019f5ece-4dcd-7431-9b1e-989f858acf40`.
- Stopped #994 Terra builder, Codex session `019f5ece-4edd-7b21-803f-f9ec561e33f1`.

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
- #984 Task 4 committed at `6a1a751c`: History row selection and resume are now one action, and the
  separate Play/review/read-only path was deleted. Chat-drawer E2E is 11/11 and typecheck is green.
  CSS drift was bounded to deleting the existing `.chatd-review`; other plan-named selector blocks
  were already absent. The same session was re-verified and released to Task 5 with locks unchanged.
- #990 Task 4 Playwright is 3/3 green, but foundation exits 1 on the approved plan document's
  pre-existing formatting. No CI waiver applies without main-SHA proof. The builder is approved to
  format only `docs/superpowers/plans/2026-07-12-news-settings-dogfood-hardening.md`, stage that
  explicit path, and rerun the required gate to green; broad formatting remains forbidden.
- Ben authorized NO-BEN autonomous operation until 8:30am. Do not escalate to Ben during that
  window. Fable remains delegated approval/sign-off authority; primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge authority, and this UX lane never merges.
- Ben initially authorized clean-slate teardown only if an isolated UX compose project serving
  `:5175`/`:3002` existed. The builder was required to prove that identity before destruction;
  subsequent proof below showed the premise was false, so this authorization was never exercised.
  Direct auth/app-table mutation remains forbidden.
- #984 Task 5 committed at `c579e8d2`: History is now exclusive over live/thread/private chrome,
  with nonempty and empty History covered. Chat-drawer E2E is 12/12 and typecheck is green. The
  obsolete pending-review test was removed with its intentionally deleted surface while row resume
  remains covered. The same session was re-verified and released to Task 6 gate/closeout.
- #989 proved the assumed isolated compose stack does not exist. `:5175` and its API belong to #985;
  dev Compose hardcodes shared container/ports, and the quarantined email exists once in the shared
  default `jarv1s` database. No teardown was performed. The repo-supported safe fallback is a fresh
  `jarv1s_ux989_uat` database in the shared cluster plus host API `:3002` and web `:5189`; this yields
  honest clean-DB UAT but leaves the quarantined shared-DB row for later owner-authenticated deletion.
  Fable/primary approved this as the sanctioned path under NO-BEN. The builder is released to fresh
  migration, real-UI owner signup, and Sports UAT/screenshots. No `down -v`, shared-database drop or
  migration, or direct row edit is allowed. The inert quarantined row remains deferred for
  owner-authenticated deletion after 8:30am.
- #986 is DONE on PR #1010. Builder-reported verification is foundation/audit exit 0 and Chromium
  5/5. Independent routine QA is active as Codex session
  `019f5a91-13fa-7950-b4f2-96ea2ebf9c00` in a detached PR worktree; it must post a durable PR
  verdict and explicitly enforce the live-path UAT/screenshots gate. This UX lane will not merge.
- #990's first post-format foundation rerun reached 151/152 integration suites before `ai-tools`
  failed during a DB reset while sibling worktrees reset shared integration state. No waiver or code
  change applies. The builder was directed to create a fresh dedicated `jarv1s_ux990_gate*` database
  and rerun the entire foundation gate with that exact `JARVIS_PGDATABASE`.
- #984 Task 6 repaired plan formatting at `492adadb` and the manager file-size limit at `5d4998d4`
  (996 lines). Foundation reached 150/152 integration files and 1631 passing tests before
  `tuple concurrently updated` DB-reset failures in focus-time and notes-write-tools plus teardown
  cascade. No feature assertion failed, but no waiver applies. After sequential focused checks, the
  final full gate must run against a fresh dedicated `jarv1s_ux984_gate*` database.
- #984 confirmed the reset failure is cluster-global role/catalog DDL contention: #990's dedicated
  database run still overlaps bootstrap role work across the shared Postgres cluster. Per-database
  names prevent data stomps but do not make migrations/full gates concurrent-safe. DB-touching UX
  work is now serialized: #990 owns the active slot and #984 is next. #984 focus suites are 20/20
  green; silence never implies slot release. #985 subsequently reported its DB gate had already
  finished before this lock was established.
- #984 closeout found Task 4+5 violated Decision 4/Slice 2: History became exclusive, then resume
  cleared `reviewThreadId`, so the activated thread's stored messages disappeared. Approved bounded
  root fix in existing locked files: close History on row selection; retain the selected thread after
  successful resume; block send/model until resume and stored-message loading both succeed; snapshot
  stored records into existing `fallbackRecords` before the first continued send; reopen History and
  clear selection on resume error. Extend the existing E2E only; no new abstraction, files, or paths.
- #990 released its UX-local slot after a second red foundation run: unit 390 files/3176 pass;
  integration 150/152 files and 1628 pass, with only `ai-admin-pin` and
  `js08-decide-confirm-audit` failing during migration reset on catalog `tuple concurrently updated`.
  Read-only process proof found primary-owned `Module Fix 1006+1007 v5` simultaneously running full
  foundation/integration, so the actual global slot was not free. That module lane now owns the
  cross-fleet slot; #984 remains paused and #990 starts no third run. Issue #1013 tracks a repo-owned
  cross-process migration lock; no waiver or feature code change applies.
- #984's approved reconciliation committed at `57c484ac`: row selection closes History; stored
  messages persist; send/model wait for resume plus messages success; first send snapshots stored
  records into existing fallback; resume error clears selection and reopens History. Full drawer was
  13/13 before fixture dedupe and the focused replacement is 2/2; Prettier/typecheck are green.
  Process and `pg_stat_activity` proof still show the primary module lane executing integration DDL,
  so #984 remains paused on DB work until an explicit global-slot release.
- `Module Fix 1006+1007` released DB-touching work after two contention-red full gates and a clean
  isolated four-suite retest plus audit exit 0. A fresh process scan and `pg_stat_activity` showed no
  DB gate owner or active query. The exclusive global slot is now assigned to #984 for one fresh
  `jarv1s_ux984_gate_<unique>` full foundation run; #990 remains stopped and no other UX DB work starts.
- Primary coordination agreed the shared-cluster DB lock spans both fleets. Its module lane may
  continue Playwright only against isolated `jarvis-uat-1006`, but must request and await an explicit
  handoff before any shared-cluster foundation/integration/migration work. #984 currently owns the
  slot; UX coordination will notify primary immediately on release.
- PR #1012 security QA posted RED at
  `https://github.com/motioneso/Jarv1s/pull/1012#issuecomment-4956103194`: native YOLO can bypass
  secret/hard-policy guards; audit summary/persistence and real effective-state negatives are absent;
  menu trigger/focus behavior is broken; the included `activityVerb()` fix contradicts its claimed
  #1011 deferral; and live UAT/screenshots are missing. Builder reopened with bounded remediation;
  the spent QA pane/worktree was identity-checked and reaped. No merge or Fable sign-off request.
- PR #1009 is ready for re-QA at `c1093427`: four CI checks green and real-UI Sports UAT is durable
  at `https://github.com/motioneso/Jarv1s/pull/1009#issuecomment-4955887307` with desktop and 390px
  screenshots on isolated `jarv1s_ux989_uat`. Re-QA runs in detached worktree as Codex session
  `019f5aa9-de55-7981-99b7-41a576e7e4ff`; invalid quarantined-account evidence remains excluded.
- #985 is DONE on PR #1012 at `419a6f0a`. Builder-reported foundation/audit exits are 0, the
  pre-push trio is green, and manual CP1-CP5 pass. #1011 durably tracks the untouched
  `activityVerb()` allowed→Denied falsehood. Independent security-tier QA is active as Codex
  session `019f5a9b-685d-7fa0-9a32-11e83ecd0ef3`; it must post a durable PR verdict, perform the
  adversarial permission/auth review, and enforce live-UI UAT/screenshots. This UX lane will not merge.
- #1012 remediation exposed a security-sensitive schema fork: `app.jarvis_action_audit_log` has no
  durable summary/metadata field, while native YOLO intentionally creates no pending-action row.
  The minimum proposed repair is an AI-owned `input_summary JSONB` column, nullable for historical
  rows but mandatory on new native-YOLO audit inserts, populated only with key names via the existing
  `summarizeAssistantToolInput()` helper. The required DB type/repository, shared audit DTO/schema,
  route serializer, settings export projection, and real persisted-row test are in scope; raw input
  values and a generic metadata framework are not. This exact fork is pending Fable/primary approval
  under NO-BEN authority. #985 may continue independent menu/activity fixes but must not edit schema
  paths until the ruling is relayed.
- #1012 has a second security boundary in the same Fable ruling: no existing native-tool
  hard-policy/input guard can safely be reordered, and Bash/Read path heuristics are bypassable.
  The builder proposes native-YOLO auto-allow only for the explicit mutation set `Edit`, `Write`, and
  `NotebookEdit`; `Read`, `Bash`, `Grep`, `Glob`, `Task`, and unknown native tools continue through
  existing confirmation. This preserves destructive-write YOLO while retaining the secret-read and
  arbitrary-command boundary. No native gateway edit is approved until Fable accepts this allowlist
  or supplies an exact alternate guard.
- PR #1009 re-QA is RED at `c1093427` despite four green CI checks and valid live-path evidence.
  The failed-mutation Note is rendered once at pane bottom rather than adjacent to the initiating
  control, violating Decision 3; the named unit and E2E tests also do not exercise a delayed or
  failed POST/DELETE, so target-local pending/error behavior remains unproved. All other review,
  invariants, and live-path criteria are met. Reopen the existing #989 Codex owner for this bounded
  UI/test repair, then run fresh independent re-QA; no merge is authorized.
- PR #1010 routine QA is RED: CI's Playwright check still asserts the intentionally removed
  `Profile & account` heading in `tests/e2e/app-shell.spec.ts`, and the PR has no durable real live-dev
  Settings UAT/screenshots comment. Chromium tests alone do not satisfy the live-path gate. A
  non-blocking copy issue also describes all Modules rows as optional although required rows exist.
  Reopen the existing #986 Codex owner for the stale assertion plus honest live-path proof; it may
  also make the bounded copy correction. Fresh independent re-QA is required; no merge is authorized.
- #1012 independent remediation checkpoint `7b017508` is pushed. The Settings trigger now lives
  inside the dismiss boundary, all five menus use the focus-return callback for trigger-close,
  selection, outside-click, and Escape, and the truthful drawer `allowed` mapping has focused mapping
  plus ActivityPeek rendering coverage. Targeted ESLint, 18/18 Vitest, and web typecheck are green.
  Only the context-meter log is unstaged. Schema and native gateway paths remain untouched pending
  both Fable security rulings.

## Continuation note — 2026-07-13 UX coordinator successor 2 adopted

- `UX Coordinator` is now Codex session `019f5ab0-8933-7ae0-99c6-c4423a586ddc`. Primary
  `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge authority;
  this delegated UX lane will not merge.
- The live fleet was re-adopted by label plus immutable session: #984
  `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, #985
  `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, #986
  `019f5a67-9a38-77e0-814a-bc082b0ce187`, #989
  `019f5a67-99f4-7880-b8f4-e4fe04c8af67`, and #990
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`. #984 retains the exclusive shared-cluster DB slot;
  #989 and #986 remain reopened on their fresh QA RED findings.
- Primary confirms one combined durable Fable verdict is in flight for #1012's `input_summary`
  persistence and explicit native tool-name allowlist. Only `Edit`, `Write`, and `NotebookEdit`
  auto-allow; `Read`, `Bash`, `Grep`, `Glob`, `Task`, and unknown/future tools remain gated and
  fail closed. #985 gateway and schema paths remain frozen at pushed checkpoint `7b017508` until
  that verdict is durable and relayed.
- The prior `UX Coordinator` Codex session `019f5a70-28e9-7600-a132-64ab2eca669c` was resolved
  fresh by label plus immutable session and reaped only after this successor claimed the routing
  label and recorded the authority handoff.
- #986 reopened QA repair is active in the same immutable session. Its bounded edits are the stale
  `tests/e2e/app-shell.spec.ts` heading (`Account & preferences`) and Modules copy distinguishing
  required from optional rows. Next: focused tests, isolated real live-dev UAT/screenshots,
  commit/push/evidence, then fresh independent QA. All exclusions remain; this UX lane never merges.
- Fable's combined #1012 verdict approved both forks with blocking conditions at
  `https://github.com/motioneso/Jarv1s/pull/1012#issuecomment-4956180113` and
  `https://github.com/motioneso/Jarv1s/pull/1012#issuecomment-4956195357`. #985 is unfrozen into
  remediation only, never merge. `summarizeAssistantToolInput()` must cap model-controlled key-name
  length/count and remain the sole feeder; `inputSummary` must be a typed closed shared object with
  `app.inject` strip coverage, explicit export projection, new AI migration `0164` plus schema-ledger
  row, and persisted-row proof excluding raw values. No generic metadata framework.
- Native YOLO must use the exact fail-closed allowlist `Edit`/`Write`/`NotebookEdit`; `Read`, `Bash`,
  `Grep`, `Glob`, `Task`, empty, and unknown/future names remain confirmation-gated. Tests must pin
  pending actions for Bash/Task/unknown/empty. Canonicalized writes/edits to CLI configuration paths
  (`.claude/settings.json`, `CLAUDE.md`, `.mcp.json`) must also fall back to confirmation unless the
  engine is proved and documented read-only. Fable's `0163` instruction was stale: fetched
  `origin/main` `3ca138eb` already contains applied `0163_ai_cli_model_reconcile_delete.sql` from
  `daa91518` and its ledger row. No `0164` existed on any ref or live worktree, so UX coordination
  reserved `0164_action_audit_input_summary.sql` and ledger version `0164` for #985.
- #984's final full foundation run is GREEN on fresh database
  `jarv1s_ux984_gate_019f5a73`: exit 0; unit 390 files with 3173 passed/2 skipped; integration 152
  files with 1635 passed/2 skipped; focused notes precheck 16/16. The exact database was dropped;
  no sibling database was touched and no second DB run started. #984's exclusive shared-cluster slot
  is released and assigned to #985 for migration `0164`, schema-catalog/ledger integration, the
  persisted-row negative test, and required integration/foundation gates. Primary coordination was
  notified for cross-fleet serialization; silence is never release. Fresh Opus security QA follows
  repair. `.claude/context-meter.log` is a coordinator artifact and must never be staged.
- #984 is builder-DONE and QA-ready on draft PR #1015
  (`https://github.com/motioneso/Jarv1s/pull/1015`), branch `ux/984-private-history`, HEAD
  `57c484ac`, freshly fetched with no `origin/main` commits missing and 13 branch commits. Evidence:
  foundation exit 0 above; audit exit 0; format-check, lint, and typecheck exit 0; drawer E2E 13/13.
  Slice 4/cross-engine acceptance remains deferred to #868; `activityVerb()` is untouched/released
  to #985; context-meter remains unstaged. Primary coordination was handed the PR for fresh
  independent QA, including the durable real live-path UAT/screenshots gate. The owner pane remains
  available for RED fixes; this UX lane does not merge.
- Primary re-tiered PR #1015 as SECURITY because private-chat-history hardening touches live routes,
  the session manager, and shared chat-API owner-scoped access paths. Opus adversarial QA is active
  at `57c484ac`, off the shared cluster and trusting `gh pr checks`; #985 remains sole DB-slot owner.
  Review focus is owner scoping, cross-session leakage, fast-json-stringify stripping, and secrets
  escape. PR checks are currently in flight/UNSTABLE. The mock-API drawer E2E is not real-runtime
  proof, so absent durable live-path UAT plus screenshots is a merge-blocking condition. Primary
  holds merge pending GREEN QA, live-path proof, Fable sign-off, and the required security approval.
- #985 accepted the exclusive shared-cluster DB slot and its remediation surface was approved as:
  shared audit schema; `summarizeAssistantToolInput()` producer; AI route/repository/gateway; DB type
  plus `0164` migration and ledger; settings export; required chat transport/route serialization;
  and the targeted unit/integration coverage required by both durable Fable verdicts. It may run the
  migration, action-audit/chat-transport/schema-catalog tests, and required foundation gates only
  serially. Any scope expansion must stop for escalation. The slot releases only on an explicit
  COMPLETE or FAILED report; no merge and no staging `.claude/context-meter.log`.
- PR #1015 SECURITY QA is GREEN-WITH-CONDITIONS with zero code blockers at
  `https://github.com/motioneso/Jarv1s/pull/1015#issuecomment-4956316872`. Owner scoping, DB-enforced
  foreign-thread denial, closed-schema stripping, secrets/job-payload safety, and server-truth restore
  are proven. Merge remains blocked on required verify-foundation CI turning GREEN (currently
  pending/UNSTABLE, no RED) and durable Playwright UAT plus screenshots against a real dev instance;
  the existing `mock-chat-api.ts` E2E is not runtime proof. #984 is reopened for evidence only, fully
  off the shared cluster owned by #985. No code change unless UAT exposes a defect. The optional
  negative-auth test, extra real-DB RLS test, and dead-branch cleanup are skipped. After both blockers
  clear, primary routes Fable/security sign-off and remains sole merge authority.
- #985 applied migration `0164` successfully, then its first serial DB suite
  (`action-audit-log`) failed 1/8 because the new `app.inject` audit response returned 500 instead of
  200; the other seven persistence/RLS cases passed. This is failure cycle one. #985 exclusively
  retains the shared-cluster slot and no later DB gate has started. It must diagnose the root cause
  within the approved schema/serializer/route/repository surface, rerun the focused suite first, and
  continue serial gates only if GREEN. A second failure of the same check stops the lane for explicit
  escalation; no self-waiver, slot release, merge, or context-meter staging.
- #985 hit failure cycle two on the same focused `action-audit-log` `app.inject` check and is now
  STOPPED; no later DB test/gate ran and it still exclusively holds the shared-cluster slot. Root
  cause is confirmed: `inputSummary` as `anyOf[closed object, null]` is branch-validated by
  fast-json-stringify before `additionalProperties: false` stripping, so a row with an undeclared
  property matches neither branch and returns 500. Issue #1016 tracks the mandatory stop-line:
  `https://github.com/motioneso/Jarv1s/issues/1016`. The proposed bounded correction is the same
  typed closed-object schema with `additionalProperties: false` plus `nullable: true`, then a focused
  restore/rerun before later gates. That correction is not authorized pending explicit primary/Fable
  direction; no edit, waiver, rerun, gate, slot release, merge, or context-meter staging.
- Primary acknowledged #1016 as a SECURITY stop-line and routed it to Fable for a durable issue
  ruling. Fable is grounding on `ux/985-yolo-approvals` to confirm branch-validation-before-strip
  and whether `{ type: object, additionalProperties: false, nullable: true }` both strips undeclared
  properties and serializes null, or to provide an exact safe alternative. All #985 work remains
  frozen and its DB slot held until that ruling is posted to #1016 and explicitly relayed.
- Fable APPROVED #1016 at
  `https://github.com/motioneso/Jarv1s/issues/1016#issuecomment-4956410747` after empirical
  fast-json-stringify 6.4.0/Fastify proof. #985 is resumed with its DB slot retained. The exact
  preferred schema is `type: ["object", "null"]`, `additionalProperties: false`, required
  `inputKeys`/`inputKeyCount`/`truncated`, with properties array-of-string, nonnegative integer, and
  boolean respectively; verified behavior strips undeclared properties with HTTP 200 and preserves
  null. `nullable: true` is acceptable only if already coded. #985 must apply this fix and rerun
  `tests/integration/action-audit-log.test.ts` including the strip case FIRST; remaining Fork 1/2
  serial work proceeds only after focused GREEN. Merge, waiver, and slot release remain forbidden;
  full GREEN conditions return to fresh Opus security QA.
- #1016's focused correction is GREEN: `action-audit-log` 8/8 including the `app.inject` strip
  case. The next serial `chat-mcp-transport` suite failed 1/18 because its positive real effective
  YOLO state timed out at confirmation; the other 17 passed. This is failure cycle one for a distinct
  check. #985 retains the DB slot; schema-catalog/foundation have not started. It may diagnose the
  persisted-state wiring only within the approved Fork 2 route/repository/gateway/transport surface,
  then rerun the focused chat suite first. Later gates require focused GREEN; a second same-check
  failure stops the lane. No allowlist weakening, waiver, merge, slot release, or context staging.
- #985's focused gates are GREEN: action-audit 8/8, chat transport 18/18, and schema catalog 10/10.
  Its single serial full foundation process is still running: lint/format/static/typecheck are green,
  unit is 393 files with 3201 passed/2 skipped, and migrations report 155 current. Integration has
  provisionally reported an unrelated `email-reply-tools` failure in the `draftReply`
  `ask_each_time` confirmation case, but the process has not exited. #985 retains the slot and may
  only let that process finish and report the compact final verdict; no diagnosis, edit, rerun,
  waiver, later work, merge, slot release, or context staging before final exit.
- #985's full foundation run exited 1: integration 151 files passed/1 failed, with 1640 tests
  passed/2 skipped/1 failed. The sole failure is the stale expectation at
  `tests/integration/email-reply-tools.test.ts:305`: expected the new `input_summary` without
  `truncated`, while production correctly returned the same keys/count plus Fable-required
  `truncated: false`. This is foundation failure cycle one. The only authorized edit is adding
  `truncated: false` to that expected object; production remains untouched. #985 must rerun the
  focused email suite first, then one serial full foundation rerun only if GREEN. Another same-test
  or full-gate failure stops the lane. Slot remains held; no waiver, merge, release, or context staging.

## Continuation note — 2026-07-13 UX coordinator successor 2 compaction relay

- The active `UX Coordinator` remains Codex session
  `019f5ab0-8933-7ae0-99c6-c4423a586ddc` until its relay successor claims the label and records its
  own immutable session. Primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f`
  remains sole merge authority; this UX lane never merges. This session received a compaction
  summary, so the non-waivable `coordinate` relay tripwire fired: flush state, spawn a successor in
  the same coordinator tab, verify it is driving, and have it resolve/reap this session by label plus
  immutable session.
- #985's authorized `truncated: false` expectation edit did not restore the focused
  `email-reply-tools` check. Its second run failed the same test 1/4 solely because the assertion
  compares `JSON.stringify(...)`: expected key order is
  `inputKeys,inputKeyCount,truncated`, while persisted order is
  `inputKeys,truncated,inputKeyCount`; values and shapes match. No foundation rerun or later gate
  started. Mandatory cycle-two stop-line issue #1017 is durable at
  `https://github.com/motioneso/Jarv1s/issues/1017`. The possible bounded correction is structural
  object equality rather than serialized-string equality, but it is NOT authorized until Primary
  relays durable Fable direction. No production/schema change may be made to satisfy object key
  order.
- #985 Codex session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae` remains stopped and exclusively holds
  the shared-cluster DB slot. Until the #1017 ruling is explicit: no edit, further diagnosis, rerun,
  waiver, later gate, slot release, merge, or `.claude/context-meter.log` staging. Successor's first
  coordination action is to keep #985 frozen, send Primary the `[SECURITY][STOP-LINE]` pointer to
  #1017, and request durable Fable direction.
- Live-fleet identity was freshly re-verified before relay: #984
  `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, #985
  `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, #986
  `019f5a67-9a38-77e0-814a-bc082b0ce187`, #989
  `019f5a67-99f4-7880-b8f4-e4fe04c8af67`, and #990
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`. #984 remains SECURITY GREEN-with-conditions pending
  real-runtime UAT/screenshots and CI on PR #1015; #986 and #989 remain reopened on bounded QA RED
  repair; #990 is spent/done. Re-adopt every live lane by label plus immutable session rather than a
  pane number.

## Continuation note — 2026-07-13 UX coordinator successor 3 adoption

- `UX Coordinator` is now Codex session `019f5adf-594d-7623-8259-69e1657f4e6b`; it verified its
  live label/session pair and is driving. Primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge authority; this UX lane never merges.
- The successor re-adopted the fleet by verified label plus immutable session: #984
  `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, #985
  `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, #986
  `019f5a67-9a38-77e0-814a-bc082b0ce187`, #989
  `019f5a67-99f4-7880-b8f4-e4fe04c8af67`, and spent #990
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`. Their prior statuses remain unchanged.
- #985 remains frozen on durable issue #1017 and exclusively holds the shared-cluster DB slot. The
  successor sent Primary the `[SECURITY][STOP-LINE]` pointer and requested durable Fable direction.
  Until that direction arrives: no edit, diagnosis, rerun, waiver, later gate, slot release, merge,
  or `.claude/context-meter.log` staging.
- Old UX coordinator session `019f5ab0-8933-7ae0-99c6-c4423a586ddc` is pending reap only after
  this manifest lock is pushed and both old and successor identities are freshly verified by label
  plus immutable session.

## Continuation note — 2026-07-13 #1017 durable ruling

- Primary relayed the durable Fable ruling grounded on `a9260d5a`: #985's stop-line is cleared only
  for the full-literal `toStrictEqual` test-assertion repair authorized on #1017. Production/schema
  changes, `objectContaining`, serializer-driven property reordering, and changes to the adjacent
  `SECRET_BODY` leak tripwire remain forbidden. #985 retains the exclusive DB slot through its full
  gate, then flags Primary for fresh Opus QA and merge; this UX coordinator never merges.
- The ruling was routed to verified #985 session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, which is
  working. Old UX coordinator session `019f5ab0-8933-7ae0-99c6-c4423a586ddc` was freshly resolved
  by label plus immutable session and reaped; successor `019f5adf-594d-7623-8259-69e1657f4e6b`
  remains the live `UX Coordinator`.

## Continuation note — 2026-07-13 #984 live SECURITY UAT blocker

- #984's isolated real stack passes public storage, private omission through real UI/API, History
  close/resume, and stored-message visibility. Its first real UI send after resume hangs after
  `POST /api/chat/turn` begins: the exact prompt never enters the idle resumed Codex TUI. The lane
  reproduced this after 3-second and 15-second waits. This is a live product blocker, not a mock or
  shared-DB artifact.
- Verified #984 session `019f5a73-fb2a-7e13-9832-54c0503d5bd9` is diagnosis-only while it grounds
  the request-lifecycle root cause and path-lock scope; no feature edit, workaround, merge, shared-DB
  use, or scope expansion is authorized. Primary has the `[SECURITY][UAT-BLOCKER]` pointer. Opus
  reviewer session `9eb17b9a-4002-4ba2-beef-9f7554daa842` is independently reviewing the smallest
  root fix and verification, read-only.

## Continuation note — 2026-07-13 #984 plan and #989 fresh QA

- #984 grounded a no-expansion plan: forced replay drains during lazy relaunch inside the POST, then
  real input is submitted before the resumed TUI becomes input-ready. Proposed scope is the shared
  session manager only, with a replay-only bounded settle and focused regression/UAT proof. The lane
  remains edit-frozen pending Opus reviewer `9eb17b9a-4002-4ba2-beef-9f7554daa842`'s verdict.
- #989 reported its bounded QA RED repair at PR #1009 head `a7ba230b`. CI run `29237888859` is
  independently confirmed fully green. Fresh routine-tier QA session
  `151e9902-c729-458d-86c1-62e98495b594` is reviewing the repair, invariants, exit criteria, and
  whether the durable live UAT remains sufficient. It must post its verdict to the PR; Primary alone
  may merge.

## Continuation note — 2026-07-13 #984 Opus ruling

- Opus reviewer `9eb17b9a-4002-4ba2-beef-9f7554daa842` confirmed #984's post-replay input-readiness
  timing race and approved a bounded interim fix inside #984 scope. No #868 runner change is
  authorized. The natural durable engine-readiness seam remains deferred to #868/Slice 4.
- #984 may implement only with both required corrections: keep `chat-session-manager.ts` at or below
  the 1,000-line gate, and thread an environment-configurable 600 ms production settle through
  runtime dependencies while tests use zero. Verification must include focused unit/E2E/typecheck/
  file-size checks plus fresh isolated resume-first-send live UAT 3–5 times under light load. Primary
  has the ruling; this UX coordinator never merges.

## Continuation note — 2026-07-13 #989 QA GREEN

- Fresh routine QA on PR #1009 exact head `a7ba230b` is GREEN and merge-ready: all required CI
  checks pass, zero blocking findings, invariants and #989 exit criteria are met, and the reviewer
  found the existing happy-path live proof sufficient for the bounded client-only pending/error
  repair. Durable verdict: `https://github.com/motioneso/Jarv1s/pull/1009#issuecomment-4956803684`.
- Primary has the verdict and remains sole merge authority. #989 is holding; this UX coordinator did
  not merge. Fresh QA session `151e9902-c729-458d-86c1-62e98495b594` and its clean worktree were
  reaped.

## Continuation note — 2026-07-13 #985 explicit-path closeout

- Primary reports PR #1012 QA-ready: `verify:foundation` is GREEN, #1017's full-literal
  `toStrictEqual` repair is applied, and no sibling stringify assertion exists. Verified #985
  session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae` is committing only its touched files by explicit
  path and pushing the branch; broad staging and `.claude/context-meter.log` remain forbidden.
- #985 retains the exclusive DB slot and must report the exact pushed head SHA. Primary alone then
  spawns fresh Opus security QA for both Fable forks, the #1017 repair, and secrets-never-escape;
  Primary alone may merge after delegated Fable security sign-off. This UX coordinator never merges.

## Continuation note — 2026-07-13 #989 merged and reaped

- Primary merged PR #1009 as squash `b0d57265` and closed #989. Verified build session
  `019f5a67-99f4-7880-b8f4-e4fe04c8af67` and its clean `ux-989-sports-settings-build` worktree were
  reaped.
- The isolated `jarv1s_ux989_uat` project had no remaining containers, volumes, networks, or Compose
  entry at cleanup. `jarv1s-prod` was not touched.

## Continuation note — 2026-07-13 PR #1012 pushed

- #985 pushed PR #1012 head `f22a3cc104f2168774a8ecf84e9e52fce3263d9c`; both the remote branch
  and PR head were independently verified. The explicit-path commit contains the approved files and
  #1017 full-literal `toStrictEqual` repair; context-meter remains unstaged.
- Primary has the immutable head for fresh Opus security QA across both Fable forks, #1017, and
  secrets-never-escape. #985 still holds the exclusive DB slot. This UX coordinator does not QA,
  merge, release the slot, or touch the board for PR #1012.

## Continuation note — 2026-07-13 #984 required live UAT RED

- #984's approved 600 ms replay settle failed the required fresh isolated live UAT on repetition 1.
  With `JARVIS_CHAT_REPLAY_SETTLE_MS=600` and no harness wait, storage/private/history/resume passed,
  but the exact first post-resume prompt was still dropped before the idle Codex TUI became
  input-ready and the POST remained pending. Green unit/E2E/typecheck/file-size/format checks do not
  establish live readiness.
- Verified #984 session `019f5a73-fb2a-7e13-9832-54c0503d5bd9` is frozen: no edit, interval bump,
  rerun, cleanup, shared-DB use, merge, or scope expansion. Run-6 isolated evidence is preserved.
  Primary has the stop-line. Fresh Opus reviewer `28a373a6-56a2-44f1-a213-4954ed266edc` is deciding
  whether a deterministic readiness fix requires the #868 runner/engine seam.

## Continuation note — 2026-07-13 #984 Opus UAT ruling

- Opus rejected the blind replay settle. Deterministic input-readiness truth belongs at the
  `cli-runner`/RPC boundary owned by #868; #984 owns only the future consumer seam. No timer increase,
  replacement timer, or #868 path expansion is authorized in this lane.
- #984 may only revert its settle changes in the session manager and runtime plus the two
  settle-specific tests, while preserving Slices 1–3 and run-6 evidence. PR #1015 is live-path
  blocked/code-complete-unproven on #868 and must not merge or close. Primary has the ruling; Opus
  reviewer `28a373a6-56a2-44f1-a213-4954ed266edc` was reaped.
- Durable #868 invariant: runner/RPC must emit observed input readiness; the manager awaits that
  consumer seam before submitting the first post-resume turn, which must be delivered exactly once.
  Elapsed time is never readiness. Future live proof is a fresh isolated, no-harness-wait run with
  three post-resume repetitions, each returning 200/ACK with the exact prompt retained once.

## Continuation note — 2026-07-13 #984 settle reverted

- #984 fully reverted the rejected settle. The manager/runtime/resume/runtime-selection paths match
  HEAD, transient settle tests are removed, and scoped search finds no settle symbol or environment
  variable. Focused non-DB checks are GREEN: 47 manager/resume/runtime tests, 13 drawer Chromium
  tests, typecheck, file-size (manager 996 lines), and diff check.
- Independent status verification found only `.claude/context-meter.log` modified and preserved
  `docs/uat/` untracked; neither is staged. Run-6 isolated stack/evidence remains preserved without
  rerun or cleanup. PR #1015 remains live-path RED and blocked—not done—on #868 deterministic
  runner/RPC input readiness; it must not merge or close.

## Continuation note — 2026-07-13 PR #1012 merged and #985 reaped

- Primary merged PR #1012 as squash `031eb67e` after Opus security QA GREEN, delegated Fable
  approval, and all four CI checks GREEN. The exclusive shared-Postgres DB slot is released.
  Verified #985 session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae` and its clean worktree were reaped.
- Issue #985 remains open. PR #1012 delivered truthful YOLO outcomes, the approved safe native-edit
  allowlist, approval-card UX, and all five menu conversions, but #985 still says YOLO must request
  no per-action approval including destructive/external actions. The merged security design
  intentionally keeps Bash, Task, unknown tools, and config writes gated. A durable issue comment
  requests either acceptance revision or a separately approved mechanism.
- #1011 was closed as delivered by PR #1012. Non-blocking security hardening #1018 remains open.

## Continuation note — 2026-07-13 delivered-issue closure audit

- #985 is now closed as completed. Its merged Fable-approved fail-closed security boundary
  supersedes the original blanket no-prompt wording; no authorized #985 slice remains. #989 was
  already closed. The audit found no other delivered-but-open child under #983.
- #984 stays open: PR #1015 is live-path RED and blocked on #868 deterministic runner/RPC readiness.
  #986 stays open: PR #1010 is still on stale red CI head `6a88c8c5`, while repair `6fdfc11c` remains
  local/unpushed and live UAT is still required. #990 stays open: its branch is incomplete/dirty,
  ahead of main with no PR. The remaining #983 children are unstarted or specification-stage.
- #1011, #1016, and #1017 are closed; non-blocking #1018 remains open. Parent #983 remains open.

## Continuation note — 2026-07-13 #986 resumed for push and live proof

- Primary confirms no pending merge and will security-gate #986 once PR #1010 has an exact pushed
  head plus durable live UAT. Verified #986 session `019f5a67-9a38-77e0-814a-bc082b0ce187` is driving
  again from local repair `6fdfc11c`; remote PR head remains stale `6a88c8c5` until it rebases/pushes.
- The lane must preserve `.claude/context-meter.log`, stop on non-trivial rebase conflict, and post
  real Settings UI UAT/screenshots for the exact pushed head before reporting. Its interrupted prior
  turn already left run-9 screenshots, which must be validated against the eventual pushed head
  rather than treated as proof automatically. No merge or issue closure is authorized.

## Continuation note — 2026-07-13 finish-all directive

- Ben directed all remaining UX lanes fixed and merged, with notification after image builds. Primary
  remains sole merge authority. Main CI is GREEN at `031eb67e`. Verified #986 session
  `019f5a67-9a38-77e0-814a-bc082b0ce187` and #990 session
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` are driving toward exact pushed heads, real live-path UAT,
  CI, and independent QA.
- #868's approved RFA is the distinct engine-less transcript-purge scope required by #984 acceptance.
  The runner/RPC input-readiness requirement is only a durable seed and explicitly needs its own
  approved security spec. Primary has Ben's finish-all direction as the scope call and was asked to
  create/approve that child. Both dependencies serialize ahead of #984's final no-wait 3x UAT.
- #986 must recover/validate run-9 evidence after its interrupted turn; #990 must finish its existing
  approved plan, open a PR, and record exact-head News Settings live evidence. No UX-lane merge is
  authorized.

## Continuation note — 2026-07-13 #868 launched and #990 inventory

- #868's approved engine-less transcript-purge security lane is building from green main in
  `security/868-engine-purge`, Sonnet session `c806a7e2-5991-4ddb-88a9-f68d4c278ef2`. Its handoff
  locks out #984 paths and the separate runner/RPC readiness seam. It must plan first, add real
  on-disk engine-shape proof, and stop for Opus security QA plus Primary/Fable merge authority.
- #990 confirmed Task 3 committed at `268c5a32`; Task 4 E2E and plan formatting remain uncommitted.
  Context-meter and relay handoff stay unstaged. It is finishing only approved #990 acceptance,
  then explicit-path commits, rebase/push/PR, exact-head isolated UAT/screenshots, and CI. Non-trivial
  rebase conflict is a stop-line. This UX coordinator never merges.
- #986's old Codex session `019f5a67-9a38-77e0-814a-bc082b0ce187` repeatedly lost its websocket
  before closeout and was reaped after successor verification. Sonnet successor
  `5a2f1b65-74fe-4a49-8081-22380b388ce0` is driving the same worktree toward pushed PR head,
  exact-head UAT/screenshots, and CI; no state was discarded.

## Continuation note — 2026-07-13 #1020 scope split and #990 gate hold

- Primary created security child #1020 for deterministic runner/RPC input readiness; Fable is
  drafting `docs/superpowers/specs/2026-07-13-cli-runner-input-ready-event.md`. #1020 and #868-original
  are serialized security lanes and both must merge before #984/PR #1015 may resume. #868 session
  `c806a7e2-5991-4ddb-88a9-f68d4c278ef2` is held before feature edits pending spec approval and
  explicit serialized release.
- #990 is focused GREEN and cleanly rebased on main at head `44d1cd49` (Task 3 `10d8a948`, Task 4
  `44d1cd49`). It needs full foundation plus release-hardening before push, but no DB gate has
  started. The lane is held while Primary confirms the global shared-cluster slot and isolated name
  `jarvis_ux990_gate`; no concurrent DB gate is authorized.

## Continuation note — 2026-07-13 #990 DB gate released

- Primary granted #990 exclusive shared-cluster gate database `jarvis_ux990_gate` on
  `jarv1s-postgres` at `127.0.0.1:55433`; global load is low and no other gate is running. Verified
  #990 session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` is running foundation then release-hardening
  serially with true exit-code capture.
- A Postgres crash/recovery-mode/connection-reset signature is classified as shared-instance
  contention: hold, preserve logs, and escalate to Primary before retry; never patch #990 for that
  infrastructure signature. On genuine GREEN, #990 proceeds to explicit-path push/PR, exact-head
  isolated UAT/screenshots, CI, and independent QA. No merge is authorized here.
- #990's first foundation attempt exited 1 before migrations with PostgreSQL `3D000` because the
  newly assigned database did not exist; unit work was GREEN (3,215 pass/2 skip) and no contention
  signature appeared. This is slot initialization. The lane may create only `jarvis_ux990_gate` and
  take one serial foundation retry; release-hardening remains forbidden until `VF_EXIT=0`.

## Continuation note — 2026-07-13 #868 agy-print design fork

- #868 remains held pre-edit/pre-gate. Its uncommitted plan cleanly covers Gemini, codex-exec, and
  per-session Codex purge, but agy-print currently has only a home-wide transcript root and proposed
  approximate mtime matching. Neither over-deletion nor under-deletion is acceptable for private
  transcript cleanup.
- Read-only Opus reviewer `5a554221-4230-4fd7-a21e-430c57185b8d` is adjudicating whether a
  deterministic session-safe agy matcher exists or Task 4 must defer to a dedicated follow-up. No
  plan commit, feature edit, test, gate, or serialized release is authorized before the verdict and
  #1020 spec approval.

## Continuation note — 2026-07-13 #990 gate GREEN

- #990 released `jarvis_ux990_gate` after a genuine serial GREEN gate. Foundation retry exit 0:
  393 unit files/3,215 pass/2 skip and 152 integration files/1,642 pass/2 skip. Release-hardening
  exit 0 with no failures. The initial `3D000` initialization log is preserved; no shared-instance
  contention signature occurred.
- Verified #990 session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` is proceeding to explicit-path
  push/PR, exact-pushed-head isolated News Settings UAT/screenshots, CI, and independent QA. The DB
  slot is free; this UX coordinator never merges.

## Continuation note — 2026-07-13 #986 live-proven and #868 agy blocked

- PR #1010 is pushed at exact head `6eef41706e1890332cbe4045853c5f4cddb51646` with durable fresh
  real-instance Settings UAT/screenshots in PR comment `4959951464`. Focused E2E is GREEN (12/12 +
  5/5); compose and prod-compose CI checks are GREEN while foundation remains in progress. Primary
  has the promised security-gate pointer; fresh independent QA waits for all CI green.
- Opus blocked #868 agy-print Task 4: mtime matching over its host-wide transcript root can delete
  unrelated in-flight transcripts and still miss the private one. Tasks 1–3 are deterministic but
  cannot close #868 alone. Safe agy cleanup requires crash-surviving per-session identity at launch
  plus graceful/crash purge, touching agy engine/launch wiring outside current scope. Primary was
  asked for a dedicated security child/spec under Ben's finish-all direction. #868 remains held;
  Opus reviewer `5a554221-4230-4fd7-a21e-430c57185b8d` was reaped.

## Continuation note — 2026-07-13 #986 dual QA and #1022 scope gate

- Primary classified PR #1010 as SENSITIVE because it changes the shared settings shell and
  cross-module navigation-truth surface. After CI green, UX must run fresh sensitive QA and Primary
  must separately run integrated re-QA; both merge-ready verdicts are required. Primary is already
  watching exact head `6eef4170` and awaits UX's durable verdict pointer.
- Primary filed security child #1022 for agy crash-surviving per-session identity plus graceful/crash
  purge. #984 is now blocked on approved/merged #1020, #868-original, and #1022. #868 remains held
  pre-edit, and neither #1020 nor #1022 may spawn until Ben directly approves scope/spec. A relayed
  finish-all instruction is not treated as that explicit security-scope approval.

## Continuation note — 2026-07-13 #986 CI GREEN and fresh QA

- PR #1010 exact head `6eef41706e1890332cbe4045853c5f4cddb51646` has all four CI checks
  GREEN, including image build, plus exact-head real isolated UAT/screenshots. Primary's independent
  sensitive QA is GREEN at PR comment `4960081630` and awaits UX's separate fresh verdict before
  integrated re-QA and merge.
- Fresh sensitive QA is running in a detached exact-head worktree as Sonnet session
  `48262aa6-8c1e-42cf-bb47-a2679f85b471`. It trusts CI, reviews shared-shell/cross-module truth,
  performs the explicit invariant walk, validates live-path evidence, posts a durable PR verdict,
  and never edits or merges.

## Continuation note — 2026-07-13 UX fleet re-adopted

- `UX Coordinator` Codex session `019f5adf-594d-7623-8259-69e1657f4e6b` re-verified its live
  label/session pair and is driving. Primary `Coordinator` Claude session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` remains the sole merge authority and acknowledged this
  lane's status pointer; UX never merges.
- Re-adopted fresh #986 QA session `48262aa6-8c1e-42cf-bb47-a2679f85b471`, #990 build session
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`, #984 held build session
  `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, and #868 held security session
  `c806a7e2-5991-4ddb-88a9-f68d4c278ef2` by label plus immutable session.
- PR #1021 is open at exact #990 head `44d1cd490b19136034d6c660e39371b819d16cb5` with foundation
  and both compose smokes GREEN; its image-build job is still running. #984/#868/#1020/#1022 remain
  frozen pending Ben's direct security-scope/spec approval.

## Continuation note — 2026-07-13 #986 fresh QA GREEN

- Fresh independent SENSITIVE QA for PR #1010 is GREEN and merge-ready at PR comment `4960123832`
  on exact head `6eef41706e1890332cbe4045853c5f4cddb51646`; CI is 4/4 GREEN and the
  shared-shell/cross-module invariants plus #986 exit criteria are met. The only non-blocker is a bad
  evidence comment ID; exact-head real isolated UAT/screenshots remain verified at `4959752508`.
- The verdict pointer is routed to verified Primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` for its required authority check, integrated re-QA, and
  merge. Fresh QA session `48262aa6-8c1e-42cf-bb47-a2679f85b471` is done and ready to reap after
  Primary consumes the verdict; this UX lane does not merge.

## Continuation note — 2026-07-13 #986 merged; #990 rebase gate

- Primary merged PR #1010 and closed #986; main is now `7d852092`. Fresh QA session
  `48262aa6-8c1e-42cf-bb47-a2679f85b471` and build session
  `5a2f1b65-74fe-4a49-8081-22380b388ce0` were re-verified by label plus immutable session and their
  panes were reaped. The clean QA worktree was removed. The build worktree remains because protected
  `.claude/context-meter.log` is dirty; it was not discarded or staged.
- #990 must rebase onto `7d852092` before its final CI and exact-head UAT. The instruction is queued
  to verified build session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`; any non-trivial settings
  collision is a stop-line. The pre-rebase `44d1cd49` checks/evidence are no longer final.

## Continuation note — 2026-07-13 #990 rebased and pushed

- #990 rebased cleanly onto `7d852092` without a settings collision and was force-pushed with an
  exact lease from old PR head `44d1cd490b19136034d6c660e39371b819d16cb5` to new exact head
  `36a0639433a2cbb592716d2df21931fb7f63160b`. The old-head image build did finish GREEN but is
  superseded and is not final evidence.
- Verified build session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` is running final new-head CI and
  exact-head isolated UAT. Protected `.claude/context-meter.log` and untracked relay handoff remain
  unstaged; this UX lane never merges.

## Continuation note — 2026-07-13 #990 UAT GREEN and fresh QA

- Rebased exact-head #990 UAT is GREEN and durable at PR comment `4960344279`. Evidence-only commit
  `7896efb27b63749bef2fd504ed142d2767412904` has exact PR head
  `36a0639433a2cbb592716d2df21931fb7f63160b` as its parent, preserving the CI-tested product head
  while publishing the full log and eight desktop/narrow screenshots.
- Final exact-head CI run `29266428822` has foundation GREEN in 18m41s plus both compose smokes
  GREEN; image build is running. Fresh routine QA is active in a detached exact-head worktree under
  label `QA 1021 News Settings R1`, Codex session
  `019f5c5f-446a-78e0-85dc-ce9a01ddfeae`. It reviews now but may not post GREEN until CI is 4/4;
  it never edits or merges.

## Continuation note — 2026-07-13 #990 fresh QA RED

- Fresh routine QA posted PROVISIONAL RED at PR comment `4960441848` on exact head `36a06394`; gate
  was truthfully 3/4 GREEN with image build pending. Four blockers: 390px saved guidance truncates;
  mutation success can announce before the personalization row refreshes; query loading/error is
  coerced into false empty UI; revalidation feedback lacks `status`/`alert` live semantics.
- The full actionable verdict is routed to verified #990 builder session
  `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` for TDD repair with explicit-path staging, focused proof,
  regenerated exact-head narrow UAT/evidence, and new full CI. Any image result on `36a06394` is
  superseded by the repair head. QA session `019f5c5f-446a-78e0-85dc-ce9a01ddfeae` made no edits;
  this UX lane never merges.

## Continuation note — 2026-07-13 spent-agent reap sweep

- Re-verified and closed spent QA sessions `019f5a91-13fa-7950-b4f2-96ea2ebf9c00` (#986 first
  pass), `019f5aa9-de55-7981-99b7-41a576e7e4ff` (#989 R2), and
  `019f5c5f-446a-78e0-85dc-ce9a01ddfeae` (#990 R1). Their clean detached QA worktrees were removed.
- Re-verified and closed frozen #868 planning session `c806a7e2-5991-4ddb-88a9-f68d4c278ef2`.
  Worktree `security-868-engine-purge` and its untracked plan remain intact pending direct security
  scope/spec approval. #984 stays open because its preserved Run-6 UAT stack/evidence may depend on
  the live pane. Primary/UX coordinators and active #990/#1019 builders were not reaped.

## Continuation note — 2026-07-13 #990 QA repair pushed

- Verified #990 builder session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` locked all four QA blockers
  with RED tests, then pushed exact repair head `472c2f2dc7715e3e6bec79bb918fc08d84230fe2` from exactly
  five owned paths. Focused unit is 23/23 GREEN, Chromium is 4/4 GREEN, and format/lint/typecheck plus
  design-token checks are GREEN.
- Protected `.claude/context-meter.log` and the untracked relay handoff remain unstaged. The lane is
  regenerating exact-head desktop/narrow UAT and durable evidence while new full CI runs; a fresh
  routine QA must review the repaired head before Primary may merge. UX never merges.

## Continuation note — 2026-07-13 #990 closeout relay

- Exact-head Firefox run_3 is GREEN at repair head `472c2f2dc7715e3e6bec79bb918fc08d84230fe2`,
  including authored personalization loading/error states, full saved guidance at 390px, normal
  wrapping, and no horizontal overflow. CI run `29270763113` has both compose smokes GREEN with
  foundation running.
- Prior #990 session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa` hit its context floor and was reaped
  only after the product tree was clean at the pushed repair head. Fresh same-worktree Codex
  successor label `UX 990 News Settings Relay 5`, immutable session
  `019f5c98-d76b-7a50-83c9-c1454a828b52`, owns evidence-only packaging/PR comment and CI closeout.
  Protected context/relay artifacts remain unstaged; no product edit or merge is authorized.

## Continuation note — 2026-07-13 #990 repaired evidence and QA R2

- Repaired exact-head UAT is durable at PR comment `4960969019`. Evidence-only commit
  `b494817a` has product head `472c2f2dc7715e3e6bec79bb918fc08d84230fe2` as its sole parent;
  PR #1021 product head remains unchanged. CI run `29270763113` has foundation and both compose
  smokes GREEN with image build running.
- Fresh routine repair QA is active in a detached exact-head worktree under label
  `QA 1021 News Settings R2`, immutable Codex session
  `019f5c9d-8e34-70a0-9bc0-a0d6a39032be`. It rechecks all four prior blockers and full #990 exit
  criteria but may not post GREEN until CI reaches 4/4. It never edits or merges.

## Continuation note — 2026-07-13 #990 QA R2 RED

- CI reached 4/4 GREEN at repair head `472c2f2d`, including image build in 10m03s, but fresh QA R2
  posted RED at PR comment `4961037190`: clearing a stored guidance value omits `guidance` from the
  PATCH so stale text persists despite success, and create/edit mutation errors are not reset across
  mode transitions so alerts leak into the wrong operation. The prior four blockers and exact-head
  UAT/evidence chain are verified repaired.
- Both blockers are routed with exact TDD requirements to verified Relay 5 session
  `019f5c98-d76b-7a50-83c9-c1454a828b52` for a bounded product fix, new exact-head UAT/evidence,
  full CI, and another fresh QA. QA R2 session `019f5c9d-8e34-70a0-9bc0-a0d6a39032be` was reaped
  after its clean detached worktree was removed. UX never merges.

## Continuation note — 2026-07-13 #990 QA R2 repair pushed

- Relay 5 session `019f5c98-d76b-7a50-83c9-c1454a828b52` reproduced both blockers with RED tests,
  then pushed exact repair head `44c624744b26cd0ec8b4ec478324408836faf5e0`. The update sends an
  explicit empty guidance value and resets create/edit errors at operation transitions. Focused unit
  is 24/24 GREEN, Chromium is 4/4 GREEN, and format/type/design-token checks are GREEN.
- Protected context/relay artifacts remain unstaged. The builder is extending exact-head UAT with
  clear-guidance persistence and create-error→edit / edit-error→cancel isolation proof while new CI
  runs. Evidence-only packaging and fresh QA R3 follow; UX never merges.

## Continuation note — 2026-07-13 #990 QA R2 evidence and QA R3

- Exact-head run_4 UAT is GREEN and durable at PR comment `4961193875`. Evidence-only commit
  `1fb956b358007fcb01707515322f61e80e3a7981` has product head
  `44c624744b26cd0ec8b4ec478324408836faf5e0` as its sole parent and includes 12 captures proving
  clear-guidance persistence plus operation-local error recovery. PR product head remains unchanged.
- CI run `29273395628` has both compose smokes GREEN with foundation/image still running. Fresh
  routine QA R3 is active in a detached exact-head worktree under immutable Codex session
  `019f5cb5-2a50-7a51-857b-02ec808c660e`; it rechecks all six prior blockers and full exit criteria
  but may not post GREEN until CI is 4/4. It never edits or merges.

## Continuation note — 2026-07-13 #990 QA R3 GREEN

- Exact-head CI run `29273395628` is 4/4 GREEN, including image build. Fresh routine QA R3 is GREEN
  and merge-ready at PR comment `4961370860`: zero findings, all six prior blockers repaired,
  invariants intact, #990 exit criteria met, and UAT/evidence sole-parent chain verified.
- The durable verdict is routed to verified Primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` for its authority and integrated-main check plus merge.
  QA R3 session `019f5cb5-2a50-7a51-857b-02ec808c660e` was reaped after its clean detached worktree
  was removed. Relay 5 holds the product branch without further edits; UX never merges.

## Continuation note — 2026-07-13 #990 merged and closed

- Primary merged PR #1021 as squash `b205f1c711c606bc4fa9f26eb43e675368802dad` after its
  authoritative session and integrated-main check; CI was 4/4 GREEN including image and fresh QA R3
  was GREEN. Issue #990 is closed.
- Relay 5 session `019f5c98-d76b-7a50-83c9-c1454a828b52` was re-verified and reaped. Its worktree
  remains because protected `.claude/context-meter.log` and the relay2 handoff are dirty/unstaged;
  no user-owned state was discarded. Post-merge main CI run `29275470092` is active at the merge
  SHA and must finish its image build GREEN before #990 is reported fully deployed.

## Continuation note — 2026-07-13 security hold clarified

- #1020 spec gate is cleared by Sol rev2 `39dafc29` plus Fable APPROVE at issue comment `4961300011`,
  but Ben has not explicitly approved the spec. #1022 was folded into #868 and closed standalone as
  not planned; expanded #868 now carries the AGY purge acceptance but is not itself an approved
  standalone spec.
- Primary explicitly ordered no spawn: #984/PR #1015 and expanded #868 remain frozen until Primary
  provides a direct Ben-approved-spec pointer plus serialized order. Finish-all is not inferred as
  security-spec approval. Four clean local #990 evidence worktrees were removed; their remote
  evidence branches remain for durable PR links.

## Continuation note — 2026-07-13 #1020 approved; security dependency launched

- Ben directly approved #1020 spec rev2 `39dafc29` at durable issue comment `4961635704`; Primary
  authorized the serialized security build+QA train and retained sole merge authority. #984/PR #1015
  still requires explicit Ben security sign-off after dependencies land and fresh 3x live UAT.
- Existing `security-868-engine-purge` worktree was re-adopted by fresh Codex label
  `Security 868+1020 Purge Readiness Codex`, immutable session
  `019f5ce4-cce4-7a13-be05-cfc3834cc529`. It combines the approved deterministic runner/RPC input-
  ready event with expanded #868 AGY crash-surviving per-session identity and graceful/crash purge.
  It must rebase, update/send its compact plan, and make no feature edit until current main image is
  GREEN plus UX plan approval. No timers, approximate mtime matching, broad deletion, or merge.

## Continuation note — 2026-07-13 #990 post-merge image GREEN

- Main CI run `29275470092` completed 4/4 GREEN at #990 squash
  `b205f1c711c606bc4fa9f26eb43e675368802dad`; image publish completed at 19:12:23Z. #990 is fully
  merged, closed, and post-merge verified.
- The GREEN main gate is routed to security build session
  `019f5ce4-cce4-7a13-be05-cfc3834cc529`. It remains plan-only until its compact combined
  #868/#1020 plan is approved; main CI no longer blocks that approval.

## Continuation note — 2026-07-13 security plan approved; current-main hold

- Security session `019f5ce4-cce4-7a13-be05-cfc3834cc529` rebased cleanly on current main
  `cdf66df0` and produced `docs/superpowers/plans/2026-07-13-engine-less-transcript-purge-plan.md`.
  UX approved its exact serialized design: #1020 ECHO/ACK plus idempotent cancel, manager await seam
  only after runner green, then expanded #868 exact Gemini/Codex/AGY identities and deterministic
  graceful/crash purge. Calibration failure hard-stops; timers and heuristic deletion stay banned.
- Current main CI run `29277401769` at `cdf66df0` is still active. The agent may commit only the
  approved plan and must hold all TDD/product edits until UX sends the exact-main GREEN release.

## Continuation note — 2026-07-13 UX coordinator relay 4

- Spent `UX Coordinator` Codex session `019f5adf-594d-7623-8259-69e1657f4e6b` is relaying now;
  Primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge executor.
  Successor must record its immutable session at the manifest top, re-adopt by label+session, confirm
  driving to Primary, then resolve/reap the spent UX session by label plus this immutable id.
- Mid-doing: current main is `cdf66df0` after unrelated #1023. CI run `29277401769` has both compose
  smokes GREEN and foundation running. On exact 4/4 GREEN, immediately release security session
  `019f5ce4-cce4-7a13-be05-cfc3834cc529` from plan-only hold into TDD implementation. Its approved
  plan-only commit is `8f7f2ec40cfe5c938d62f09e24c1e06460340424`; tree is clean.
- Security scope/sequence: approved #1020 rev2 (`39dafc29`, Ben approval comment `4961635704`) exact
  ECHO/ACK + idempotent cancel; manager await seam only after runner green; then expanded #868 exact
  Gemini/Codex/AGY identities and deterministic graceful/crash purge. No timers, heuristic matching,
  broad/shared-root deletion, payload leakage, or merge by UX. #984/PR #1015 stays held at
  `57c484ac` until dependency landing, then no-wait 3x real UAT plus security QA. Ben delegated #984
  sign-off to Fable security-review GREEN (fallback Sol xhigh GREEN); all gates still apply.
- #990/PR #1021 is merged/closed at `b205f1c7` and post-merge main run `29275470092` is 4/4 GREEN
  including image. Its agents are reaped; dirty protected build worktree was preserved. Primary owns
  the entire approved #1000 harness train (#1024–#1027); UX belayed it before any agent or edit and
  removed the temporary worktree/branch. Do not spawn or coordinate #1000 from this lane.

## Continuation note — 2026-07-13 UX coordinator successor 5 adopted

- Fresh Sonnet successor adopted the `UX Coordinator` lane: label `UX Coordinator`, Claude session
  `1211ffa9-b725-469b-922d-ab4dc0c56436` (was labeled `UX Coordinator Successor 4` pane `w1:pK0`,
  now renamed). Verified Primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` live
  at pane `w1:pE6` — sole merge executor, unchanged. Spent Codex `UX Coordinator` session
  `019f5adf-594d-7623-8259-69e1657f4e6b` (pane `w1:pKA`) verified and closed after this note lands.
- Mid-doing (carried forward unchanged): main was `cdf66df0`, CI run `29277401769` had both compose
  smokes GREEN and foundation running — watching for exact 4/4 GREEN. On green, release security
  session `019f5ce4-cce4-7a13-be05-cfc3834cc529` (worktree `security-868-engine-purge`) from
  plan-only hold (`8f7f2ec40cfe5c938d62f09e24c1e06460340424`, tree clean) into TDD implementation
  per approved #1020 rev2 (`39dafc29`, Ben approval `4961635704`) scope: exact ECHO/ACK + idempotent
  cancel, manager await seam only after runner green, then expanded #868 exact Gemini/Codex/AGY
  identities + deterministic graceful/crash purge. No timers, heuristic matching, broad/shared-root
  deletion, payload leakage, or merge by UX.
- #984/PR #1015 stays held at `57c484ac` until the #1020/#868 dependency lands, then no-wait 3x real
  UAT plus security QA. Ben delegated #984 sign-off to Fable security-review GREEN (fallback Sol
  xhigh GREEN); all other gates still apply.
- Do not spawn or coordinate #1000 — Primary owns the entire approved harness train (#1024–#1027).

## Continuation note — 2026-07-13 security session released from plan-only hold

- Main CI run `29277401769` completed exact 4/4 GREEN (incl. image) at sha
  `cdf66df0782162966a088fbaf25c5756d9640703`. UX Coordinator (Claude session
  `1211ffa9-b725-469b-922d-ab4dc0c56436`) sent explicit TDD release to Security
  `019f5ce4-cce4-7a13-be05-cfc3834cc529` (pane `w1:pKY`, worktree
  `security-868-engine-purge`), which was correctly holding pending this exact signal.
  Approved plan-only commit `8f7f2ec40cfe5c938d62f09e24c1e06460340424` stands; tree was
  clean at hold.
- Released scope unchanged: exact ECHO/ACK + idempotent cancel first; manager await seam
  only after runner tests green; then expanded #868 exact Gemini/Codex/AGY identities +
  deterministic graceful/crash purge. Hard constraints restated: no timers, no heuristic
  matching, no broad/shared-root deletion, no payload leakage, no merge by the security
  agent — it opens a PR and reports to `UX Coordinator` for QA; Primary Coordinator
  (session `58a78927-385c-4b1d-8fa0-94db20255d6f`) remains sole merge executor.
- #984/PR #1015 still held at `57c484ac` pending this #1020/#868 dependency landing, then
  no-wait 3x real UAT plus security QA; sign-off delegated to Fable security-review GREEN
  (fallback Sol xhigh GREEN).

## Continuation note — 2026-07-13 UX coordinator relay 5 (context 70%)

- Successor 5 (Claude session `1211ffa9-b725-469b-922d-ab4dc0c56436`, label `UX Coordinator`)
  hit the 70% context-meter warning and is relaying now per the non-negotiable trigger. Primary
  `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains sole merge executor
  (pane `w1:pE6`) and has already ACK'd registering this lane's driver. Successor 6 must record
  its immutable session at the manifest top, re-adopt by label+session, confirm driving to
  Primary, then resolve/reap this spent session by label plus this immutable id.
- Main CI run `29277401769` was exact 4/4 GREEN at sha `cdf66df0782162966a088fbaf25c5756d9640703`
  (confirmed and recorded in the prior note). Security session `019f5ce4-cce4-7a13-be05-cfc3834cc529`
  (label `Security 868+1020 Purge Readiness Codex`, pane `w1:pKY`, worktree
  `security-868-engine-purge`) was released from plan-only hold into TDD per approved #1020 rev2
  scope (`39dafc29`, Ben approval `4961635704`): exact ECHO/ACK + idempotent cancel first, manager
  await seam only after runner tests green, then expanded #868 exact Gemini/Codex/AGY identities +
  deterministic graceful/crash purge. No timers, no heuristic matching, no broad/shared-root
  deletion, no payload leakage, no merge by the security agent (opens PR, reports to UX Coordinator
  for QA; Primary merges).
- **Mid-doing — Gemini calibration blocker resolved, NOT a scope change:** the security session hit
  a HARD STOP calibrating the "Gemini" identity for #868 (issue text: `packages/chat/src/live/
  private-transcript-cleanup.ts` engine-less purge, real product feature — end users pick a "Gemini"
  engine in Jarvis's own private-chat mode, separate from `agy-print`). It tried launching the raw
  `gemini` CLI directly and hit the known OAuth-browser wedge (same root cause as
  `[[cross-model-lens-must-be-agy]]`, confirmed via `memory_save` this session). Root cause: that's
  the WRONG binary — read `packages/chat/src/live/cli-chat-engine.ts:538-542` (`buildGeminiCommand`):
  Jarvis's own interactive Gemini engine already launches `agy --sandbox [--model ...]` (auth via
  `.gemini/settings.json`, no OAuth prompt), and agy's Gemini 3.1 Pro backend still writes to the
  real documented path (`packages/ai/src/adapters/transcript-reader.ts:49-65`,
  `~/.gemini/tmp/<project>/chats/<session>.jsonl`, `type:"gemini"|"user"` records; also
  `packages/ai/src/cli-availability.ts:21` `google -> "agy"`). Relayed this exact fix to the
  security session (accepted, back to working) — it should now run `agy --sandbox` to get a real
  fixture and calibrate against it. **Not yet confirmed PASS** — successor 6 must check pane
  `w1:pKY` for the calibration result and either let it proceed into TDD build or re-escalate if the
  transcript doesn't land at the documented path. #1020's 3-identity scope (Gemini/Codex/AGY) is
  UNCHANGED — Ben was asked about descoping/dropping Gemini and did NOT choose that; he pointed
  at the real launch mechanism instead ("gemini is launched with agy").
- #984/PR #1015 stays held at `57c484ac` pending the #1020/#868 dependency landing, then no-wait 3x
  real UAT plus security QA. Ben delegated #984 sign-off to Fable security-review GREEN (fallback
  Sol xhigh GREEN); all other gates still apply.
- Do not spawn or coordinate #1000 — Primary owns the entire approved harness train (#1024–#1027).

## Continuation note — 2026-07-13 UX coordinator successor 6 adopted; Gemini calibration hit a REAL further blocker

- Successor 6 (Claude session `4a5526f6-384a-4645-8162-abb1b171845e`, worktree `coord-983-ux`,
  pane `w1:pM5` prior to rename) adopted the delegated UX lane. Primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f` (pane `w1:pE6`) reconfirmed idle/sole merge executor.
- **The prior note's fix guidance was itself wrong — do not re-apply it.** The security session
  (`019f5ce4-cce4-7a13-be05-cfc3834cc529`, label `Security 868+1020 Purge Readiness Codex`, pane
  `w1:pKY`) ran the corrected `agy --sandbox` command and got a REAL production fixture, but it does
  **not** land at `~/.gemini/tmp/<project>/chats/<session>.jsonl` (`type:"gemini"|"user"` records)
  as `transcript-reader.ts:49-65` documents. Verified fact: `agy --sandbox` writes AGY-native
  `USER_INPUT`/`PLANNER_RESPONSE` records to
  `~/.gemini/antigravity-cli/brain/<UUID>/.system_generated/logs/transcript_full.jsonl`, where
  `<UUID>` is only known after AGY prints "Created conversation `<uuid>`" post-Enter — the EXACT
  same root/schema `agyPrintTranscriptRoot()` + `mapAgyPrintRecord` already use for the separate
  `AgyPrintChatEngine` (`packages/chat/src/live/agy-print-chat-engine.ts`, batch `agy --print`).
  `transcriptGlobDir("google", ...)` (`~/.gemini/tmp/...`) appears to be dead code for production —
  no engine actually writes there. Security session made **no product edits**, halted cleanly, and
  proved crash-survival evidence (engine killed, neutral-dir log still maps UUID→exact transcript)
  while waiting.
- This is a genuine [DESIGN-FORK] with data-loss/security consequences (a private-data purge
  feature) — escalated to a one-shot Opus adjudication agent (spawned by successor 6, prompt cites
  exact files/lines) rather than decided same-lens. Question: should #868's "Gemini" purge target
  become exact-UUID-capture-at-launch under `~/.gemini/antigravity-cli/brain/`, converging with (or
  reusing) the agy-print engine's own purge mechanism, since they share root+schema; is
  `transcriptGlobDir("google", ...)` now dead/removable; and does this need Ben's product sign-off
  given it changes #868's stated 3-identity framing even though the underlying mechanism converges.
  **Awaiting Opus verdict — do not let the security agent resume TDD on the Gemini identity until
  it lands; agy-print and Codex/Claude purge paths are unaffected and may proceed.** Primary ACK'd
  the lane handoff and flagged: #984/PR #1015 stays HELD until this settles — #984's privacy
  guarantee hinges on purging the correct path, so #868 must not land on the stale documented-path
  assumption. Surface the Opus verdict to Primary the moment it returns.
- Prior successor (session `1211ffa9-b725-469b-922d-ab4dc0c56436`, pane `w1:pK0`) confirmed reaped
  and closed. Successor 6's pane renamed `w1:pM5` → label `UX Coordinator`. Exactly one
  `UX Coordinator` pane live (verified via `herdr pane list`).
- **Opus adjudication VERDICT (in): CONDITIONAL GO.** (1) Exact-UUID scoping
  (`rm -rf brain/<UUID>/` where `<UUID>` is captured from the session's OWN pane/log) is safely
  scoped — never enumerate/glob the shared `brain/` root; capture-miss → log+leave, never fall back
  to a root glob or time-window scan. (2) Build ONE shared primitive
  `purgeAgyBrainDir(capturedUuid)` reused by BOTH the interactive-Gemini engine and
  `AgyPrintChatEngine` — they're byte-identical root+schema, not 3 distinct identities. Additional
  finding: agy-print currently resolves its OWN transcript via a time-window newest-file scan
  (`find -newermt`), not exact-UUID — that also needs tightening under the same no-heuristic
  invariant. (3) `transcriptGlobDir("google", ...)` is dead code in prod — do not build purge on
  it. (4) TDD may start NOW on the shared primitive. But it collapses #868's stated "3 distinct
  identities" framing into "2 agy engines + Codex" plus a capture-fail=silent-retention risk that
  is product-visible — **that scope-reframe + retention contract needs Ben's sign-off before
  MERGE, not before TDD.** Relayed full verdict + go-ahead to security pane `w1:pKY` (proceed on
  shared primitive; do NOT touch the separately-discovered broken interactive-Gemini transcript
  READER — `cli-chat-engine.ts:187`, `CliChatEngineImpl` via `transcriptGlobDir`+`mapGeminiRecord`
  reads the wrong path/schema today — that's a pre-existing production bug, out of #868 scope,
  flag only, file as follow-up).
- **Open for Primary/Ben:** #984/PR #1015 stays held per Primary's standing instruction until this
  settles at merge time (mechanism is now Opus-cleared; only the scope-reframe wording + the
  capture-fail retention contract needs Ben's explicit OK, tracked here, gates security-tier merge
  not TDD). Also open: file a GitHub issue for the broken interactive-Gemini transcript reader
  (separate bug, not yet filed — successor 6 flagging for Primary/Ben, not fixing).
- Primary ACK'd the verdict (2026-07-13) and is surfacing the scope-reframe + retention contract to
  Ben directly as the before-MERGE gate; will relay his ruling back to this lane. **Two explicit
  asks from Primary, both still OPEN — successor 7 must pick these up:**
  1. **File the pre-existing interactive-Gemini transcript-reader bug** as its own GitHub issue
     (`gh issue create`, label `bug`; NOT part of #868/#1020 scope) — root cause:
     `packages/chat/src/live/cli-chat-engine.ts:187` (`CliChatEngineImpl`) sets
     `transcriptDir = transcriptGlobDir("google", ...)` = `~/.gemini/tmp/.../chats`, parsed by
     `mapGeminiRecord` (old raw-`gemini` schema) — but production's interactive Gemini engine
     launches `agy --sandbox`, which writes to `~/.gemini/antigravity-cli/brain/<UUID>/....` The
     interactive Gemini engine's live activity-stream reader is silently reading the wrong
     path/schema today. Reference: repo uses labels `bug`/`sev:*`; see `gh issue view 868` for
     format. **Send the issue number to Primary (label `Coordinator`, re-resolve pane by session
     `58a78927-385c-4b1d-8fa0-94db20255d6f` fresh) once filed.**
  2. **Report the #868/#1020 TDD PR to Primary the moment the security lane opens it** (pane
     currently `w1:pKY`, session `019f5ce4-cce4-7a13-be05-cfc3834cc529`, re-resolve fresh — do not
     trust the `…-N` pane number). Primary said explicitly: "I QA (security tier) + merge only
     after Fable GREEN AND Ben's scope ruling" — so successor 7 hands the PR to Primary, does
     **not** spawn its own QA agent for this one, and does not merge.
- Successor 6 (session `4a5526f6-384a-4645-8162-abb1b171845e`) hit the 70%-context relay trigger
  right after Primary's ACK, before either ask above was actioned — relaying now per the
  non-negotiable rule (flush + relay, no "just one more thing"). Successor 7 must resolve both
  panes fresh by label+session (never the `…-N` numbers written above) before acting.

## Continuation note — 2026-07-13 UX coordinator successor 7 adopted; both open asks actioned

- Fresh Sonnet successor adopted the `UX Coordinator` lane: label `UX Coordinator`, Claude session
  `b637e03f-267e-493b-acb2-0808bd1a9f49` (was labeled `UX Coordinator Successor 7`, pane `w1:pM6`).
  Re-resolved the fleet fresh via `herdr pane list` (never trusted written pane numbers): Primary
  Coordinator confirmed at label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f`,
  pane `w1:pE6`, sole merge executor, unchanged. Security lane confirmed at label
  `Security 868+1020 Purge Readiness Codex`, session `019f5ce4-cce4-7a13-be05-cfc3834cc529`, pane
  `w1:pKY`, `agent_status: working` — still building the #868/#1020 shared exact-UUID purge
  primitive.
- **Ask 1 done:** filed the pre-existing interactive-Gemini transcript-reader bug as
  **issue #1029** (`bug`, `sev:major` — significant but non-blocking, not security/data-loss).
  Root cause documented in the issue: `CliChatEngineImpl` (`cli-chat-engine.ts:187`) reads
  `~/.gemini/tmp/...` via `transcriptGlobDir`+`mapGeminiRecord` (dead-code path), but production's
  interactive Gemini engine actually launches `agy --sandbox`, writing to
  `~/.gemini/antigravity-cli/brain/<UUID>/.system_generated/logs/transcript_full.jsonl` — the same
  root+schema `AgyPrintChatEngine`/`mapAgyPrintRecord` already parse for batch `agy --print`.
  Number relayed to Primary via `herdr pane run w1:pE6`.
- **Ask 2 in progress:** no PR yet on branch `security-868-engine-purge`
  (`gh pr list --search "head:security-868-engine-purge"` empty as of this note). Armed a
  persistent `Monitor` polling `gh pr list` every 60s for that branch; will hand the PR number
  straight to Primary the moment it opens and will **not** spawn a QA agent for it — Primary owns
  QA (security-tier, Opus-adversarial) + merge for this PR directly per its own standing
  instruction.
- Delegated lane owner line at the top of this manifest updated to this session
  (`b637e03f-267e-493b-acb2-0808bd1a9f49`, see header). Next: rename this pane's label to
  `UX Coordinator` and reap the outgoing successor-6 pane (label `UX Coordinator`, session
  `4a5526f6-384a-4645-8162-abb1b171845e`, was pane `w1:pM5`) — re-resolved fresh by label+session,
  not by the written pane number above.

## Continuation note — 2026-07-13 UX coordinator handoff to Codex gpt-5.6-sol (Ben's request)

- Ben explicitly asked for the `UX Coordinator` lane to be handed to a **Codex `gpt-5.6-sol`**
  agent (not another Claude successor). Spawning `codex -s danger-full-access -a never -m
  gpt-5.6-sol` in the SAME tab as the outgoing Claude pane (never the agents tab), per the
  `coordinate` skill's self-handoff section and this manifest's standing Codex-only runtime policy
  (see header).
- **State at handoff (nothing changed since successor-7's prior note, both asks fully actioned):**
  - Fleet re-adopted fresh: Primary Coordinator = label `Coordinator`, Claude session
    `58a78927-385c-4b1d-8fa0-94db20255d6f`, sole merge authority, unchanged. Security lane = label
    `Security 868+1020 Purge Readiness Codex`, Codex session
    `019f5ce4-cce4-7a13-be05-cfc3834cc529`, worktree `security-868-engine-purge`, still building
    the #868/#1020 shared exact-UUID purge primitive, `agent_status: working`.
  - **Ask 1 (file the Gemini transcript-reader bug): DONE.** Filed as issue #1029 (`bug`,
    `sev:major`), number already relayed to Primary.
  - **Ask 2 (report the #868/#1020 PR to Primary the moment it lands): DONE.** PR #1031 opened at
    head `9c8288b8`; successor 8 reported it directly to Primary with the builder's green
    `verify:foundation` and `audit:release-hardening` evidence. UX stopped its watch and did not
    spawn QA or merge; Primary owns security-tier QA + merge.
  - Manifest lock/delegated-lane-owner block at the top of this file must be updated to the new
    Codex successor's session id once it adopts (it should do this itself per the `coordinate`
    skill's self-handoff step 1).
- Next: verify the Codex successor is driving (confirm model = `gpt-5.6-sol`, bounded pane read),
  then it reaps the outgoing Claude `UX Coordinator` pane (session
  `b637e03f-267e-493b-acb2-0808bd1a9f49`) — re-resolved fresh by label+session, not by any pane
  number written here.

## Continuation note — 2026-07-13 UX acceleration wave

- `UX Coordinator` Codex session `019f5dc2-8bd9-78b2-827f-67bd9a99e6c9` remains coordinator for
  #983. The separate primary `Coordinator` retains its own run and merge authority.
- Collision boundary synchronized with Primary: UX owns settings, memory, skills, chat, and
  account/connector UI. Primary exclusively owns `tests/uat/**` and the #1000 UAT harness; UX must
  route any UAT-harness need through Primary before editing. Primary has no active settings,
  memory, or skills locks. Chat follow-ups #1037–#1039 are not active and require a fresh sync
  before either coordinator lanes them.
- Runtime split from Ben: Sol (`gpt-5.6-sol`) at high reasoning writes plans/specs; Luna
  (`gpt-5.6-luna`) at medium reasoning implements approved plans. QA remains independent and
  risk-tiered.
- Acceleration order: prepare #987 immediately; plan #991/#992/#993/#994 in parallel; keep #995
  behind #987, #1002 after affected UI settles, and #988 as the final live acceptance pass.
- Active Sol/high planning sessions: #987 `019f5e9b-c003-7350-acba-258a601e308b`, #991/#994
  `019f5e9b-bf81-73e2-aac4-70d9c637e344`, #992 `019f5e9b-bf80-73f3-86c2-7bf40e0024f9`, and
  #993/#995 `019f5e9b-bfc9-7fb0-8096-c197e41324a9`. No Luna builder is released yet.
- Issue #1042 remains a separate module-distribution lane under #860/#964, not #983. Reserve
  `apps/web/src/settings/settings-module-registry-section.tsx`; route its eventual #1000 live UAT
  coverage through the peer Coordinator.
- Plan review state: #992 PR #1043 GREEN pending CI; #987 PR #1044 GREEN at `33de3a37` pending CI;
  #993/#995 PR #1045 RED pending exact compose recreation and bounded per-capability failure truth.
- PR #1046 merged docs-only at `52b9e29c`. Luna/medium builders released with disjoint locks:
  #991 session `019f5ed2-b01a-7610-95d6-da3024b4b82f`; #994 session
  `019f5ed2-b0ed-7cf0-ba53-f956f4185b81`. Earlier wrong-model sessions were stopped; their partial
  focused work was preserved for Luna to review and continue. Both feature PRs require independent
  QA and live UI evidence; neither lane may edit `tests/uat/**`.
- #994 PR #1049 opened at `caa2263d`. Focused gates are green, but the duplicate local full gate
  was stopped after shared integration contention. GitHub CI is the isolated mechanical gate;
  independent QA waits for CI plus a PR-linked live desktop+narrow Skills/invocation artifact.

## Continuation note — 2026-07-13 UX coordinator compaction relay

- `UX Coordinator` authority is still Codex session
  `019f5dc2-8bd9-78b2-827f-67bd9a99e6c9`; a fresh `herdr pane list` confirmed the separate
  primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f`. Resolve both by
  label + `agent_session.value`; never trust a recorded pane number.
- PR #1050 (#991) is code-complete at `51dee040`, rebased and pushed. Builder evidence:
  `verify:foundation` exit 0 (396 unit files, 3306 passed, 2 skipped; 155 migrations current),
  `audit:release-hardening` exit 0, and focused priority/persona/CLI tests green. It is sensitive
  tier and remains code-complete, unproven: desktop+narrow screenshots and live selected-model
  persona Preview/CLI dogfood proof are still required on the PR before independent QA + merge.
- PR #1049 (#994) remains code-complete, unproven at `caa2263d`: focused evidence is green, while
  isolated GitHub CI and real desktop+narrow Settings→Skills list/edit/autocomplete/slash-invocation
  proof must be confirmed before routine QA + merge.
- Live build sessions from the fresh pane list: #991 Luna
  `019f5ed2-b01a-7610-95d6-da3024b4b82f` is done; #994 Luna
  `019f5ed2-b0ed-7cf0-ba53-f956f4185b81` is working. Planning sessions #987/#992/#993+#995 are
  idle; do not infer their authority or pane number from this note.
- Immediate successor action: adopt this run under a new `UX Coordinator` session id and update
  the delegated-lane-owner authority block; then message the primary `Coordinator` for one combined
  #1000 live run covering PRs #1049 and #1050, with PR-linked desktop+narrow screenshots plus the
  exact Skills and selected-model persona Preview/CLI paths above. Check GitHub CI; if CI and live
  proof are green, launch independent routine QA for #1049 and sensitive QA with invariant walk for
  #1050. Both QA verdicts must be durable PR comments. Reconfirm authority before every merge.
- PR #1046 is the only merge since the last relay (`merges_since_relay: 1`). No merge occurred in
  this compaction-triggered session. The successor may merge only after all gates above; the next
  routine/sensitive merge reaches the two-merge relay threshold and requires immediate relay.

## Continuation note — 2026-07-13 UX successor adoption

- `UX Coordinator` authority is Codex session
  `019f5ee8-8a0a-7da2-a186-8170ea85e76a`; authority commit `0a601c05` is pushed. The spent
  `UX Coordinator Relay Old` session `019f5dc2-8bd9-78b2-827f-67bd9a99e6c9` was resolved from a
  fresh pane list by label plus session id and closed.
- PR #1049 is code-frozen at `63ccf923f09efa4a015be386d06e045deabf452f`; CI run
  `29308090668` is fully green after the minimal composer textbox-role correction.
- PR #1050 is code-frozen at `0b280f51943bbfeb514eb06a0b945e8fc6556935`; CI run
  `29307615983` is fully green after rebasing onto `origin/main` `8f9da394` with no feature edits.
- The primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` has the combined #1000
  UAT trigger for both frozen heads. The spent combined-UAT session
  `019f5f2a-c957-7b61-9a26-47ec6abde474` was reaped after #1049 passed and it committed durable
  handoff `2d324f09`. Successor label `UAT 1049+1050 Relay Sol`, Codex session
  `019f5f46-b0cf-7b73-997e-ea00262651ce`, is working on `gpt-5.6-sol` in the same worktree/tab.
  Await #1050 execution and PR-linked desktop+narrow evidence plus its separate CLI transcript/log,
  then launch independent routine QA for #1049 and sensitive invariant-walk QA for #1050. Both
  verdicts must be durable PR comments. No QA or merge has occurred yet.
- `merges_since_relay` remains `1`; the next routine/sensitive merge requires immediate relay.
