# Coordination Run — 2026-07-12 UX hardening

**Date:** 2026-07-12
**Merge-authority lock (#983):** label `UX Coordinator`, Codex session
`019f6cf0-dc6f-7351-9978-d2b1e6605a96`.
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
**merges_since_relay:** 0

This is a delegated, collision-partitioned lane under the single merge-authority lock. GitHub #983
and its native sub-issues are the product source of truth; this file tracks only operational state.

## Queue

| Issue | Spec / gate | Provisional tier | Status |
| --- | --- | --- | --- |
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | PR #1015 head `57c484ac`; Slices 1–3 preserved and timer workaround reverted. Ben approved #1020 rev2; serialized expanded #868/#1020 dependency lane is planning under session `019f5ce4-cce4-7a13-be05-cfc3834cc529`. #984 remains held until dependency landing, then fresh no-wait 3x UAT/security QA/Ben sign-off |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | MERGED via PR #1012 as squash `031eb67e`; #985 closed and lane reaped. Non-blocking hardening remains tracked separately in #1018 |
| #986 | `2026-07-12-settings-shell-navigation-ia-hardening.md` | sensitive | MERGED via PR #1010 to main at `7d852092`; #986 closed. Fresh QA pane/worktree and build pane reaped; build worktree retained because protected `.claude/context-meter.log` is dirty |
| #987 | `2026-07-12-notes-people-source-picker-hardening.md` | sensitive | PR #1058 cycle-2 candidate `9604babd`; zero behind, fresh CI/UAT running, sensitive re-QA waits for CI |
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
  `019f5f46-b0cf-7b73-997e-ea00262651ce`, completed on `gpt-5.6-sol` and was reaped.
  #1049 UAT passed with durable PR comment
  `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966075818`. #1050 is `BLOCKED / NOT
  EXERCISED` after the evidence-driver cap, with durable PR comment
  `https://github.com/motioneso/Jarv1s/pull/1050#issuecomment-4966075807`; no sensitive QA may start.
  Independent #1049 routine QA session `019f5f54-d396-7812-9dfb-5e14646a6200` returned RED and was
  reaped; durable verdict `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966124185`.
  Builder `UX 994 Build Luna`, session `019f5ed2-b0ed-7cf0-ba53-f956f4185b81`, fixed the
  composer-state and visible-required-marker blockers at `f2760d1f`; the coordinator removed the
  leaked `docs/coordination/handoff-994-skills-build.md`. PR #1049 head is now
  `110bba3b3654f0522a15a19458cc1493ba4ba4b1`; CI run `29312925736` is fully green. The primary
  coordinator's fresh stable, unobscured desktop+narrow UAT passed with durable comment
  `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966637818`. Independent routine
  re-QA session `019f5f9d-4b93-7183-b5af-e8d4f3475ad0` returned GREEN and was reaped; durable
  verdict `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966683562`. The branch rebased
  cleanly onto `origin/main` `313c194c` with no feature edits; integrated head
  `1a3bf80c57dbed2f8425b640e64277ea52eb9038` has fully green CI run `29316363348`. Final integrated
  QA label `QA 1049 Integrated Sol`, Codex session `019f5fbe-ddba-7d82-8003-bf939e9cc32e`, is
  working on `gpt-5.6-sol`. No merge has occurred yet.
- `merges_since_relay` remains `1`; the next routine/sensitive merge requires immediate relay.

## Continuation note — 2026-07-13 UX coordinator relay after PR #1049 merge

- Current `UX Coordinator` authority is Codex session
  `019f5ee8-8a0a-7da2-a186-8170ea85e76a`. The two-routine/sensitive-merge relay trigger fired
  after #1046 and #1049, and this session must be reaped only after the successor confirms it is
  driving. Resolve it from a fresh pane list by label plus session id; never trust a written pane
  number. Never reap the separate primary `Coordinator` session
  `58a78927-385c-4b1d-8fa0-94db20255d6f`.
- PR #1049 / issue #994 merged routine as squash
  `4129391d1499fcd95ed7de5431b7b8594643691e` from integrated head
  `1a3bf80c57dbed2f8425b640e64277ea52eb9038`. Integrated CI run `29316363348` was green; fresh
  unobscured desktop+narrow UAT is
  `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966637818`; final integrated QA is
  `https://github.com/motioneso/Jarv1s/pull/1049#issuecomment-4966969620`. Issue #994 is closed and
  both project items moved to Done automatically. Builder and QA panes were reaped. The builder
  worktree is still held because `webwright-proof-994/` is untracked; the primary coordinator was
  told the combined-UAT worktree is safe to reap.
- PR #1050 / issue #991 remains frozen at
  `0b280f51943bbfeb514eb06a0b945e8fc6556935` with green CI. Live UAT remains `BLOCKED / NOT
  EXERCISED`, zero feature failures:
  `https://github.com/motioneso/Jarv1s/pull/1050#issuecomment-4966075807`. Do not launch sensitive
  QA or merge until valid live Preview plus CLI proof exists. Builder `UX 991 Build Luna`, session
  `019f5ed2-b01a-7610-95d6-da3024b4b82f`, is idle.
- Re-adopt these live planning lanes by exact label plus `agent_session.value` from a fresh
  `herdr pane list`: `UX 987 Plan Sol` = `019f5e9b-c003-7350-acba-258a601e308b`; `UX 992 Plan Sol`
  = `019f5e9b-bf80-73f3-86c2-7bf40e0024f9`; `UX 993+995 Plan Sol` =
  `019f5e9b-bfc9-7fb0-8096-c197e41324a9`. All are idle. Continue overnight UX work from GitHub
  source-of-truth, prioritizing #1050's live-proof blocker and then the idle #987/#992/#993/#995
  planning lanes.
- The successor must extract and read only this final Continuation note at EOF, invoke
  `coordinate`, update the delegated-lane-owner authority block to its own immutable session id,
  commit and push, confirm it is driving, then resolve and close only the old UX session above by
  label plus session id. For the successor, `merges_since_relay` resets to `0` on adoption.

## Continuation note — 2026-07-14 UX coordinator relay adopted

- `UX Coordinator` authority is Codex session
  `019f5fc7-4cac-7760-8e3a-9f5d766c5862`; adoption commit `30ea3c79` is pushed and
  `merges_since_relay` is `0`. The spent UX Coordinator session
  `019f5ee8-8a0a-7da2-a186-8170ea85e76a` was fresh-resolved by label plus session id and closed.
  Primary `Coordinator` session `58a78927-385c-4b1d-8fa0-94db20255d6f` remains protected and was
  explicitly told not to reap this session.
- PR #1050 remains frozen at `0b280f51943bbfeb514eb06a0b945e8fc6556935` with all CI green and
  no product failure claimed. `UX 991 Build Luna`, session
  `019f5ed2-b01a-7610-95d6-da3024b4b82f`, is working on one corrected real-UI desktop+narrow run
  with ordinary CLI transport, screenshots, and a separate CLI/persona transcript. Do not launch
  sensitive QA or merge without the accepted live-proof PR comment.
- Planning lanes were fresh-resolved and resumed from GitHub source of truth: `UX 987 Plan Sol`
  session `019f5e9b-c003-7350-acba-258a601e308b` is finalizing green draft PR #1044; `UX 992 Plan
  Sol` session `019f5e9b-bf80-73f3-86c2-7bf40e0024f9` is finalizing green draft PR #1043; `UX
  993+995 Plan Sol` session `019f5e9b-bfc9-7fb0-8096-c197e41324a9` is finalizing green draft PR
  #1045. All three remain docs-only until their planning PR lands.
- Independent QA cycle 1 is RED for PR #1044: the plan must contain the stale-People-folder error
  at the Notes after-sync caller and preserve the acceptance-required delete review link. `UX 987
  Plan Sol` is correcting docs only. Independent QA cycle 1 is RED for PR #1043: the empty
  `objectText` fallback can expose raw predicates and the approval status is stale. `UX 992 Plan
  Sol` is correcting docs only. Two failed cycles on either lane is stop-the-line.
- Initial Opus security QA for PR #1045 is GREEN and posted at
  `https://github.com/motioneso/Jarv1s/pull/1045#issuecomment-4967102733`. The owning lane is
  rebasing its five-behind branch onto current `origin/main`; fresh integrated Opus QA is required
  afterward, followed by Ben's explicit security-tier merge sign-off. The non-blocking sequencing
  note is that #993 and #995 both plan changes to `apps/web/src/styles/settings-panes.css`.
- PR #1050 live proof reached the real authenticated Assistant with ordinary CLI transport and
  confirmed a product blocker at frozen head `0b280f51943bbfeb514eb06a0b945e8fc6556935`: after typing
  a draft and clicking the exact Discard control, the textarea retained the draft instead of the
  saved server snapshot. Evidence is
  `https://github.com/motioneso/Jarv1s/pull/1050#issuecomment-4967161048`. The lane is stop-the-line
  and reopened for the owning agent to diagnose the shared flow, add one focused regression check,
  and push a root-cause fix before any fresh live proof, sensitive QA, or merge.
- PR #1045 rebased cleanly to `ca077a3393318188b2e4c599765cfadf452e2ef9` and is zero commits
  behind `main`; integrated CI is still running. The prior GREEN security verdict applies only to
  pre-rebase head `ead987d3f9ac23c3591e0fba2eae6b4ad0d53f71`, so a fresh Opus verdict is still required.
- Current zero-behind integrated heads, all awaiting required CI: PR #1043 cycle-2 candidate
  `7dec9072aafbaecd572d8b1e0fa8f9d969e51565`; PR #1044 cycle-2 candidate
  `025217960e5c8921656b10e8a2168ff9afa268e0`; PR #1045 security re-QA candidate
  `86e28ee633aa66d52e26fb1fcec1abcef7c85700`; PR #1050 Discard-fix candidate
  `8a976ecd5621f5ed141832a801d32231eb181a6f`. #1050 still requires a fresh accepted live proof
  before sensitive QA; #1043/#1044 require independent cycle-2 QA; #1045 requires fresh Opus QA
  plus Ben's explicit sign-off.
- PR #1050 root cause at `8a976ecd5621f5ed141832a801d32231eb181a6f`: `discardPersonaDraft`
  passed the full runtime draft into `createPersonaDraft` after the saved snapshot, so unsaved
  `personaText` overwrote saved server text. The minimum fix copies only the four persona dials.
  The focused regression failed before the fix and now passes; format, lint, typecheck, foundation,
  and both Compose smokes are green. The owning lane is running one fresh desktop+narrow real-UI
  proof with ordinary CLI transport at this exact head; frozen `0b280f5` must never be retried.
- PR #1043 / issue #992 merged routine as squash
  `aa3c25b9183ee033c6c6205ab21d739ac9baf1e0` after cycle-2 integrated QA GREEN at
  `7dec9072aafbaecd572d8b1e0fa8f9d969e51565`. Issue #992 is closed, its project item is Done, and
  the clean `UX 992 Plan Sol` pane/worktree/branch were reaped. `merges_since_relay` is now `1`;
  the next routine/sensitive merge fires the mandatory relay.
- PR #1045 final integrated Opus security QA is GREEN at
  `86e28ee633aa66d52e26fb1fcec1abcef7c85700`, posted at
  `https://github.com/motioneso/Jarv1s/pull/1045#issuecomment-4967455546`. It is docs-only and
  merge-ready, but security-tier policy still requires Ben's explicit sign-off before merge.
- PR #1044 failed independent QA cycle 2 and is STOP-THE-LINE as a draft. Durable verdict:
  `https://github.com/motioneso/Jarv1s/pull/1044#issuecomment-4967489184`. The plan omits the public
  export for `PeopleNotesFolderUnavailableError`, and its delete-review matching-card focus flow is
  not implementable within the exact-file list. The owning lane is frozen with no further edits or
  product build until Ben gives scope direction.
- PR #1050 fresh live proof at exact head `8a976ecd5621f5ed141832a801d32231eb181a6f` is
  STOP-THE-LINE: authenticated desktop Assistant authored/guided flow and corrected Discard passed,
  but real persona preview through the configured OpenAI-compatible/Codex CLI transport returned
  HTTP 503 on `POST /api/me/persona/preview` (`req-x0`). Evidence:
  `https://github.com/motioneso/Jarv1s/pull/1050#issuecomment-4967617265`. No retry, narrow,
  Priorities, or full acceptance claim is allowed. The owning lane is diagnosing the route,
  transport binding, all callers, and error mapping to classify a product defect versus an exact
  external prerequisite before any further proof.
- PR #1050 diagnosis found no product defect and made no feature edit. The route reaches the CLI
  structured adapter and `ChatEngineRpcClient`; unavailable RPC or CLI launch failure intentionally
  maps to sanitized HTTP 503. `req-x0` therefore proves transport execution failed, not auth/session
  or provider-model DB absence. The exact external prerequisite is a successful in-container
  cli-runner socket hello, Codex CLI launch/account authentication, selected-model execution, and
  provider probe/preview. A connected provider row, curated models, or copied host `auth.json` is
  not execution proof. Luna is frozen idle; the protected primary Coordinator was sent the blocker
  for environment/credential-plumbing ownership. PR #1050 remains draft and unmerged.
- Primary Coordinator confirmed #1050's live-proof blocker owner is Ben and parked it in
  `docs/coordination/AWAITING-BEN.md`. No product edit or retry is allowed. Options are: real CLI
  auth inside UAT (credential-handling risk), split proof with the app leg in-container and the
  authenticated CLI-transport leg host-side (coordinator lean), or a stubbed UAT provider port
  (insufficient real-auth fidelity). The authored/guided and corrected Discard app/UI evidence is
  banked while Ben decides.
- PR #1045 is already rebased zero-behind onto the #1043 merge at current head
  `8a65743903eeb4c56d2c1360aad9c6963bc1087b`; both Compose smokes are green and foundation/app is
  running. The prior Opus verdict is stale after this integration. Fresh Opus QA and then Ben's
  explicit security-tier sign-off remain required.
- PR #1045 fresh final integrated Opus QA is GREEN at exact head
  `8a65743903eeb4c56d2c1360aad9c6963bc1087b`, with required CI run `29322018388` all green and no
  blockers. Mandatory verdict:
  `https://github.com/motioneso/Jarv1s/pull/1045#issuecomment-4967811903`. The disposable QA pane and
  worktree were reaped. PR #1045 must remain unmerged until Ben explicitly approves this
  security-tier merge.
- Ben explicitly approved PR #1045 at `8a65743903eeb4c56d2c1360aad9c6963bc1087b`, but the mandatory
  pre-merge authority/current-main check found the branch had become two commits behind
  `origin/main` at `7d5b5e70f22e65cc795fc35efabfdcb5a4566612`. No merge occurred. The owning lane is rebasing;
  the changed head requires green integrated CI, fresh Opus QA, and renewed Ben sign-off.
- Ben then explicitly directed that no additional QA is required after this rebase and granted
  standing security-tier merge approval once the new exact head is zero-behind and all required CI
  is green. The coordinator must still re-confirm session authority, exact head, current-main
  integration, and CI immediately before merge.
- Latest scope instruction supersedes execution of that standing approval: PR #1045 is REPORT/HOLD
  ONLY at green, zero-behind head `0e43eb974c8e61917233133a906ac831083fe3fd`. Do not merge from
  readiness notifications; wait for a separate explicit merge command. No merge occurred.

## Continuation note — 2026-07-14 after PR #1045 security merge

- `UX Coordinator` authority remains Codex session
  `019f5fc7-4cac-7760-8e3a-9f5d766c5862` until its successor adopts the run. The user explicitly
  directed merging every currently mergeable open PR, superseding the prior #1045 hold.
- PR #1045 merged security-tier as squash `0b6aa71c88ed53b3abe29b8d4226701f0737ab77`
  from exact head `0e43eb974c8e61917233133a906ac831083fe3fd` after all CI green and Ben's explicit
  approval. Issues #993 and #995 correctly remain open in Backlog for their product builds. The
  clean planning pane, worktree, and local branch were reaped.
- The security merge fired the unconditional relay trigger. `merges_since_relay` is `2`. The
  successor must update the authority block to its own immutable session id, reset the counter to
  `0`, commit and push, confirm it is driving, then fresh-resolve and close only this spent UX
  Coordinator session by exact label plus session id.
- Remaining open PRs are not currently mergeable: PR #1050 is draft and parked with Ben on the
  real authenticated Codex CLI proof boundary; idle owner `UX 991 Build Luna` session
  `019f5ed2-b01a-7610-95d6-da3024b4b82f`. PR #1044 is draft/STOP-THE-LINE after two failed QA
  cycles pending Ben's file-scope direction; idle owner `UX 987 Plan Sol` session
  `019f5e9b-c003-7350-acba-258a601e308b`. PR #1008 is draft and must be assessed from GitHub source
  of truth for whether it is superseded before any ready/merge action.
- Successor `UX Coordinator` is driving as Codex session
  `019f6186-4d43-7f22-9e6a-6a368a1d4c89` from full relay checkpoint `4246a39a`; authority adoption
  commit `df8810ed` is pushed and `merges_since_relay` is `0`. The spent `UX Coordinator Relay Old`
  session `019f5fc7-4cac-7760-8e3a-9f5d766c5862` was fresh-resolved by exact label plus session and
  closed. The separate primary `Coordinator` remains protected.
- GitHub source of truth confirms PR #1008 is fully superseded: the #986/#989/#990 spec blobs are
  byte-identical on `main`, and its older #987 spec is replaced by draft PR #1044. PR #1008 was
  closed unmerged with durable explanation
  `https://github.com/motioneso/Jarv1s/pull/1008#issuecomment-4971755847`.
- PR #1050 remains draft and parked with Ben at head `8a976ecd5621f5ed141832a801d32231eb181a6f`;
  no product edit, proof retry, QA, or merge was started. PR #1044 remains draft/STOP-THE-LINE at
  head `025217960e5c8921656b10e8a2168ff9afa268e0`; no scope edit, QA cycle, ready action, or merge was
  started pending Ben's direction.
- Ben approved expanding PR #1044's exact-file scope to include the People public export/barrel and
  the minimum AppShell, ChatControls, and chat action-card/state wiring needed to target and focus a
  specific pending delete review. Durable direction:
  `https://github.com/motioneso/Jarv1s/pull/1044#issuecomment-4971902149`. The STOP-THE-LINE scope
  blocker is resolved and existing owner `UX 987 Plan Sol` session
  `019f5e9b-c003-7350-acba-258a601e308b` is revising the docs-only draft for fresh independent QA;
  product implementation and merge remain gated. PR #1050 remains parked with Ben.
- PR #1044's revised docs-only head is `fedf3d24a68b6732cd0f5baec51f6f54ab8054bd`, rebased onto
  `0b6aa71c88ed53b3abe29b8d4226701f0737ab77`. Owner docs checks are green and the three required
  checks in run `29352947263` are running. After CI green, fresh independent sensitive QA must
  verify the public People error barrel export and exact AppShell -> ChatControls -> ChatDrawer ->
  matching ActionRequestCard stable-ID focus path, including the explicit no-chat-redesign and
  no-resolver-expansion boundary. Owner `UX 987 Plan Sol` is done pending that gate.
- PR #1044 passed all required CI at exact head `fedf3d24a68b6732cd0f5baec51f6f54ab8054bd`.
  Fresh independent sensitive QA was GREEN with no blockers and posted the durable verdict at
  `https://github.com/motioneso/Jarv1s/pull/1044#issuecomment-4972201784`. After the authority and
  zero-behind checks matched, the docs-only PR merged as squash
  `0b3d7a1903eaac99602f077f0f529af2f10b12b1`. Issue #987 remains open for implementation;
  `merges_since_relay` is `1`. Latest-main CI run `29354816172` is running, so Luna implementation
  remains gated until it is green.
- Latest-main CI run `29354816172` completed green at `0b3d7a19`. The spent planning pane and clean
  planning worktree were reaped. Fresh implementation worktree
  `~/Jarv1s/.claude/worktrees/ux-987-notes-people-implementation` was created from that exact main;
  `UX 987 Build Luna` session `019f61cb-e119-7d41-ac45-390878fe72ff` is verified working on
  `gpt-5.6-luna` at medium reasoning. Its product PR remains sensitive and requires independent QA
  plus live desktop+narrow proof before merge.
- Primary `Coordinator` session `eb173f3a-c671-40c7-9bd2-78cbec597433` confirmed no collision with
  #987; its only tracked PR #1056 is disjoint and it will flag any change. The builder's exact locks
  are `packages/people/src/index.ts`, `settings-vault-chooser.tsx`,
  `settings-personal-data-panes.tsx`, `chat-controls-context.ts`, `app-shell.tsx`, `chat-drawer.tsx`,
  `action-request-card.tsx`, and the focused action-card/chooser unit tests. The merged plan was
  explicitly approved to immutable builder session `019f61cb-e119-7d41-ac45-390878fe72ff`; Task 5
  is active with no `docs/coordination/**`, `tests/uat/**`, chat policy/routes/styles, approval store,
  or broader redesign scope.
- GitHub confirms Primary's PR #1056 changes only eight disjoint registry-publishing/docs paths and
  does not touch `packages/module-registry/src/index.ts` or any requested #987 path. The builder's
  plan-listed expansion is approved for `packages/vault/src/{vault-ops,index}.ts`,
  `packages/people/src/{routes,notes-service,types}.ts`, `packages/module-registry/src/index.ts`,
  `apps/web/src/api/{people-client,query-keys}.ts`, `settings-people-pane.tsx`, and only their
  plan-listed tests. Task 5 is committed at `6af36114`; its focused action-card test and web
  typecheck pass. The People package's workspace-wide `TS6059` rootDir failure is baseline and is
  not treated as feature evidence or a waiver. Tasks 1-4 and 6 are active under the expanded locks.
- Builder session `019f61cb-e119-7d41-ac45-390878fe72ff` completed #987 and opened sensitive product
  PR #1058 at exact head `d0344d21c78918f945a48c9373e108e286934ffb`, zero behind `main`
  `ab57e542ef8bbf4380ac484e66d503ef9af1d73c`. GitHub confirms the diff is limited to the 17 approved
  paths. Required CI run `29357630990` is running; builder verification is green except reported
  unrelated integration baseline failures, which are not waived or accepted as PR evidence.
  Primary `Coordinator` session `eb173f3a-c671-40c7-9bd2-78cbec597433` correctly declined the UAT
  request because touching this lane's PR/worktree would violate the dual-coordinator boundary.
  This UX lane launched its own independent Webwright UAT task `/root/uat_1058_live` in detached
  exact-head worktree `~/Jarv1s/.claude/worktrees/uat-1058-notes-people` for Notes, People, four
  refresh counters, and stable-ID delete-card focus. Fresh independent sensitive QA waits for CI
  green. No merge or issue closure is allowed before both durable gates pass.
- Exact-head Webwright UAT hard-blocked before UI because the real prod-shaped app crashes route
  coverage: `GET /api/people/notes-directories` is registered in `packages/people/src/routes.ts`
  but absent from `peopleModuleManifest.routes`. GitHub CI independently reports both deployment
  smokes RED on run `29357630990`; no waiver applies and sensitive QA did not start. Builder session
  `019f61cb-e119-7d41-ac45-390878fe72ff` is reopened to fix the manifest source within its approved
  lock and add the smallest focused regression check. A new head requires fresh CI, live UAT, and
  independent QA; the current UAT task is posting durable BLOCKED evidence.
- Builder fixed the STOP-THE-LINE defect at new exact head
  `d24057818f6b44d273c8e28ae3cb595e7e7e0349` by composing the People manifest once with the missing
  `GET /api/people/notes-directories` claim inside the already-approved module-registry lock; no
  other path changed. Existing route-coverage/route-guard tests pass (13 tests) and module-registry
  typecheck/diff-check pass. GitHub confirms the branch remains zero behind with the same 17-file
  scope; fresh CI run `29358529658` is running. The old-head BLOCKED UAT remains valid evidence,
  while new-head CI, UAT, and independent sensitive QA must all run from scratch.
- Old-head Webwright BLOCKED evidence is durable at
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4972683927`. Fresh CI run
  `29358529658` completed fully green at `d2405781`. Independent exact-head Webwright UAT task
  `/root/uat_1058_live_v2` and independent sensitive QA task `/root/qa_1058_sensitive` are running;
  merge remains prohibited until both post durable GREEN verdicts.
- Independent sensitive QA cycle 1 is RED at exact head `d2405781`; durable verdict:
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4972994291`. Blockers are unreachable
  Notes-root recovery on the actual 503 shape, inability to select recommended `People` before it
  exists, incomplete refresh/manual-create guidance separation, and missing trust-boundary plus
  exact-focus regression coverage. Builder session `019f61cb-e119-7d41-ac45-390878fe72ff` is
  reopened within approved product and plan-listed test paths. UAT v2 ended in an agent transport
  disconnect with no product verdict; it is not retried on this now-stale RED head. A new head
  requires fresh CI, UAT, and independent sensitive QA.
- Builder corrected all four QA cycle-1 roots at new head
  `9604babd2fb177d80c2ee44e88510da4b87d9c9a`: actual 503 Notes recovery, pre-creation recommended
  `People` selection, refresh/manual-create guidance separation, and focused trust-boundary plus
  stable-ID focus regression coverage. Focused verification is green (47 tests across 5 files and
  typecheck); the broad integration command timed out at 120 seconds with no result and is neither
  accepted nor waived. GitHub confirms zero behind `main` and 21 approved/plan-listed product/test
  paths. Fresh CI run `29361825235` and exact-head Webwright UAT task `/root/uat_1058_live_v3` are
  running. Sensitive QA cycle 2 starts only after CI green; another RED is STOP-THE-LINE.

## Continuation note — 2026-07-14 compacted coordinator relay

- The compaction tripwire fired for current `UX Coordinator` Codex session
  `019f6186-4d43-7f22-9e6a-6a368a1d4c89`; it merged nothing after the trigger. Its successor must
  adopt the delegated-lane-owner authority block using its own immutable `agent_session.value`,
  reset `merges_since_relay` to `0`, commit and push, confirm it is driving, then fresh-resolve and
  close only this spent session by exact `UX Coordinator Relay Old` label plus session id. Never
  trust a written pane number and never reap or interfere with the separate primary `Coordinator`.
- PR #1058 remains the immediate gate at exact head
  `9604babd2fb177d80c2ee44e88510da4b87d9c9a`. CI run `29361825235` and exact-head Webwright UAT v3
  task `/root/uat_1058_live_v3` were running at handoff. Fresh sensitive QA cycle 2 must start only
  after full CI green and must post a durable PR verdict. A second QA RED is STOP-THE-LINE. No
  UAT, QA, integration, merge, or issue-closure claim has been made on this head.
- After #1058, #995 is newly unblocked and #993 also has an approved plan; coordinate their exact
  order from current GitHub source of truth and collision state. #1002 follows the settled UI, #988
  is the final acceptance pass, and #1003 is future scope rather than a closure blocker. PR #1050
  remains parked with Ben. The separate primary Coordinator boundary remains in force.

## Continuation note — 2026-07-14 successor adoption checkpoint

- `UX Coordinator` Codex session `019f6226-78b2-7c31-9a84-f01d3c85eb0c` adopted delegated-lane
  authority in commit `772029cb`, pushed it, and reset `merges_since_relay` to `0`. It then
  fresh-resolved and closed only spent `UX Coordinator Relay Old` session
  `019f6186-4d43-7f22-9e6a-6a368a1d4c89`; the separate primary `Coordinator` was not touched.
- Exact-label/session fleet adoption is complete: `UX 987 Build Luna`
  `019f61cb-e119-7d41-ac45-390878fe72ff` remains the frozen owning lane for PR #1058, and
  `UX 991 Build Luna` `019f5ed2-b01a-7610-95d6-da3024b4b82f` remains parked with PR #1050.
- PR #1058 is still at exact head `9604babd2fb177d80c2ee44e88510da4b87d9c9a`. Full CI run
  `29361825235` is green, but fresh sensitive QA cycle 2 returned RED with five blockers and unmet
  exit criteria (durable verdict `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4973456840`).
  This is the second QA RED, so STOP-THE-LINE issue #1060 is open and `UX 987 Build Luna` is frozen
  pending Ben's direction. Exact-head Webwright UAT v3 was interrupted because any evidence on this
  blocked head would be obsolete after fixes. No UAT, merge, or issue-closure claim is made.
- GitHub/spec collision source of truth resolves the serialized queue as #1058 → #995 → #993 →
  #1002 → #988. #995 must branch from post-#1058 `main`; #993 must wait for #995 because both touch
  shared Settings files. #1002 still needs approved spec/plan. #1050 remains parked with Ben and
  #1003 remains future scope, not a run-closure blocker. #995 is not released while #1058 is halted.

## Continuation note — 2026-07-14 PR #1058 remediation reopened

- Ben explicitly reopened the stopped PR #1058 lane and requested a Sol-high fixing agent. The
  clean idle `UX 987 Build Luna` session `019f61cb-e119-7d41-ac45-390878fe72ff` was fresh-resolved
  and closed before the replacement received the worktree.
- Durable remediation handoff `docs/superpowers/handoffs/2026-07-14-pr-1058-qa-fixes.md` is pushed
  on PR #1058 at head `a0a97b3e9672e2fccfbe9fb7fbba98d83d88370b`. It points to all five QA
  blockers and preserves the sensitive-lane invariants and coordinator-only boundaries.
- Exact-label/session owner is now `UX 987 Fix Sol High`
  `019f6248-1c51-79d3-b50b-8a741573db1f`, running `gpt-5.6-sol` with high reasoning in the
  existing isolated branch worktree. The coordinator approved
  `docs/superpowers/plans/2026-07-14-pr-1058-qa-remediation.md`: four scoped TDD commits covering
  all five verified-current blockers, with no product fork. Implementation is released.
- Stop-line issue #1060 remains open as the audit trail but is marked remediation-in-progress at
  `https://github.com/motioneso/Jarv1s/issues/1060#issuecomment-4973605100`. No merge or closure
  claim is made. The fixed head still requires fresh full CI, independent sensitive QA, and live
  Webwright UAT before #995 can be released.

## Continuation note — 2026-07-14 PR #1058 remediation built

- `UX 987 Fix Sol High` session `019f6248-1c51-79d3-b50b-8a741573db1f` completed the approved
  four-commit remediation and pushed exact head `f28bc712a00590f467de4f036c1b4198d3e77477`.
  Scope covers chooser state, recoverable People/vault failures, stale-folder recovery/hierarchy,
  and desktop+narrow live-path coverage; the branch worktree is clean.
- Agent evidence: 26 focused unit, 44 isolated integration, and 2 Playwright tests green;
  `VF_EXIT=0` with 3,326 unit and 1,648 integration tests passed; 155 migrations current;
  `AUDIT_EXIT=0`; pre-push format/lint/typecheck green; fresh `origin/main` rebase current.
- GitHub CI run `29371316048` and exact-head live UAT are GREEN, with UAT evidence at
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4974495266` and artifacts under
  `~/Jarv1s/.claude/worktrees/coord-983-ux/outputs/pr-1058-uat-v4/final_runs/run_2/`. Fresh
  independent sensitive QA returned RED with one blocking vault-path log leak at
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4974624280`; MERGE-READY is NO.
  `UX 987 Fix Sol High` has been reopened for the root-cause redaction fix and smallest regression
  test. The next head must rerun CI, QA, and UAT. No merge, issue-closure, or #995 release claim is
  made.

## Continuation note — 2026-07-14 PR #1058 QA leak fixed

- `UX 987 Fix Sol High` fixed the remaining vault-path log leak in scoped commit `2425d382` and
  pushed exact head `2425d382b6c7c664aa119cfc7fb35f22bfbc9d4d`. The shared People load catch now
  contains directory listing and per-file reads, maps unavailable filesystem errors to the safe
  domain error before API logging, and has a regression proving the fixed safe 400 contains no
  vault path.
- Agent evidence: focused People service/routes 17/17 green; scoped format/lint and root typecheck
  green; `VF_EXIT=0` with 3,326 unit and 1,648 integration tests passed; 155 migrations current;
  `AUDIT_EXIT=0`; pre-push trio green; fresh `origin/main` rebase current; branch worktree clean.
- Fresh GitHub CI run `29374741166` is fully GREEN. Fresh live UAT is GREEN with
  durable evidence at `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4974908358` and
  artifacts under `~/Jarv1s/.claude/worktrees/coord-983-ux/artifacts/webwright/pr-1058-live-v5-2425d382/`.
  Fresh final independent sensitive QA returned RED with one blocker and two non-blocking findings;
  MERGE-READY is NO (`https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4975051910`).
  This is the second failed QA cycle since Ben reopened the lane, so STOP-THE-LINE is active again.
  `UX 987 Fix Sol High` is frozen and issue #1060 records the escalation at
  `https://github.com/motioneso/Jarv1s/issues/1060#issuecomment-4975058125`. No further fix/QA cycle,
  merge, issue-closure, or #995 release without Ben direction.

## Continuation note — 2026-07-14 PR #1058 reopened after stop-line

- Ben explicitly authorized continued remediation: “reopen, just keep chipping away at it.” The
  authorization is durable on issue #1060 at
  `https://github.com/motioneso/Jarv1s/issues/1060#issuecomment-4975784144`.
- A fresh Herdr pane list re-confirmed coordinator authority as exact label `UX Coordinator`,
  immutable Codex session `019f6226-78b2-7c31-9a84-f01d3c85eb0c`. The separate primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains out of scope and untouched.
- The exact build owner `UX 987 Fix Sol High`, immutable Codex session
  `019f6248-1c51-79d3-b50b-8a741573db1f`, was reopened in
  `~/Jarv1s/.claude/worktrees/ux-987-notes-people-implementation`. It is actively reading the
  durable sensitive-QA verdict `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4975051910`
  and remediating the single blocker at root cause with the smallest regression test.
- PR #1058 remains OPEN at exact head `2425d382b6c7c664aa119cfc7fb35f22bfbc9d4d` while the fix is
  in progress. After the agent pushes a new exact head, require full CI including the image-build
  tail, fresh exact-head live Webwright UAT with durable PR evidence, and fresh independent
  sensitive QA. Do not merge until all three gates are green. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 PR #1058 ELOOP blocker remediation delivered

- `UX 987 Fix Sol High` delivered root-cause remediation at exact local/origin/GitHub head
  `adeeff6267f467ed8605d16a549e2e533a6a0ba2`. The People list/read boundary now translates
  `VaultPathError` and path-bearing Node filesystem errors, including `ELOOP`, to the fixed safe
  unavailable-folder error while parser, database, and programming work remains outside the
  translation catches.
- Regression evidence covers a valid saved People folder replaced by a self-looping symlink:
  the route now returns the fixed safe 400 without exposing the vault path. Focused People
  service/routes tests are 17/17 green. `VF_EXIT=0` with 3,326 unit and 1,648 integration tests
  passed, 155 migrations current; `AUDIT_EXIT=0`; pre-push format/lint/typecheck green; fresh
  `origin/main` rebase current.
- The exact-head GitHub CI run is `29382151403` and is in progress. The build lane is frozen at
  this head. Previous CI, UAT, and sensitive-QA evidence is stale and must not be reused. Require
  full CI including image-build tail, fresh exact-head live Webwright UAT with durable PR evidence,
  and fresh independent sensitive QA before merge. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 PR #1058 exact-head CI green; final gates running

- Exact-head CI run `29382151403` is fully GREEN at
  `adeeff6267f467ed8605d16a549e2e533a6a0ba2`: compose deployment smoke, production compose smoke,
  foundation/app verification, and the image-build/publish tail all completed successfully.
- Fresh parallel post-CI gates are running against this exact head. `uat_1058_live_v6` owns a new
  live Webwright pass through the real UI with new screenshots/action log and a durable PR comment.
  `qa_1058_eloop_final` owns fresh independent sensitive QA from a detached exact-head checkout with
  a durable compact PR verdict. Neither lane may reuse prior-head evidence or edit feature code.
- The build owner remains frozen. Do not merge until both fresh lanes return GREEN and the PR head
  is re-confirmed unchanged. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 PR #1058 sensitive QA RED; remediation reopened

- Fresh independent sensitive QA at exact head
  `adeeff6267f467ed8605d16a549e2e533a6a0ba2` returned RED with one blocker and two non-blocking
  findings; `MERGE-READY: NO`. Durable verdict:
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4976204613`.
- Because this head must change, the in-progress fresh UAT lane was stopped before completing;
  any evidence from it would have become stale. The new cycle is recorded on stop-line issue #1060
  at `https://github.com/motioneso/Jarv1s/issues/1060#issuecomment-4976208782`.
- Under Ben's standing instruction to “just keep chipping away at it,” a fresh Herdr pane list
  re-resolved exact owner `UX 987 Fix Sol High`, immutable session
  `019f6248-1c51-79d3-b50b-8a741573db1f`, and reopened it with the durable verdict pointer. The
  owner is actively remediating the blocker at root cause with the smallest regression. The
  separate primary `Coordinator` remains untouched. After a new head, repeat full CI including
  image tail, fresh live UAT, and fresh independent sensitive QA. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 PR #1058 GET/PUT classifier remediation delivered

- `UX 987 Fix Sol High` delivered exact local/origin/GitHub head
  `77aafb8e375fc8d6e8904d7fb43c84e28bf90336`. The People directory GET/PUT classifier now contains
  `VaultPathError`, fixed known errnos, and path-bearing Node filesystem errors including `ELOOP`,
  while preserving unrelated programming errors.
- The smallest regression drives a realistic path-bearing `ELOOP` through both GET and PUT catches
  and proves fixed safe 400 responses with no vault-path disclosure. Focused People routes/service
  tests are 17/17 green. `VF_EXIT=0` with 3,326 unit and 1,648 integration tests passed, 155
  migrations current; `AUDIT_EXIT=0`; pre-push format/lint/typecheck green; fresh `origin/main`
  rebase current. The two non-adjacent UI findings remain untouched.
- GitHub independently confirms the exact PR head and CI run `29384838614` is in progress; both
  compose smoke jobs are green and foundation/app verification is running. The build lane is frozen.
  Require full CI including image tail, then fresh live UAT and fresh independent sensitive QA.
  Previous-head evidence is stale. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 PR #1058 full CI green; fresh final gates running

- Exact-head CI run `29384838614` is fully GREEN at
  `77aafb8e375fc8d6e8904d7fb43c84e28bf90336`: both compose smoke jobs, foundation/app verification,
  and image build/publish all completed successfully.
- Fresh parallel gates are running against this exact head. `uat_1058_live_v7` owns a new live
  Webwright real-UI pass with unique screenshots/action log and durable PR evidence.
  `qa_1058_directory_final` owns a fresh independent sensitive review from a detached exact-head
  checkout with a durable compact PR verdict. Neither may reuse prior-head evidence or edit feature
  code. The build owner remains frozen.
- Do not merge until both gates return GREEN and the exact PR head is re-confirmed unchanged.
  `merges_since_relay` remains `0`.

## Continuation note — 2026-07-14 #1002 product clarification

- Ben clarified that in-product “Coming soon” promises must not be removed as cleanup. #1002 must
  inventory every promised feature and ensure each has a concrete GitHub issue with enough scope to
  enter the future build queue; promises remain commitments and none may be left orphaned/untracked.
  Durable clarification: `https://github.com/motioneso/Jarv1s/issues/1002#issuecomment-4976539702`.
- This does not change the current merge order: finish #1058, then #995, #993, #1002, and #988.
  PR #1050 remains parked and #1003 remains future scope. PR #1058's fresh UAT and sensitive-QA
  lanes continue against exact head `77aafb8e375fc8d6e8904d7fb43c84e28bf90336`.

## Continuation note — 2026-07-14 PR #1058 merged; release #995 after main green

- PR #1058 merged from exact head `77aafb8e375fc8d6e8904d7fb43c84e28bf90336` as squash commit
  `2c841e5444dbc15c97e466f10eafaa9dba7072ba`. Exact-head CI run `29384838614` was fully GREEN,
  fresh independent sensitive QA was GREEN with zero blockers at
  `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4976544220`, and fresh live Webwright
  UAT was GREEN at `https://github.com/motioneso/Jarv1s/pull/1058#issuecomment-4976585224`.
- Issue #987 and stop-line issue #1060 are CLOSED and their project items are Done. The spent exact
  build owner `UX 987 Fix Sol High` session `019f6248-1c51-79d3-b50b-8a741573db1f` was fresh-resolved
  and closed; its clean worktree was removed. The separate primary `Coordinator` remains untouched.
- `merges_since_relay` is now `1`. This sensitive merge does not yet fire the two-merge relay
  threshold. Next queue item is #995, but release it only after GitHub source-of-truth/spec checks
  and the post-merge `main` CI run is fully green. Remaining order: #995, #993, #1002, #988.

## Continuation note — 2026-07-14 #995 blocked on approved brief/spec and main CI

- GitHub source of truth confirms #995 is OPEN/Backlog and labeled `needs-spec`. No matching approved
  spec or plan exists under `docs/superpowers/specs/` or `docs/superpowers/plans/`, so the coordinate
  stop rule forbids spawning its build lane. Its issue body already contains detailed findings and
  acceptance criteria, but these do not replace Ben's approved feature brief/spec.
- The rigid `brief` workflow has started and must ask its six questions one at a time, beginning with
  the core problem. After Ben confirms the synthesized brief, write/approve the durable spec and
  remove the `needs-spec` gate before spawning #995.
- Post-merge `main` CI run `29386816789` is in progress at merge commit
  `2c841e5444dbc15c97e466f10eafaa9dba7072ba`; it must be fully green including image tail before
  release. No #995 build agent has spawned. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 brief/spec approved; awaiting main green

- Ben approved the six-question feature brief. The grounded durable spec is
  `docs/superpowers/specs/2026-07-14-connected-accounts-cleanup.md` at coordinator commit
  `b3dbff77`; GitHub pointer: `https://github.com/motioneso/Jarv1s/issues/995#issuecomment-4976681549`.
  The `needs-spec` label was removed.
- Locked scope: clean the existing Connected Accounts surface; reuse the existing generic IMAP
  APIs/presets and shared health classifier; remove Apple-specific and unplanned `Other (OAuth)`
  options; preserve tracked `Coming soon` commitments; no new connector backend, schema, credential
  mechanism, or settings framework. Classified `security` because the existing UI accepts connector
  credentials; final QA requires Opus adversarial review and Ben's explicit merge sign-off.
- Post-merge `main` CI run `29386816789` remains in progress with both compose smoke jobs green and
  foundation/app verification running. Do not create or spawn the #995 build lane until the full run,
  including image tail, is green. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 build lane released

- Post-merge `main` CI run `29386816789` is fully GREEN at
  `2c841e5444dbc15c97e466f10eafaa9dba7072ba`, including both compose smoke jobs, foundation/app, and
  image build/publish. The release gate cleared.
- Created isolated worktree `~/Jarv1s/.claude/worktrees/ux-995-connected-accounts-cleanup` on branch
  `ux/995-connected-accounts-cleanup` from that exact `origin/main`. The branch contains the approved
  spec commit `76d6b439` and committed handoff `973a14d2`; no product code existed at spawn.
- Spawned exact label `UX 995 Build`, immutable Claude session
  `93f9bd82-dcac-4cfc-bbe0-2a1532c40fb5`, in the shared agents tab on confirmed Sonnet 5 with bypass
  permissions. It must use `coordinated-build`, send a plan pointer for approval, and write no product
  code before approval. #995 project status is In progress.
- Security tier remains locked: reuse existing IMAP/credential machinery, no secrets or backend/schema
  expansion; final Opus adversarial QA and Ben's explicit merge sign-off are mandatory.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 no-progress agent replaced before compaction

- Initial `UX 995 Build` session `93f9bd82-dcac-4cfc-bbe0-2a1532c40fb5` consumed its context to the
  relay threshold without producing a plan or product-code change. At 1% before auto-compaction it
  was interrupted, the worktree was verified unchanged except the ignored context-meter log, and the
  exact session was fresh-resolved and reaped.
- Spawned replacement exact label `UX 995 Build Relay`, immutable Claude session
  `7b99f727-179c-4e5c-8243-73209b4e17cc`, in the same isolated worktree/shared agents tab. It is
  confirmed Sonnet 5 with bypass permissions and fresh context. Its immediate task is the minimal TDD
  plan pointer; product code remains forbidden before coordinator approval.
- No duplicate agent shares the worktree. The separate primary `Coordinator` remains untouched.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 GitHub drift fixed; #995 low-effort agent active

- GitHub audit confirmed #987 and #1060 Closed/Done, #995 Open/In progress, and #993/#1002/#988
  Open/Backlog. Corrected parent epic #983 from Backlog to In progress and removed the stale
  `needs-spec` label from shipped #987. #995 already had `needs-spec` removed after brief approval.
- Replacement `UX 995 Build Relay` session `7b99f727-179c-4e5c-8243-73209b4e17cc` repeated the
  predecessor's no-action context burn. It was interrupted at 11% before compaction, the branch was
  again verified unchanged except the ignored context-meter log, and the exact session was reaped.
- Spawned exact label `UX 995 Build Low`, immutable Claude session
  `6796dfa2-32c4-4a5d-b2fc-71e257c25e6d`, using the same required Sonnet 5 model with `--effort low`,
  bypass permissions, shared agents tab, and isolated worktree. Its immediate task remains a minimal
  plan pointer; no product code before coordinator approval. The primary `Coordinator` is untouched.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 plan approved; GitHub promise tracked

- `UX 995 Build Low` produced plan pointer
  `docs/superpowers/plans/2026-07-14-ux-995-connected-accounts-cleanup.md` from exact `main`
  `2c841e54` with no spec drift. The six-task TDD plan is approved with one required correction.
- The plan proposed removing GitHub because no owning issue existed. That conflicted with Ben's
  decision that legitimate `Coming soon` promises must become tracked commitments, not disappear.
  Independent GitHub search confirmed no existing owner, so created #1061
  `https://github.com/motioneso/Jarv1s/issues/1061` (Open/Backlog, `needs-spec`, milestone 16) and
  recorded it on #1002. #995 must retain GitHub as truthful tracked `Coming soon`; remove only Apple
  and `Other (OAuth)`.
- The conditional correction was sent to exact session `6796dfa2-32c4-4a5d-b2fc-71e257c25e6d` with
  permission to begin TDD without another plan round. No backend/schema/contract widening is approved.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 test convention corrected; Task 1 relayed

- Approved repository-native test correction: structural component coverage uses existing
  `tests/unit/*.test.tsx` SSR `renderToString`/pure assertions; click interactions use Playwright e2e;
  no Vitest/RTL/jsdom or new frontend harness/dependency. The initial claim that no component convention
  existed was superseded after the agent found the actual root test pattern.
- `UX 995 Build Low` completed and committed Task 1 as `c51bb2a9` (export canonical IMAP provider list
  for reuse). At 1% before compaction it was stopped; worktree was clean except context-meter output.
  When its self-relay stalled, the exact session `6796dfa2-32c4-4a5d-b2fc-71e257c25e6d` was reaped.
- Spawned exact successor `UX 995 Build R2`, immutable Claude session
  `2e31b1b1-5b82-44c5-bb5e-6e5bcaaae4e3`, same isolated worktree/shared agents tab, confirmed Sonnet 5
  at low effort with bypass permissions. It resumes at Task 2 under the approved plan corrections.
  No duplicate session shares the worktree; primary `Coordinator` remains untouched.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 Tasks 2–5 committed; R3 driving

- `UX 995 Build R2` completed Tasks 2–5 and committed `27ad50bb`: settings `ImapConnect`, corrected
  provider picker (Google, Email/IMAP, tracked GitHub #1061 `Coming soon`), actionable health copy,
  provider-specific reconnect routing, Playwright IMAP specs, and connector mock routes. Repository
  test convention remains root `tests/unit/*.test.tsx` SSR/pure assertions plus Playwright; zero deps.
- Remaining: Task 6 feature-grants regression, execute focused e2e/full `verify:foundation` and audit,
  fresh-main rebase, push/PR, and coordinated wrap-up. No current-head verification is claimed yet.
- At the 70% relay trigger, R2 spawned exact successor `UX 995 Build R3`, immutable Claude session
  `208f2ffc-cdeb-4900-896d-2ddf4150035f`, in the same worktree/shared agents tab. R3 is confirmed
  driving on Sonnet 5 with bypass permissions. Spent exact R2 session
  `2e31b1b1-5b82-44c5-bb5e-6e5bcaaae4e3` was fresh-resolved and closed. Primary `Coordinator` remains
  untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 automated gates green; R4 driving UAT

- R3 fixed Playwright strict-mode and stale copy expectations, confirmed fresh-main rebase no-op,
  ran the scoped e2e specs green (`4/4`), completed `verify:foundation` green, and found no secret
  egress. Real-dev-instance UAT was not completed before R3's 70% relay trigger.
- Exact successor `UX 995 Build R4`, immutable Claude session
  `6b88263f-bad6-4b3b-8460-6b2620309485`, is confirmed driving on Sonnet 5 in the same worktree and
  branch. Remaining: real-dev UAT for picker, IMAP/reconnect, and narrow viewport; then push/open PR
  and report exact HEAD. Afterward: exact-head CI, live-path evidence, Opus adversarial security QA,
  and Ben's explicit merge sign-off.
- Spent exact R3 session `208f2ffc-cdeb-4900-896d-2ddf4150035f` was fresh-resolved by label plus
  session id and closed. Primary `Coordinator` remains untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-14 #995 real-dev fixes; R5 driving UAT

- R4 committed relay state at feature HEAD `b5dd2e1a` with handoff
  `docs/superpowers/handoffs/2026-07-14-ux-995-connected-accounts-cleanup-relay-3.md`.
  During real-dev setup it fixed Vite proxy Origin-header rewriting that broke trusted-origin auth
  and the shared-dev registration-approval path that blocked fresh signup.
- Exact successor `UX 995 Build R5`, immutable Claude session
  `d155294f-7360-407c-845e-d48be30b8a07`, is confirmed driving on Sonnet 5 in the same worktree and
  branch. Remaining: finish the approval path and UAT checklist, decide reconnect-path coverage,
  then coordinated wrap-up, push, PR, and exact-HEAD report. Post-PR security/live-path gates remain.
- Spent exact R4 session `6b88263f-bad6-4b3b-8460-6b2620309485` was fresh-resolved by label plus
  session id and closed. Primary `Coordinator` remains untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-15 #995 code/gates done; R6 driving UAT rerun

- R5 completed and committed code, tests, and the local gate at feature HEAD `e5d18ad0`. It fixed
  the UAT script's Settings `?section=` navigation and documented resolved approval credentials and
  reconnect-path decisions in
  `docs/superpowers/handoffs/2026-07-15-ux-995-connected-accounts-cleanup-relay-4.md`.
- Exact successor `UX 995 Build R6`, immutable Claude session
  `f694c32e-4029-4a9c-bf08-4bd0f71a459c`, is confirmed driving on Sonnet 5 in the same worktree and
  branch. Remaining: rerun and verify the fixed UAT flow, coordinated wrap-up, push, PR, and exact
  HEAD report. Post-PR exact-head CI, live-path evidence, Opus adversarial security QA, and Ben's
  explicit merge sign-off remain required.
- Spent exact R5 session `d155294f-7360-407c-845e-d48be30b8a07` was fresh-resolved by label plus
  session id and closed. Primary `Coordinator` remains untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-15 #995 PR #1063 in security verification

- Build lane reports complete at exact local/origin/GitHub HEAD
  `e5d18ad060cb46020058e05e1ac20b5866da74d5`; PR #1063 is open, non-draft, and mergeable. Local
  `verify:foundation` and release-hardening audit were green, and real-dev UAT passed. Exact-head CI
  is currently running, so no CI-green claim exists yet.
- R6 remains available for remediation and was asked to post durable PR-linked live-path evidence
  with the UAT run and screenshots. Security-tier QA is active in an isolated detached worktree:
  label `UX 995 QA Opus`, immutable Claude session
  `96aafea7-1690-4cdb-8dc3-5d8f24390d48`, model Opus 4.8.
- Merge remains blocked on exact-head CI green, durable live-path evidence, the Opus adversarial QA
  comment/verdict, and Ben's explicit security-tier sign-off. Primary `Coordinator` remains
  untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-15 #1063 UAT evidence moved exact HEAD

- R6 committed eight UAT screenshots plus README under
  `docs/superpowers/handoffs/2026-07-15-995-uat-evidence/` and posted durable PR evidence at
  <https://github.com/motioneso/Jarv1s/pull/1063#issuecomment-4977365172>.
- This evidence-only commit moved local/origin/GitHub exact HEAD to
  `f0a9872fd0f852aa33a68feada79aa3d77b317dc`; all old-head CI/QA claims are stale. A fresh three-job
  CI run is active. Opus QA was redirected to fetch and anchor its verdict to the new exact head.
- Merge remains blocked on new-head CI green, new-head Opus QA, and Ben's explicit sign-off.
  Primary `Coordinator` remains untouched. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-15 #1063 fully green; awaiting Ben sign-off

- Exact local/origin/GitHub HEAD remains `f0a9872fd0f852aa33a68feada79aa3d77b317dc`.
  Exact-head CI is fully green: foundation/app `17m11s`, compose smoke `2m04s`, prod compose smoke
  `1m59s`, and image tail `12m57s`.
- Opus adversarial QA posted GREEN / zero blockers / merge-ready at
  <https://github.com/motioneso/Jarv1s/pull/1063#issuecomment-4977474081>. Three non-blockers:
  Google-specific cached-data copy can appear for IMAP partial sync; settings/onboarding IMAP copy
  mapping is duplicated; reconnect asks non-Google users to re-pick the provider. QA also recommends
  a frontend assertion for bounded `auth_failed` copy; live UAT covers it.
- The spent exact Opus QA session `96aafea7-1690-4cdb-8dc3-5d8f24390d48` was fresh-resolved and
  closed; its detached worktree was removed. R6 remains available for remediation. Merge is blocked
  only on Ben's explicit security-tier sign-off. Primary `Coordinator` remains untouched.
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-15 #995 merged; mandatory security relay

- Ben explicitly approved the security-tier merge. After re-confirming delegated coordinator
  authority, exact HEAD `f0a9872fd0f852aa33a68feada79aa3d77b317dc`, and all four CI checks,
  PR #1063 merged by squash as `2f4f553d78f9d90fa9af382075b34f893cedde76`.
- Issue #995 is Closed / Completed and its item on project 2 (`Issue and Roadmap Work`) is Done.
  Parent #983 remains In progress. The next post-#995 queue item is #993; do not start it until the
  successor has re-adopted the fleet and refreshed GitHub source of truth.
- Exact R6 session `f694c32e-4029-4a9c-bf08-4bd0f71a459c` was fresh-resolved and closed. Its merged
  worktree was intentionally preserved because it contains untracked relay note
  `docs/superpowers/handoffs/2026-07-14-ux-995-connected-accounts-cleanup-relay-2.md`; do not delete
  or force-remove it without resolving that file.
- `merges_since_relay` increments to `2`. Because #995 was security-tier, relay is mandatory now.
  Primary `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains separate and must
  not be touched.

## Continuation note — 2026-07-15 UX relay adopted; #993 brief started

- `UX Coordinator` Codex session `019f6479-18a8-7782-ab34-a2e1d9c59c82` adopted delegated-lane
  authority in commit `3783e3fd`, pushed it, and reset `merges_since_relay` to `0`. It then
  fresh-resolved and closed only `UX Coordinator Relay Old` session
  `019f6226-78b2-7c31-9a84-f01d3c85eb0c`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched.
- GitHub source of truth: #995 is Closed/Completed; PR #1063 merged to main as
  `2f4f553d78f9d90fa9af382075b34f893cedde76`; parent #983 remains In progress; #993 is open in
  Backlog with `needs-spec`. Main CI run 29394273119 for the merge SHA is still in progress.
- #993 is now in the required pre-development brief. Do not spawn implementation until Ben
  answers the six brief questions one at a time, approves the resulting spec, and main CI is green.

## Continuation note — 2026-07-15 #993 decisions approved

- Ben replaced the generic brief with a docs-grounded grill and approved the resulting decisions in
  `docs/superpowers/specs/2026-07-15-settings-host-account-truth.md`.
- Deliver #993 as two serialized security-tier PRs: host truth first, then account truth. The host
  slice includes fixed-command one-click Herdr install, truthful Root workspace detection, useful
  system-health results, and removal of the inert Log level row. The account slice includes the
  compact profile hierarchy and local-password email change verified through a healthy send-capable
  Connection; OAuth/OIDC-only email remains provider-managed.
- Refresh GitHub and main CI before spawning. No #993 implementation agent has been started yet;
  `merges_since_relay` remains `0`.

## Continuation note — 2026-07-15 #993 host lane planning

- GitHub #993 is In progress without `needs-spec`. Main CI run 29394273119 is green on
  `2f4f553d78f9d90fa9af382075b34f893cedde76`.
- Required one-shot Opus collision/security map completed, grounded on that main SHA. It identified
  the duplicated Root-workspace predicate as the collision epicenter and confirmed no migration or
  product blocker. The new spec supersedes the old installer no-API comment; use one injected
  executor function and a process-local single-flight lock with the documented `ponytail:` ceiling.
- `UX 993 Host Build` exact Sonnet session `548668d3-c947-44a0-9cb7-05749a2af7dd` is planning on
  branch `ux/993-host-truth` in `~/Jarv1s/.claude/worktrees/ux-993-host-truth`. Risk tier `security`;
  scope is Delivery Slice 1 only. Next action: consume its compact plan pointer, approve only if it
  follows the collision order, then supervise build → PR → live UAT → Opus QA → Ben sign-off.
- `merges_since_relay` remains `0`.

## Continuation note — 2026-07-15 #993 host planning relay

- `UX 993 Host Build` session `548668d3-c947-44a0-9cb7-05749a2af7dd` hit the mandatory context
  threshold while verifying premises, before plan approval or implementation. It relayed the same
  worktree and was fresh-resolved and closed only after the successor was confirmed driving.
- `UX 993 Host Build R2` exact Sonnet session `1d81f179-c0c2-4d35-9e63-fc5782e4eb71` now owns
  branch/worktree `ux/993-host-truth`. Next action remains plan-pointer review and approval; do not
  infer implementation approval from the relay.
- `merges_since_relay` remains `0`.

## Continuation note — 2026-07-15 #993 host plan approved

- R2 hit compaction before producing a plan and was closed with no implementation edits. R3 exact
  Sonnet session `4c58610e-fcc7-405f-ab28-81e999f43b44` owns the unchanged build lane.
- R3's pointer-generation turn stalled after grounding. The coordinator ended that turn and approved
  the exact Opus-mapped TDD order already locked in the handoff: shared Root predicate → contracts →
  guarded installer/audit → health summary → UI/live UAT. This is implementation approval for Host
  Slice 1 only; every security ban and QA/sign-off gate remains active.
- `merges_since_relay` remains `0`.

## Continuation note — 2026-07-15 #993 host implementation relay

- R3 completed Task 1's TDD edits for the shared Root-workspace predicate, then hit the context
  threshold before committing. It committed relay state `2f11ab46`, left only its Task 1 edits plus
  the shared context-meter log uncommitted, and was closed after its successor was verified.
- `UX 993 Host Build R4` exact Sonnet session `2460157b-3cc0-4a64-b48f-6467d8af65c3` now owns the
  same branch/worktree. It must verify and commit Task 1, then continue Tasks 2–5 under the approved
  plan. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-15 coordinator compaction relay

- The coordinator compaction tripwire fired while `UX 993 Host Build R4` remained active; no merge,
  QA, feature-code inspection, or orchestration action followed the trigger. The host-map verdict is
  accepted and remains the controlling collision/security guidance recorded above.
- Delegated-lane authority is still `UX Coordinator` Codex session
  `019f6479-18a8-7782-ab34-a2e1d9c59c82` until the successor atomically adopts it. The successor must
  set its temporary exact label to `UX Coordinator Relay New`, update the delegated-lane-owner
  authority block to its own immutable Codex `agent_session.value`, reset `merges_since_relay` to
  `0`, commit and push, confirm it is driving, then fresh-resolve and close only exact old label
  `UX Coordinator Relay Old` plus session `019f6479-18a8-7782-ab34-a2e1d9c59c82`; after closure it
  renames itself `UX Coordinator`.
- Fresh fleet snapshot: `UX 993 Host Build R4` exact Sonnet session
  `2460157b-3cc0-4a64-b48f-6467d8af65c3` is working in
  `~/Jarv1s/.claude/worktrees/ux-993-host-truth` on branch `ux/993-host-truth` in the Agents tab.
  Re-adopt that exact label plus session and continue supervision from Task 1 verification/commit.
- Never touch the separate primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`. Preserve unrelated coordinator-worktree changes
  `.claude/context-meter.log`, `artifacts/`, and `webwright-proof-987-v3/`.
- `merges_since_relay` remains `0`; #993 Host Slice 1 remains security-tier and cannot merge without
  live UAT, a posted Opus adversarial QA verdict, and Ben's explicit sign-off.

## Continuation note — 2026-07-15 delegated UX takeover

- `UX Coordinator` Codex session `019f64f4-aff5-7270-8ae7-1625d935203a` adopted delegated-lane
  authority in pushed commit `4d494a4c`; `merges_since_relay` is `0`. The exact predecessor session
  `019f6479-18a8-7782-ab34-a2e1d9c59c82` was closed, and the separate primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` was not touched.
- `UX 993 Host Build R4` exact Sonnet session `2460157b-3cc0-4a64-b48f-6467d8af65c3` remains adopted.
  Task 1 is complete in commit `ea9c2d77`; the 2026-07-15 host-account-truth spec now controls, and
  the agent is preparing `docs/superpowers/plans/2026-07-15-993-host-truth.md` for approval before
  further implementation.
- #993 Host Slice 1 remains security-tier: live UAT, a posted Opus adversarial QA verdict, and Ben's
  explicit merge sign-off remain mandatory.
- `UX 993 Host Build R4` relayed to confirmed Sonnet successor `UX 993 Host Build R5`, immutable
  session `4cab9e73-55a0-447e-a12f-c5bf8ffd9722`; exact R4 was closed. R5 is driving the pending
  plan-pointer handoff before any implementation beyond Task 1.
- The 8-task TDD plan at `docs/superpowers/plans/2026-07-15-993-host-truth.md` is approved for Tasks
  2-9. The three-state install result (`installed|failed|timeout`) is accepted; installer output is
  not parsed and no speculative already-installed state is added. R5 is implementing sequentially.
- R5 completed Tasks 2-4 in commits `3b8f256b`, `8fe4e4f3`, and `32853ac7`; Task 5 is next.
- R5 completed Task 5 in commit `c920d460`; Tasks 6-9 remain in progress.
- R5 completed Tasks 6-7 in commits `33c75642` and `444655be`; typecheck, ESLint, and Prettier are
  green. Task 8 failure/timeout audit integration coverage is in progress.
- R5 completed Task 8 in commit `74f2906f`; its five integration tests pass, including failure,
  timeout, and installer-output leak checks. Task 9 `pnpm verify:foundation` is running.
- Task 9 `pnpm verify:foundation` is green with exit `0`. Gate fixes are committed at `ffeb251e`
  and `13e6352c`; R5 is pushing and opening the draft PR. Live UAT, posted Opus adversarial QA,
  and Ben's explicit sign-off are still pending; no merge is authorized.
- Draft PR #1065 is open at head `13e6352c`; all CI checks are green. Live UAT is GREEN with proof
  commit `9126ddc9` on `uat/1065-host-truth` and PR comment `issuecomment-4979749886`.
- Mandatory Opus adversarial QA is running in exact session
  `afb93a18-1230-494c-9c30-c495cb32983b`. Ben's explicit sign-off remains pending; no merge is
  authorized.
- Opus adversarial QA is GREEN / MERGE-READY YES with 0 blocking and 2 non-blocking findings; the
  durable verdict is PR comment `issuecomment-4979799861`. Non-blocking follow-ups are the timed-out
  installer child/concurrency edge and the missing install confirmation naming the script.
- All technical gates are green. #1065 remains paused for Ben's explicit security-tier merge
  sign-off; no merge is authorized until he gives it.
- Ben gave explicit security-tier merge sign-off. Before merge, `origin/main` advanced to
  `e88a4148`; exact R5 is rebasing PR #1065 and will push a new head. CI, live UAT, and integrated
  Opus QA must be fresh on that rebased head; no merge is authorized until all three refresh green.

## Continuation note — 2026-07-15 delegated UX compaction relay

- Current delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f64f4-aff5-7270-8ae7-1625d935203a`; `merges_since_relay` remains `0`. A compaction summary
  fired the mandatory relay trigger before any merge. The separate primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` must never be touched.
- GitHub source of truth for epic #983 is 9/13 complete (69%). Closed: #984, #985, #986, #987,
  #989, #990, #992, #994, #995. Open: #991 (`needs-spec`, major), #993 (security lane below),
  #988 (manual acceptance, cosmetic), #1002 (`needs-spec`, minor). Epic #983 remains open.
- PR #1065 remains OPEN and draft on remote head `13e6352c`; `origin/main` is `e88a4148`, so the
  required owner rebase has not reached GitHub. Old-head CI, live UAT, Opus QA, and Ben sign-off
  were green/complete, but after rebase fresh CI, fresh live UAT, and fresh integrated Opus QA are
  mandatory before merge. Ben's explicit security-tier merge sign-off is already recorded.
- Exact build owner `UX 993 Host Build R5`, immutable Claude session
  `4cab9e73-55a0-447e-a12f-c5bf8ffd9722`, is live in `~/Jarv1s/.claude/worktrees/ux-993-host-truth`
  on branch `ux/993-host-truth`. It was asked to report exact rebase state/new local head/blocker
  and relay immediately because its pane showed 2% until auto-compaction. Do not merge from the
  predecessor's old-head evidence.
- Successor must adopt delegated authority by replacing only this delegated-lane-owner session
  with its own immutable Codex session id, keep `merges_since_relay: 0`, commit and push, confirm
  it is driving, then fresh-resolve and close only exact old label+session above and rename itself
  `UX Coordinator`. Preserve `.claude/context-meter.log`, `artifacts/`, and
  `webwright-proof-987-v3/` as unrelated worktree changes.
- Mid-doing: answer Ben's all-UX status request from the 9-closed/4-open rollup, then supervise the
  R5 relay/rebase. When a rebased PR head is pushed: prove it contains current `origin/main`, await
  fresh CI green, run fresh live UAT, obtain a fresh posted Opus adversarial QA verdict, re-confirm
  delegated authority, then merge #1065. A security merge immediately triggers another relay.

## Continuation note — 2026-07-15 delegated UX relay after #993 security merge

- Current delegated authority is exact label `UX Coordinator`, immutable Codex session
  `019f66ae-47c6-7c92-a70f-ec41c21336e8`; `merges_since_relay` is `1`. The mandatory security-merge
  relay trigger fired. The separate primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` was never touched.
- PR #1065 merged security-tier as squash `514e9b78b15a3740244e1da30923659988e0aae3`
  from exact head `9976ab6bf7f427d1dd1f6f19a8335a04820a556f`. Fresh CI run `29434389251`
  had all four jobs green. Fresh live UAT is PR comment `issuecomment-4983556472`; fresh Opus
  adversarial QA is GREEN / MERGE-READY YES with zero findings at PR comment
  `issuecomment-4983598111`. Ben's explicit security-tier sign-off was already recorded.
- Issue #993 is closed and its project item is Done. Epic #983 is now 10/13 complete; open work is
  #991 (`needs-spec`, major), #988 (manual acceptance, cosmetic), and #1002 (`needs-spec`, minor).
- Exact build sessions R5, R6, and R7 were reaped after confirmed successors/completion. The remote
  branch `ux/993-host-truth` was deleted. Keep the local worktree
  `~/Jarv1s/.claude/worktrees/ux-993-host-truth`: its local branch is ahead only with relay/proof
  bookkeeping and `.claude/context-meter.log` is modified, so do not remove it blindly.
- Successor must adopt delegated authority by replacing only the delegated-lane-owner session with
  its own immutable Codex session id, reset `merges_since_relay` to `0`, commit and push, confirm it
  is driving, then fresh-resolve and close only old exact label `UX Coordinator` plus session
  `019f66ae-47c6-7c92-a70f-ec41c21336e8`; rename itself `UX Coordinator` afterward. Preserve
  coordinator-worktree changes `.claude/context-meter.log`, `artifacts/`, and
  `webwright-proof-987-v3/`.
- Mid-doing: report the post-merge all-UX rollup (10 closed / 3 open) and continue the remaining
  #983 queue from GitHub source of truth. No active build lane remains from #993.

## Continuation note — 2026-07-15 delegated UX takeover and #991 recovery

- Delegated authority moved to exact label `UX Coordinator`, immutable Codex session
  `019f66e1-aefb-7df2-b339-c4168d3266c1`, in pushed commit `c7cd7811`; `merges_since_relay` reset
  to `0`. The exact predecessor `UX Coordinator` session
  `019f66ae-47c6-7c92-a70f-ec41c21336e8` was fresh-resolved and closed. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched.
- GitHub source of truth confirms epic #983 is 10/13 complete. Open: #991 (`needs-spec`, major,
  but approved spec/plan and draft PR #1050 already exist), #988 (manual acceptance, cosmetic),
  and #1002 (`needs-spec`, minor).
- Recovered #991 in existing isolated worktree
  `~/Jarv1s/.claude/worktrees/ux-991-assistant-priorities-build`, branch
  `ux/991-assistant-priorities-build`. Exact build label `UX 991 Repair R1`, immutable Codex
  session `019f66e5-e89e-71d2-b6d6-7366bcd7aba7`, Luna/medium. It is root-causing the live-path
  blocker from PR #1050: authenticated `POST /api/me/persona/preview` returned HTTP 503 at head
  `8a976ecd5621f5ed141832a801d32231eb181a6f`.
- Latest `main` CI run `29437600439` is still in progress. Do not spawn the new #1002 planning
  worktree until `main` is verified green. #988 remains the closing manual walkthrough after the
  implementation queue lands.
- #991 root cause is fixed and pushed to draft PR #1050 at exact head
  `2277005da0e0e076687f99c1f0c7abb4bf9a376b`: socket chat selected `ChatEngineRpcClient`, while
  persona preview used an unresolved host fallback whose error became HTTP 503. The two-file fix
  routes socket preview through the adopted RPC connection and adds one transport-selection
  regression assertion. A late full-gate result invalidated the agent's initial green report:
  TypeScript found `chatEngineFactory` used before assignment. Obsolete head `2277005d` and failed
  CI run `29438363551` are not releasable. Corrected exact head
  `11bdd2efea7885a35e81625107bab5957651e0c9` moves preview-factory creation below chat-factory
  initialization; the full local foundation gate is green (3,318 unit and 1,646 integration tests
  passed). Fresh CI run `29439577353` is in progress; fresh exact-head UAT remains required.
  GitHub's stale `needs-spec` label was removed from #991 because spec/plan PR #1046 is merged.
- Latest `main` CI run `29437600439` completed green. #1002 docs-only planning is active in
  isolated worktree `~/Jarv1s/.claude/worktrees/plan-1002-coming-soon`, branch
  `plan/ux-1002-coming-soon`, exact label `UX 1002 Plan R1`, immutable Codex session
  `019f66fc-934d-74b3-958c-cb85044eedc5`, Sol/high. It may inventory promises, map live GitHub
  trackers, and write a spec/plan; it may not implement product code or mutate GitHub issues.
- #1002 opened draft docs-only PR #1066. Independent plan review on head `cd29de42` returned RED:
  trailing whitespace, missing live collision with PR #1050 on
  `packages/settings-ui/src/index.tsx`, missing per-slice mechanical risk tiers, and the spent
  coordinator handoff included in the deliverable. The coordinator removed its handoff artifact
  in head `98c9a442`; `UX 1002 Plan R1` is fixing only the spec/plan before re-review.
- #1002 PR #1066 re-review is GREEN / APPROVED at exact head
  `16c0e9db4b9e71f1601858036f92265a198eedf4`, with no blockers. Durable approval is PR comment
  `issuecomment-4984058639`. The PR now contains only the spec and plan. Exact-head CI run
  `29440980203` has one failed `Compose deployment smoke`; Prod smoke is green and foundation is
  still running. The lane is stop-the-line while its owner diagnoses the raw failure; one proven
  transient may be rerun once, while a second failure requires an issue/escalation. Independent
  docs QA also remains before merge. No #1002 implementation lane has spawned.
- #991 corrected-head CI run `29439577353` completed all four jobs green at exact head
  `11bdd2efea7885a35e81625107bab5957651e0c9`, including published image. `UX 991 Repair R1` is
  running fresh authenticated desktop+narrow live UAT; independent sensitive-tier QA is active in
  parallel. Merge remains blocked until both durable verdicts are green.
- #991 live UAT initially blocked before provisioning because PR CI intentionally builds with
  registry push disabled; tags `live-1050-11bdd2ef` and `pr-29439577353` therefore returned
  `manifest unknown`. No stale image or evidence was used. The owner is building the exact clean
  head locally with tag `ghcr.io/motioneso/jarv1s:live-1050-11bdd2ef`, verifying SHA/digest, and
  will run isolated Compose with pull disabled.
- Independent sensitive QA for #1050 is RED / MERGE-READY NO at PR comment
  `issuecomment-4984186831`: preview bypasses the per-user effective chat-model override, required
  transport/UI contract tests and live+narrow proof are missing, and the spent coordination
  handoff remains in the PR. UAT/image work stopped; old `UX 991 Repair R1` is closed with no live
  build process. Fresh exact label `UX 991 Repair R2`, immutable Codex session
  `019f671e-1efe-7220-9638-8c761370f975`, Luna/medium, is preparing a repair plan. Coordinator will
  remove the handoff artifact after the code/test repair.
- #991 R2 repair plan is approved: use canonical effective per-user chat-model selection in the
  shared preview helper, preserve CLI/API transport and no-thread semantics, and add the focused
  preview/priority UI contracts QA required. No implementation fork remains; fresh CI/UAT follows
  the new head.
- #1002 exact-head CI run `29440980203` attempt 2 is fully green; the one permitted retry of the
  diagnosed Compose startup-timing flake passed. Final independent routine docs QA is active on
  head `16c0e9db4b9e71f1601858036f92265a198eedf4`.
- #1002 docs-only PR #1066 merged routine-tier as squash
  `e9c6d165626d7f3fd1cb7448a9faffe710dc4f9e` after GREEN independent QA at PR comment
  `issuecomment-4984279796`. Issue #1002 remains open, its stale `needs-spec` label is removed, and
  its project item is `In progress`; no implementation has merged. `merges_since_relay` is now
  `1`.
- #1002 G1 coordinator inventory is complete at issue comment `issuecomment-4984328581`: created
  #1069 (safe instance export) and #1070 (backup status/PITR), reopened and updated #743 (Web Push),
  verified #1061 unchanged, and linked all four as native #1002 sub-issues. `UX 1002 Plan R1` was
  reaped; its worktree and local/remote branch are removed. Approved plan hard-gates all
  implementation spawns until #1050 resolves; G2 is first afterward.
- #991 R2 repaired effective per-user preview routing and focused contracts in code head
  `50460c284d435f8b2898c7f3a53b5fe5f2d96548`; full local foundation is green (3,323 unit and
  1,646 integration tests passed, 155 migrations current). The coordinator removed the spent
  handoff without product changes. Final PR #1050 head is
  `da66a101a46e8d9349b7277ec5778eb3ecf57b29`; no `docs/coordination/` file remains and fresh CI
  run `29443722846` is fully green. Fresh sensitive QA and exact local-image authenticated UAT are
  active on this head; merge remains blocked until both durable verdicts are green.
- #991 independent sensitive QA cycle 2 is RED / MERGE-READY NO at PR comment
  `issuecomment-4984705427`: YOLO copy reports enabled when the user preference is off, required
  interactive Priority UI contract tests remain absent, and head-specific live desktop+narrow
  proof is not posted. The exact local image `live-1050-da66a101` was built, but UAT never started
  and no evidence was claimed. Two failed QA cycles exhaust the lane failure budget; `UX 991
  Repair R2` is closed, the worktree is clean at head `da66a101`, and the lane is stopped pending
  Ben's direction. #1002 G2 and #988 remain hard-gated behind #1050.
- Ben explicitly authorized a third #1050 repair cycle. Fresh exact label `UX 991 Repair R3`,
  immutable Codex session `019f6777-ff1f-7f31-b480-3d1350f649b1`, Luna/medium, is active in the
  existing isolated worktree. Local handoff commit `61c1a50b` is intentionally unpushed to avoid a
  handoff-only CI run; the coordinator will remove it before final review. R3 must plan before
  editing and is limited to truthful YOLO copy plus focused interactive Priority UI contracts.

## Continuation note — 2026-07-15 authorized #1050 cycle 3 and coordinator relay

- Current delegated authority is exact label `UX Coordinator`, immutable Codex session
  `019f677a-ccef-78f0-bc91-5be4cc725c16`; `merges_since_relay` is `1`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched.
- #1050 merged as `448ebe2ff8b833dede98be182823c932e2645694` from exact head
  `dc6e3e949c861848d7800f0b45a976546001c2ad`. Exact-head CI run `29450028462` is fully green;
  independent sensitive QA is GREEN at `issuecomment-4985458321`; authenticated desktop+narrow
  live proof is GREEN at `issuecomment-4985626291`, with immutable evidence commit `30d25970`.
- `UX 991 Repair R3` session `019f6777-ff1f-7f31-b480-3d1350f649b1` is reaped. Its isolated
  worktree, local/remote branch, UAT stack, volumes, and test image are removed.
- The cycle-3 handoff was removed in `dc6e3e94` before final CI/QA/UAT. Issue #991 is closed and
  Done on both project boards.
- #1002 docs/plan PR #1066 already merged as `e9c6d165626d7f3fd1cb7448a9faffe710dc4f9e`.
  G1 tracker inventory is complete at `issuecomment-4984328581`; #1050 has released the approved
  G2 gate. #1002 remains open for G2 and #988 remains the closing manual acceptance pass. Epic
  #983 is 11 closed / 2 open (#988, #1002).
- Delegated adoption is complete: exact label `UX Coordinator` resolves only to session
  `019f677a-ccef-78f0-bc91-5be4cc725c16`; old session `019f66e1-aefb-7df2-b339-c4168d3266c1`
  is closed. Preserve `.claude/context-meter.log`, unrelated `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-15 #1002 G2 ready; compaction relay required

- Current delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` is `0`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` is out of scope and must remain untouched.
- The coordinate compaction tripwire fired before #1002 was spawned. Merge nothing in this
  session; relay delegated UX authority to a fresh full-access Codex coordinator in the same
  coordinator tab, replace only this delegated UX lock with its immutable session id, reset
  `merges_since_relay` to `0`, commit/push, confirm driving, then close this exact old session.
- #1002 approved G2 lane is ready at `~/Jarv1s/.claude/worktrees/ux-1002-coming-soon-build`,
  branch `ux/1002-coming-soon-build`, base `bcdebe01`. The committed and pushed handoff is
  `docs/coordination/handoff-1002-coming-soon-g2.md` at `a65a1c9a`; no build agent has been
  spawned yet.
- Next: spawn exact label `UX 1002 Coming Soon` in agents tab `w1:t26` with Sonnet, require
  `coordinated-build`, approve only Tasks 2–5, and supervise through exact-head CI, sensitive QA,
  authenticated desktop+narrow live UAT, coordinator Task 8 inventory reconciliation, merge,
  and cleanup. Then run #988 strictly last.
- Preserve unrelated `.claude/context-meter.log`, prior `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-15 #1077 Task 4 hash correction

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Merge order remains #1077 security QA + Ben sign-off + merge; repeat #1002 exact-head live export
  UAT; reconcile Task 8; merge #1075; clean up; start #988 strictly last. Newly offered review lanes
  E/F/G are deferred so they do not disrupt this locked order.
- #1077 branch `ux/1077-export-grants` reached pushed head `ef2989a8`. Unit verification was GREEN
  (3376 tests), but `verify:foundation` stopped in `db:migrate`: migration
  `0166_worker_notification_reads_grant.sql` changed after application because `ef2989a8` added a
  policy comment to that already-applied file. No PR exists yet; `audit:release-hardening` has not
  run.
- R11 was reaped after its read-only diagnosis. Fresh low-effort Sonnet successor exact label
  `UX 1077 Export Grants R12`, immutable session `780ff9e1-45a2-4f80-b75e-69093fdb8289`, is driving
  in the same worktree `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`. It is restoring 0166
  byte-for-byte, moving the required comment into a newly numbered append-only migration, updating
  inventory/tests as needed, then running full `verify:foundation`, `audit:release-hardening`, and
  coordinated wrap-up if green. Preserve unrelated `.claude/context-meter.log`; task_activity and
  failure-handler findings remain deferred.

## Continuation note — 2026-07-16 #1077 PR 1092 security QA

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Merge order remains #1077 security QA + Ben sign-off + merge; repeat #1002 exact-head live export
  UAT; reconcile Task 8; merge #1075; clean up; start #988 strictly last. Review lanes E/F/G remain
  parked by the primary coordinator pending Ben; they do not overlap this run.
- #1077 is code-complete at pushed head `41110856`; PR #1092 is open. R12 restored migration 0166
  byte-for-byte and moved the policy comment into append-only migration 0170 with the inventory
  updated. `verify:foundation` exited 0 (410 unit files/3376 tests; 156 integration files/1669 tests)
  and `audit:release-hardening` exited 0. Branch is up to date with `origin/main`. Deferred findings
  remain the pre-existing `task_activity` cross-user read gap and failure-handler hardening.
- Build agent exact label `UX 1077 Export Grants R12`, session
  `780ff9e1-45a2-4f80-b75e-69093fdb8289`, is done in
  `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`. Isolated Opus security QA exact label
  `UX QA 1077 PR1092`, session `457c9b71-b292-42ff-bd99-c13a2321cf73`, is reviewing PR #1092 in
  `/tmp/jarv1s-qa-1092`. It must post a durable PR verdict. GREEN still requires Ben's explicit
  security-tier merge sign-off; do not merge before that approval.

## Continuation note — 2026-07-16 #1077 awaiting security merge sign-off

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- PR #1092 is code-complete at reviewed head `41110856`. Local author gates were GREEN:
  `verify:foundation=0` (3376 unit tests, 1669 integration tests) and
  `audit:release-hardening=0`. All four GitHub checks are GREEN: Verify foundation and app, Build
  and publish image, Compose deployment smoke, and Prod compose deployment smoke.
- Independent Opus security QA is GREEN with zero blocking findings. It confirmed SELECT-only
  worker grants, no writes or BYPASSRLS, byte-identical owner predicates, unchanged app-runtime
  behavior, append-only migration handling, and met exit criteria. Durable verdict:
  `https://github.com/motioneso/Jarv1s/pull/1092#issuecomment-4989571684`. Three non-blocking notes
  concern wording/direct negative coverage only. QA pane/session was reaped and its isolated
  `/tmp/jarv1s-qa-1092` worktree removed.
- STOP: #1092 is security-tier and now awaits Ben's explicit merge sign-off. Do not merge on the
  green evidence alone. After explicit approval, re-confirm the delegated coordinator session-id
  lock, merge #1092, increment `merges_since_relay`, flush the manifest, and relay immediately
  because every security-tier merge triggers mandatory coordinator relay. The successor then
  repeats #1002 exact-head real-export UAT before any #1075 merge; #988 remains strictly last.

## Continuation note — 2026-07-15 #1002 sensitive QA running

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` is `0`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains out of scope and untouched.
- PR #1075 exact head `6cbb4955` has all CI checks green: compose smoke, prod compose smoke,
  foundation/app, and image publication.
- Sensitive QA is `reviewing` in fresh detached worktree `~/Jarv1s/.claude/worktrees/qa-1075-1002`:
  exact label `QA UX 1002 PR1075`, immutable Claude session
  `02cdfc92-94dc-4c02-a52f-cd5d3b7262c7`; Sonnet and bypass permissions verified.
- Build owner remains exact label `UX 1002 Coming Soon R2`, immutable Claude session
  `9ddb3be3-7ba8-4fd5-80bd-308226cd7046`, retained for any QA fixes.
- Next: consume compact QA verdict only. If green, complete authenticated desktop+narrow live UAT,
  Task 8 inventory reconciliation, merge/close/cleanup, then and only then begin #988.
- Preserve unrelated `.claude/context-meter.log`, prior `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-15 #1002 PR open; exact-head CI pending

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` is `0`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains out of scope and untouched.
- #1002 Tasks 2–5 are code-complete at exact head `6cbb4955` on PR #1075
  (`ux/1002-coming-soon-build`). Builder-reported unmasked `VF_EXIT=0`, `AUDIT_EXIT=0`, focused
  unit/E2E green, and clean rebase on `origin/main` `bcdebe01`.
- Exact-head CI is pending. Sensitive independent QA has not started; authenticated desktop+narrow
  live UAT and Task 8 inventory reconciliation remain coordinator-owned hard gates.
- Build owner remains exact label `UX 1002 Coming Soon R2`, immutable Claude session
  `9ddb3be3-7ba8-4fd5-80bd-308226cd7046`, retained for any QA fixes.
- Next: wait for PR #1075 CI green, run fresh sensitive QA, record authenticated desktop+narrow
  live proof on the PR, reconcile Task 8, merge/close/cleanup, then and only then begin #988.
- Preserve unrelated `.claude/context-meter.log`, prior `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-15 #1002 build relay R2 driving

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` is `0`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains out of scope and untouched.
- #1002 is `building`: exact label `UX 1002 Coming Soon R2`, immutable Claude session
  `9ddb3be3-7ba8-4fd5-80bd-308226cd7046`, branch `ux/1002-coming-soon-build`, same isolated
  worktree. Sonnet and bypass permissions verified; original build session was reaped.
- Task 2 landed on the lane at `2f7f2bd4`; Task 3 is in flight from two red TDD assertions;
  Tasks 4–5 remain. Relay continuation is
  `docs/superpowers/handoffs/2026-07-15-1002-coming-soon-relay.md` at `d2348afb`.
- Next: finish Tasks 3–5, exact-head CI, sensitive QA, authenticated desktop+narrow live UAT,
  Task 8 inventory reconciliation, merge, and cleanup. #988 stays strictly serialized.
- Preserve unrelated `.claude/context-meter.log`, prior `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-15 #1002 build agent spawned

- Delegated authority: exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` is `0`. Primary `Coordinator`
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains out of scope and untouched.
- PR #1075 is code-complete at exact head `6cbb4955`; CI and independent sensitive QA are GREEN.
  Exact-head live UAT is RED only on the real personal export checkpoint. Evidence and verdict are
  posted on PR #1075; do not merge it until blocker #1077 lands and the export UAT repeats green.
- Ben approved #1077's audit-all scope. Full audit found exactly four gaps and 34 covered tables.
  Security build lane relayed to low-effort Sonnet label `UX 1077 Export Grants R11`, session
  `f7d3daa9-333d-472e-9386-845a57bec574`, branch `ux/1077-export-grants`, worktree
  `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`, committed audit handoff `5fa0443c`. Sonnet 5
  and bypass permissions verified. Minimal four-task TDD plan approved and committed at
  `7c93e676`: red populated-all-tables export + negative write/policy tests; module-local
  SELECT-only migrations for four confirmed gaps; migration inventory; focused/full gates and
  wrap-up. Task 1 RED is `fc93ab4a`; Task 2 migrations + focused GREEN are `82d5372b` (3/3 pass,
  SELECT-only, no BYPASSRLS). Task 3 migration inventory is `5d5e69b5`; R9 is fixing focused
  format/type residue and clean rebase are at pushed head `4bc49def`. Full verify then found three
  stale security expectations: AI/Notifications hard-coded no worker SELECT, plus the new
  notification-read policy lacked its defense-in-depth comment. The three approved residue edits
  passed focused AI/Notifications verification (47/47) and are pushed at `ef2989a8`; R11 is
  repeating full gates and opening the PR. Defer failure-handler
  hardening and the unrelated `task_activity` RLS gap.
- Merge order: #1077 security QA + Ben sign-off + merge; repeat #1002 live export UAT; reconcile
  Task 8; merge #1075; clean up; start #988 strictly last.
- Preserve unrelated `.claude/context-meter.log`, prior `artifacts/`, and
  `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #1077 approval received; current-main rebase required

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Ben explicitly approved merging security-tier PR #1092. Pre-merge authority and CI checks were
  valid, but the merge stopped before mutation because fresh `origin/main` is no longer an ancestor
  of reviewed head `41110856`. Do not merge the stale reviewed head.
- PR #1092 previously passed all four CI checks and Opus security QA with zero blockers; durable
  verdict: `https://github.com/motioneso/Jarv1s/pull/1092#issuecomment-4989571684`. Local author
  gates also passed (`verify:foundation=0`, `audit:release-hardening=0`). The approval must be
  re-presented against the new integrated head after rebase, fresh CI, and fresh Opus security QA.
- Owning Sonnet agent exact label `UX 1077 Export Grants R12`, immutable session
  `780ff9e1-45a2-4f80-b75e-69093fdb8289`, is rebasing branch `ux/1077-export-grants` in
  `~/Jarv1s/.claude/worktrees/ux-1077-export-grants` onto current `origin/main`, then force-pushing
  with lease and reporting the exact new head/conflict status. Preserve unrelated
  `.claude/context-meter.log`; no scope broadening.
- After rebase: wait for all required CI checks, run fresh isolated Opus security QA on the new
  head, and request Ben's explicit merge sign-off again. Once merged, increment
  `merges_since_relay`, flush this manifest, and relay immediately because a security merge is a
  mandatory relay trigger. The successor repeats #1002 exact-head real-export UAT before merging
  #1075; #988 remains strictly last. Review lanes E/F/G stay parked outside this run.

## Continuation note — 2026-07-16 #1077 rebased; fresh CI pending

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- PR #1092 cleanly rebased onto `origin/main` `95b61381` with zero conflicts and no product edits;
  new exact head is `a523e67c`. Branch is force-pushed with lease and GitHub reports MERGEABLE.
- The owning agent's new local `test:uat-seed` step hit three shared dev-DB pollution failures
  matching the known #1087 persistent-database trap; it did not destroy the shared DB. Branch-owned
  lint/format/typecheck/unit/migration checks remain green. Fresh GitHub CI on an isolated database
  is the authoritative integrated gate and is currently pending.
- After all required CI is GREEN, spawn a fresh isolated Opus security QA on exact head `a523e67c`.
  Ben's earlier approval covered stale head `41110856`; request explicit security-tier sign-off
  again against the new head and fresh verdict. On merge, increment `merges_since_relay`, flush,
  and relay immediately. Then repeat #1002 exact-head real-export UAT before #1075; #988 strictly
  last. Preserve `.claude/context-meter.log`, existing artifacts, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #1077 integrated Opus QA R2

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- PR #1092 exact rebased head `a523e67c` is current-main integrated and MERGEABLE. All four fresh
  CI checks are GREEN: Verify foundation and app (20m06s), Build and publish image (13m59s),
  Compose deployment smoke (3m31s), and Prod compose deployment smoke (2m00s). This confirms the
  owning agent's local UAT-seed failures were shared persistent-dev-DB pollution, not branch drift.
- Fresh isolated Opus security QA exact label `UX QA 1077 PR1092 R2`, immutable session
  `a53ed509-d247-42ca-bf63-310f9fe74c90`, is reviewing exact head `a523e67c` in
  `/tmp/jarv1s-qa-1092-r2`. It must post a new durable PR verdict. After GREEN, ask Ben for explicit
  security-tier sign-off again; do not merge on his approval of stale head `41110856`.
- On approved merge: re-confirm the delegated lock, merge #1092, increment `merges_since_relay`,
  flush this manifest, and relay immediately. Successor repeats #1002 exact-head real-export UAT
  before #1075; #988 remains strictly last. Preserve unrelated worktree changes and artifacts.

## Continuation note — 2026-07-16 #1077 rebased head awaiting renewed sign-off

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`; `merges_since_relay` remains `0`. Never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Security-tier PR #1092 is MERGEABLE at current-main-integrated exact head `a523e67c`. All four
  fresh required CI checks are GREEN. Fresh Opus security QA R2 is GREEN and MERGE-READY with zero
  blockers; durable verdict:
  `https://github.com/motioneso/Jarv1s/pull/1092#issuecomment-4994868149`.
- QA reconfirmed byte-exact owner predicates for all four worker SELECT policies, SELECT-only
  grants, untouched write policies, exhaustive 38-table coverage, no secret leak, runtime
  write-denial/policy-exactness tests, and append-only migrations 0166-0170. Its sole non-blocking
  note is that real 38-table export completion remains the already-planned live UAT after #1077.
- STOP: Ben's prior approval covered stale head `41110856`. Await renewed explicit security-tier
  merge sign-off for exact head `a523e67c`; do not merge before it. After approval, re-confirm the
  delegated lock, merge #1092, increment `merges_since_relay`, flush, and relay immediately.
  Successor repeats #1002 exact-head real-export UAT before #1075; #988 remains strictly last.
- QA R2 pane/session was reaped and isolated `/tmp/jarv1s-qa-1092-r2` removed. Preserve unrelated
  `.claude/context-meter.log`, existing artifacts, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #1077 merged; mandatory security relay

- Delegated authority is exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` is `0` after
  successor adoption.
- Ben explicitly approved rebased exact head `a523e67c`; fresh Opus QA R2 was GREEN/MERGE-READY
  with zero blockers and all four required CI checks were GREEN. PR #1092 merged at
  `2026-07-16T18:07:05Z` as squash commit `0ef20ff7bf68c0f27ed5a710613563c66bfb4663`.
- `gh pr merge --delete-branch` reported only that the local branch could not be deleted because
  worktree `~/Jarv1s/.claude/worktrees/ux-1077-export-grants` still uses it; the PR itself is
  confirmed MERGED. Owning build agent exact label `UX 1077 Export Grants R12`, session
  `780ff9e1-45a2-4f80-b75e-69093fdb8289`, is idle there. Successor must fresh-resolve and reap that
  exact agent, remove the worktree, prune, then reconcile #1077 issue/board bookkeeping from live
  GitHub state. Preserve its unrelated `.claude/context-meter.log`.
- IMMEDIATE next product action after successor adoption: repeat #1002 real personal-export UAT on
  PR #1075 exact head `6cbb4955`, proving the export completes with the landed grants. Then
  reconcile #1002 Task 8 and merge #1075 only if all live-path gates are GREEN. Start #988 strictly
  last. Review lanes E/F/G remain parked outside this run.
- Successor adoption protocol: from a fresh Herdr pane list, replace only the delegated UX lock
  session with the successor's immutable session id, reset `merges_since_relay` to `0`, commit and
  push, confirm driving, then fresh-resolve and close only old exact label `UX Coordinator` plus
  session `019f68a1-899f-7cc1-bba5-2159ae14aaed`, and rename itself `UX Coordinator`. Never touch
  primary Coordinator session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Preserve unrelated coordinator worktree changes: `.claude/context-meter.log`, existing
  `artifacts/`, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #1002/#1075 complete; #988 strictly last

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` is now `1`
  after the sensitive #1075 merge; the next routine/sensitive merge fires the two-merge relay.
- #1077 cleanup is complete: exact builder session `780ff9e1-45a2-4f80-b75e-69093fdb8289`
  was reaped, its worktree removed/pruned, its context-meter change preserved in a named stash,
  issue #1077 closed completed, and its project item moved to Done.
- PR #1075 exact head `6cbb49559d9fa8138fa8badbb043db708eb2c78d` passed the repeated real
  personal-export UAT after landed #1092 migrations: real owner signup/sign-in, visible Ready and
  Download, `export.build=completed`, and no permission-denied/25P02 runtime-log match. Durable
  GREEN proof is PR comment `#issuecomment-4995257466`; the isolated stack was fully torn down.
- #1002 Task 8 was reconciled from live GitHub. PR #1075 merged at `2026-07-16T18:28:39Z` as
  squash commit `a0887ead0395936b6bab1bf8759f9497612185a5`; issue #1002 is closed completed and its
  project item is Done. The merged builder worktree was removed/pruned and its context-meter
  change preserved in a named stash. Keep the detached UAT evidence worktree intact because the
  durable PR comment points to its proof.
- NEXT and strictly last product lane: start #988. Review lanes E/F/G remain parked outside this
  run. Preserve unrelated coordinator changes: `.claude/context-meter.log`, existing `artifacts/`,
  and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 final lane started in planning

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` remains `1`.
- #988 is strictly last and is now In progress on the live project board. It has no approved spec
  and is labeled `manual-acceptance`, so no builder was spawned. After main CI run `29524092201`
  completed GREEN, a planning-only Codex agent started in the isolated agents tab: exact label
  `UX 988 Closing Plan`, immutable session `019f6c50-8682-7ab1-908c-3ade542a8449`, branch
  `plan/988-closing-acceptance`, worktree `~/Jarv1s/.claude/worktrees/plan-988-closing-acceptance`.
- The agent runs `gpt-5.6-sol` at high reasoning. Its committed handoff forbids feature code,
  merges, issue/project mutations, and coordination-manifest edits; it must draft the #988 spec
  candidate plus executable acceptance plan, push a draft PR, and return explicit approval
  questions. No #988 implementation may start until Ben approves that spec.
- Review lanes E/F/G remain parked. Preserve unrelated coordinator changes:
  `.claude/context-meter.log`, existing `artifacts/`, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 planning complete; awaiting Ben decisions

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` remains `1`.
- Planning-only draft PR #1111 is open at exact head
  `b312aba5403b0f881f824f8d9606d2840ccf0acf`. It adds the #988 spec candidate and executable
  acceptance plan, separates conditional Today/Appearance polish from already-landed verification,
  and reuses the existing prod-shaped UAT provisioner plus Webwright evidence contract. No feature
  code, issue movement, or merge is included. The completed planning session
  `019f6c50-8682-7ab1-908c-3ade542a8449` was reaped; retain its clean worktree/branch for review.
- #988 implementation is PAUSED pending two explicit Ben approvals: (1) Today removes proactive
  priority-band badges and task-row raw due dates while retaining ordering, priority stripe, drift
  state, source, and task detail; (2) built-in Forest/Sage/Canyon/Teal/Dusk themes gain independent
  light/dark mode, legacy Dark normalizes to Forest+dark, and custom themes remain fixed-palette in
  this slice. Do not spawn implementation before both decisions and spec approval.
- Review lanes E/F/G remain parked. Preserve unrelated coordinator changes:
  `.claude/context-meter.log`, existing `artifacts/`, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 Appearance approved; Today decision pending

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` remains `1`.
- Ben approved D2: Forest, Sage, Canyon, Teal, and Dusk remain independently selectable accent/color
  themes while light/dark becomes a separate per-account mode toggle. Legacy Dark normalizes to
  Forest + dark. Existing custom themes remain fixed-palette for this slice as proposed.
- Draft PR #1111 now records that decision and the concrete D1 explanation at exact head
  `d440f5b8efb1db8d7c13799ac078b3cd5e3d4306`; durable decision comment:
  `https://github.com/motioneso/Jarv1s/pull/1111#issuecomment-4995710106`.
- D1 remains unresolved. The “priority-band badge” is the proactive-card pill that literally shows
  `critical`, `high`, `normal`, or `low`; it is not the priority stripe or ordering. The bundled
  task-row removal is the short due date such as `Jul 18`. No #988 implementation may start until
  Ben resolves D1 and approves the overall spec.
- Review lanes E/F/G remain parked. Preserve unrelated coordinator changes:
  `.claude/context-meter.log`, existing `artifacts/`, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 Today pill removal approved

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` remains `1`.
- Ben approved D1a: remove the proactive-card `critical` / `high` / `normal` / `low` pill as
  duplicate clutter. Preserve ordering, priority stripe, source, summary/detail, and dismiss
  behavior. This does not authorize removing Today task-row short dates.
- Draft PR #1111 records the split decision at exact head
  `c7e08f6f1083db1c298ba2bdb6da7956e0e3c479`; durable decision comment:
  `https://github.com/motioneso/Jarv1s/pull/1111#issuecomment-4995890717`.
- #988 implementation remains paused pending D1b (task-row short-date choice) and overall spec
  approval. Review lanes E/F/G remain parked. Preserve unrelated `.claude/context-meter.log`,
  existing `artifacts/`, and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 D1/D2 resolved; overall spec approval pending

- Delegated authority remains exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched. `merges_since_relay` remains `1`.
- Ben resolved D1: remove only the proactive-card `critical` / `high` / `normal` / `low` pill as
  duplicate clutter; keep Today task-row short dates and require them to render in the user's
  persisted timezone. Existing code already uses `useUserLocale()` → `shortDate(..., locale)` →
  shared `formatInZone(..., locale.timezone)`, so the plan preserves that path and adds only a
  timezone-boundary regression check.
- Draft PR #1111 records resolved D1 and D2 at exact head
  `3b8dedad1e75e7a5d7b7728cf042668633820cf1`; durable decision comment:
  `https://github.com/motioneso/Jarv1s/pull/1111#issuecomment-4995914596`.
- #988 implementation remains paused pending Ben's approval of the overall candidate spec. Review
  lanes E/F/G remain parked. Preserve unrelated `.claude/context-meter.log`, existing `artifacts/`,
  and `webwright-proof-987-v3/`.

## Continuation note — 2026-07-16 #988 approved; mandatory coordinator relay before dispatch

- Delegated authority is exact label `UX Coordinator`, immutable Codex session
  `019f6c1d-6044-7d51-8473-3e469192b324`. Primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains protected and untouched.
  `merges_since_relay` remains `1`.
- Ben explicitly approved the overall #988 candidate spec and plan with “yep kick it.” D1 and D2
  remain locked as recorded at draft PR #1111 exact head
  `3b8dedad1e75e7a5d7b7728cf042668633820cf1`: remove only the proactive priority-band pill; keep
  timezone-correct Today short dates; implement independent built-in accent and light/dark mode;
  keep existing custom themes fixed-palette for this slice.
- The current coordinator then invoked `coordinate` and hit its non-negotiable compaction tripwire.
  It must merge nothing and spawn no builder before relaying. This note is the durable approval;
  unrelated coordinator changes remain preserved.
- Successor first actions: adopt delegated authority and reap only old exact label `UX Coordinator`
  plus session `019f6c1d-6044-7d51-8473-3e469192b324`; publish the overall approval durably on PR
  #1111; confirm exact-head CI/review/mergeability; land the planning-only PR when green; update
  `origin/main`; then create one isolated routine implementation lane for approved Tasks 1–2 plus
  the existing acceptance Tasks 3–6. Preserve review lanes E/F/G and never touch primary
  `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.

## Continuation note — 2026-07-16 delegated UX Coordinator adoption

- Codex session `019f6c76-593d-7fd2-b33d-78bd72045265` adopted delegated-lane authority under
  temporary label `UX Coordinator successor`; `merges_since_relay` reset to `0`. A fresh Herdr
  pane list matched outgoing exact label `UX Coordinator` plus session
  `019f6c1d-6044-7d51-8473-3e469192b324` and protected primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`. Commit/push and driving confirmation precede exact
  outgoing-session closure and successor rename.
- Approved #988 first actions remain: publish approval on PR #1111, verify exact-head
  CI/review/mergeability, merge the planning-only PR when green, update `origin/main`, then create
  one isolated routine implementation lane for approved Tasks 1–2 plus acceptance Tasks 3–6.
  Review lanes E/F/G remain parked and unrelated changes remain preserved.

## Continuation note — 2026-07-16 delegated takeover complete

- Pushed adoption commit `9d712235`, then fresh-resolved and closed only outgoing exact label
  `UX Coordinator` plus session `019f6c1d-6044-7d51-8473-3e469192b324`. Successor Codex session
  `019f6c76-593d-7fd2-b33d-78bd72045265` is the sole exact `UX Coordinator` and is driving.
  Primary `Coordinator` session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains live and
  untouched. `merges_since_relay` remains `0`.
- Execute approved #988 first actions from the preceding continuation; review lanes E/F/G remain
  parked and unrelated working-tree changes remain preserved.

## Continuation note — 2026-07-16 #1111 approval published; exact-head CI blocked

- Published Ben's overall #988 approval on planning PR #1111 at exact head
  `3b8dedad1e75e7a5d7b7728cf042668633820cf1` (comment `4995958511`). D1/D2 remain locked exactly
  as approved. PR metadata is mergeable but still draft/unstable with no review decision.
- Exact-head CI has green compose and production-compose deployment smokes but failed
  `Verify foundation and app`. Per stop-the-line policy, do not merge or dispatch implementation
  until fixed and freshly green.
- Read-only diagnostic lane `UX 988 Plan CI`, Codex session
  `019f6c7b-67d1-7ae1-9c36-f8c18db171a7`, is working in the existing isolated planning worktree
  on `gpt-5.6-sol` high. It must return only root cause plus a focused fix plan before any edit.
  Review lanes E/F/G and unrelated working-tree changes remain untouched;
  `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 #1111 CI root cause confirmed

- Exact-head `Verify foundation and app` fails only at `pnpm format:check`: repo-pinned Prettier
  rejects `docs/superpowers/plans/2026-07-16-988-closing-acceptance.md`. This is deterministic and
  PR-local, not a flaky service or test failure.
- Focused fix awaiting explicit approval: run the repo-pinned Prettier writer on only that plan
  file, review the one-file formatting-only diff, run the focused Prettier check and relevant
  foundation gate if available, commit/push only that file, then confirm fresh exact-head CI.
- Diagnostic lane `UX 988 Plan CI`, Codex session
  `019f6c7b-67d1-7ae1-9c36-f8c18db171a7`, is done and parked. No implementation lane may dispatch
  and PR #1111 may not merge before approval plus fresh green gates. Review lanes E/F/G and
  unrelated changes remain untouched; `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 standing coordinator approval delegated

- Ben approved the focused one-file #1111 formatting fix and clarified that routine in-scope
  fixes and implementation decisions do not require separate approval. Coordinators may approve
  them; escalate only a fundamental product-direction change that would turn Jarvis into a
  different app, while continuing to honor existing hard gates.
- `UX 988 Plan CI`, Codex session `019f6c7b-67d1-7ae1-9c36-f8c18db171a7`, resumed to format only
  `docs/superpowers/plans/2026-07-16-988-closing-acceptance.md`, verify, commit/push only that file,
  and report the new exact head plus CI state. Review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 #1111 exact-head CI green; independent QA running

- Focused formatting commit `89f392f5dc521a4184f1e7e08d4482d2388b4da4` changed only
  `docs/superpowers/plans/2026-07-16-988-closing-acceptance.md`; its planning worktree is clean.
  Exact-head CI run `29530451255` is fully green: foundation/app, both compose smokes, Playwright
  smoke, and image build. The spent fixer session was exact-resolved and reaped.
- Fresh detached routine QA lane `QA 1111 Routine`, Codex session
  `019f6c9b-0808-7681-b759-ea276a7dba6d`, is reviewing the planning diff at exact head on
  `gpt-5.6-luna` medium. It must post a compact verdict to PR #1111 and report to `UX Coordinator`;
  no edits or merge authority.
- PR #1111 remains unmerged pending independent QA and final exact-head mergeability/session-lock
  checks. Review lanes E/F/G and unrelated changes remain untouched; `merges_since_relay` remains
  `0`.

## Continuation note — 2026-07-16 #1111 merged; #988 implementation dispatched

- Routine QA verdict for PR #1111 was GREEN/merge-ready with zero findings and is durable at PR
  comment `4996266744`. After fresh lock, exact-head, current-main, CI, and mergeability checks,
  planning-only PR #1111 merged as `1ca37063c5d966fd2a90c70575ebcaf5d1e788fe`.
- QA and planning worktrees/panes were clean and reaped. `origin/main` now includes #1111.
  `merges_since_relay` is `1`; no relay trigger fires until the next routine/sensitive merge.
- Created isolated routine lane `ux/988-closing-acceptance` from current `origin/main`, committed
  implementation handoff `5c9612f1`, and pushed the branch. Build agent `UX 988 Build`, Codex
  session `019f6ca0-5f4f-7401-8d2c-21237850acb5`, is working on `gpt-5.6-luna` medium.
- Scope is approved Tasks 1–2 plus acceptance Tasks 3–6, including required live desktop+narrow
  proof before wrap-up. Review lanes E/F/G, primary `Coordinator` session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`, and unrelated changes remain untouched.

## Continuation note — 2026-07-16 #988 Task 1 plan approved

- Approved the grounded Task 1 plan under standing delegated authority: change only
  `apps/web/src/today/proactive-cards.tsx` to remove the raw priority-band pill while preserving
  stripe/order/source/title/summary/dismiss, plus focused coverage in
  `tests/unit/today-closing-polish.test.tsx` for absent raw priority text and the existing
  persisted-timezone `shortDate` boundary.
- `UX 988 Build` session `019f6ca0-5f4f-7401-8d2c-21237850acb5` continues Tasks 1–2. Review lanes
  E/F/G and unrelated changes remain untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #988 code complete; live proof recovery required

- Build session `019f6ca0-5f4f-7401-8d2c-21237850acb5` completed Tasks 1–2 at exact head
  `d34f65e6`; worktree is clean. Focused coverage and 417 unit files are green: 3,446 passed,
  2 skipped. Local foundation stopped only at `test:uat-seed` because the shared target database
  already contains real/bootstrap users; migrations and all preceding gates passed.
- Existing live-UAT harness was attempted twice. Both disposable stacks were removed; the clean
  retry failed because `/health/ready` never became healthy within the 240-second Compose start
  window. No screenshots exist, so the lane is code-complete but unproven and may not merge.
- Agent resumed coordinated wrap-up to push/open a draft PR with both blockers recorded. After the
  PR exists, dispatch a fresh exact-head recovery lane to distinguish infrastructure failure from
  branch regression and obtain required desktop+narrow live proof. Review lanes E/F/G and
  unrelated changes remain untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 PR #1117 open; live recovery dispatched

- Draft PR #1117 is open at exact head `d34f65e6c36f133577ab3fe76502ce0a68082e91`, cleanly
  mergeable but explicitly code-complete/unproven. Pre-push format/lint/typecheck passed; no merge
  or issue/board mutation occurred. The spent build agent was exact-resolved and reaped.
- Fresh detached recovery lane `UAT 1117 Recovery`, Codex session
  `019f6cba-8cb2-78f1-a369-431149a1303a`, is running on `gpt-5.6-luna` medium. It must diagnose the
  repeated `/health/ready` failure without editing feature code, then obtain and visually verify
  real authenticated desktop+narrow Webwright evidence at exact head and post it to PR #1117.
- No bypass or evidence waiver is permitted. PR #1117 remains draft/unmergeable-by-policy until
  live proof and independent routine QA are green. Review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #1117 readiness root cause; owner fix running

- Exact-head CI run `29534214899` and a fresh detached recovery both reproduced the branch
  regression: `PUT /api/me/themes/mode` is registered in
  `packages/settings/src/themes-routes.ts` but missing from `packages/settings/src/manifest.ts`.
  Route-coverage therefore crashes the API before `/health/ready`; both Compose smokes are red.
- Recovery also found the earlier UAT smoke hit transient host ENOSPC. Disk is now healthy at
  49 GB free, so no Docker prune or active-container mutation was needed.
- Owner fixer `UX 1117 Fix`, Codex session `019f6cc1-8d33-73d1-b785-6bd78867f5ad`, is applying the
  single existing-pattern manifest entry, focused route-guard verification, commit, and push under
  standing approval. After the new exact head, resume the detached UAT lane for real desktop+narrow
  proof and fresh CI. Review lanes E/F/G remain untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #1117 readiness fix pushed; fresh gates running

- Owner fix `adf41915da50762de15860c82d1ca128ae08b525` changed only
  `packages/settings/src/manifest.ts`, adding the existing-pattern
  `PUT /api/me/themes/mode` entry with `settings.write`. Focused route guard is 7/7 green;
  Settings typecheck, manifest Prettier, full format/lint/typecheck are green. The spent fixer was
  exact-resolved and reaped.
- PR #1117 now points to exact head `adf41915`; fresh CI run `29535049018` has foundation/app and
  both Compose smokes in progress. Prior red checks belong to superseded head `d34f65e6`.
- Detached recovery session `019f6cba-8cb2-78f1-a369-431149a1303a` resumed on the new exact head
  for readiness plus authenticated desktop+narrow Webwright proof and durable PR evidence.
  No bypass is allowed; review lanes E/F/G remain untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #1117 UAT recovery relayed

- Fixed head `adf41915` boots `/health/ready` successfully and passed the real provisioner smoke
  with clean teardown. The first UAT recovery session reached its context threshold after several
  selector-hardening runs and flushed `/tmp/uat-1117-recovery-relay.md`; feature code stayed
  untouched and final screenshots were not yet accepted.
- Its first successor incorrectly booted as Claude, violating this run's Codex-only runtime policy,
  and was closed before continuing. Verified Codex/Luna successor `UAT 1117 Recovery Successor`,
  session `019f6cd0-49bb-7e13-81b2-0416cc7502c8`, is driving the same detached worktree at exact
  head. The spent original session was exact-resolved and reaped.
- Successor must finish one clean Webwright run, visually verify all four screenshots, and post
  durable exact-head evidence to PR #1117. Review lanes E/F/G remain untouched;
  `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #1117 live proof green; foundation CI red

- Codex recovery successor completed authenticated UAT at exact head `adf41915`: clean command
  `JARVIS_UAT_BUILD=0 pnpm exec tsx final_runs/run_1/run_uat.ts` exited `0` after
  provision/migrate/seed `admin+data` and clean teardown. Four desktop/narrow screenshots were
  visually inspected and all critical points are green. Durable PR evidence is comment
  `4996795366`; feature code remained untouched.
- Fresh exact-head Compose and prod-Compose smokes are green, but `Verify foundation and app` job
  `87744270635` in run `29535049018` is red, so merge remains stopped and independent QA has not
  started. Recovery successor session `019f6cd0-49bb-7e13-81b2-0416cc7502c8` is inspecting only
  the failed Actions log to classify PR-local versus infrastructure/main cause.
- No waiver or merge until the foundation failure is resolved under the CI protocol. Review lanes
  E/F/G remain untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 #1117 durable live artifacts; one CI retry

- Foundation failure was isolated to timing/order flakes in
  `tests/integration/skill-gateway-boundary.test.ts` (155/156 integration files and 1,672/1,676
  tests passed). PR #1117 touches no gateway/chat/AI/skill-boundary files; immediately preceding
  main/base run was green. No code change was made.
- Per known-flake protocol, the coordinator started the single allowed failed-run retry for
  `29535049018`; new job `87749446006` is in progress, and its fresh Compose/prod-Compose jobs are
  green. A second foundation failure stops the lane; there will be no additional retry or waiver.
- Sanitized live proof is durable at coordinator commit
  `aad0cccb33c9af6559295148275784db1fd28137`: checked plan, run log, and four current-run
  screenshots only, with no executable scripts or seeded credentials. PR comment `4996847990`
  contains commit-pinned GitHub links. The UAT successor was exact-resolved and reaped.
- PR #1117 remains draft pending the retry and independent routine QA. Review lanes E/F/G remain
  untouched; `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 coordinator relay before #1117 disposition

- The compaction tripwire fired for UX Coordinator session
  `019f6c76-593d-7fd2-b33d-78bd72045265`; merge nothing before a fresh successor adopts the
  coordinator lock. The protected primary Coordinator session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` must remain untouched.
- The user explicitly limited the current CI action to diagnosis/reporting and directed that the
  failed job not be rerun. Do not start any additional retry or broad local gate. After adoption,
  inspect the existing run `29535049018` only; its already-started single retry is the lane's final
  allowed attempt.
- PR #1117 is at exact head `adf41915da50762de15860c82d1ca128ae08b525`, with live UAT proof and
  commit-pinned artifacts already posted. If the existing run is fully green, start fresh detached
  routine `coordinated-qa`; QA must post its verdict to PR #1117. If QA is green, follow the normal
  ready/current/session-lock/merge sequence. A second CI failure stops the lane.
- On adoption, replace the manifest coordinator lock with the successor's immutable Codex session
  id, reset `merges_since_relay` from `1` to `0`, commit and push only this manifest, confirm the
  successor is driving, then fresh-resolve and reap only the old exact `UX Coordinator` label plus
  session `019f6c76-593d-7fd2-b33d-78bd72045265`; finally rename the successor `UX Coordinator`.
  Preserve parked review lanes E/F/G and all unrelated working-tree changes.

## Continuation note — 2026-07-16 successor adopted; #1117 routine QA running

- Codex session `019f6cf0-dc6f-7351-9978-d2b1e6605a96` adopted the delegated `UX Coordinator`
  lock in pushed commit `8c7f3d0d`; `merges_since_relay` reset to `0`. The exact retired
  predecessor session `019f6c76-593d-7fd2-b33d-78bd72045265` was fresh-resolved and closed. The
  protected primary Coordinator session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1` remains untouched.
- Existing CI run `29535049018` attempt 2 completed green at exact PR #1117 head
  `adf41915da50762de15860c82d1ca128ae08b525`. No job, CI retry, or broad local gate was started.
- Fresh detached routine QA is running as exact label `UX 1117 QA`, Codex session
  `019f6cfb-fe5e-7aa0-a082-2c63df48e2e7`, in `~/Jarv1s/.claude/worktrees/qa-1117-routine`.
  QA must inspect existing CI only, post its compact verdict to PR #1117, and report it to exact
  `UX Coordinator` session `019f6cf0-dc6f-7351-9978-d2b1e6605a96`.
- On verdict, fresh-resolve and reap only that QA label plus session. GREEN proceeds through the
  normal ready/current/session-lock/merge sequence; RED stops the lane. Preserve parked review
  lanes E/F/G and every unrelated working-tree change.

## Continuation note — 2026-07-16 #1117 routine QA RED; lane stopped

- Fresh routine QA posted its durable RED verdict at
  `https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4997119318`: CI is green, but
  `apps/web/src/shell/app-shell.tsx:154` stopped exposing dark mode through `data-theme` while
  Today and Wellness still branch on `data-theme === "dark"`. Exit criteria are also unmet because
  the exact-head proof covers only Today/Appearance and omits the recorded onboarding, News,
  microphone, desktop/narrow walkthrough, #988 ledger, and #983 acceptance artifacts.
- PR #1117 remains draft, open, and unmerged at exact head
  `adf41915da50762de15860c82d1ca128ae08b525`. This is failed QA cycle `1/2`; the merge lane is
  stopped pending an owner fix and completed acceptance evidence. Do not manually rerun CI, its
  image job, or broad local gates.
- Exact QA session `019f6cfb-fe5e-7aa0-a082-2c63df48e2e7`, its detached worktree, transient branch,
  and dedicated empty tab were reaped. Reopen only the #1117 owner lane; preserve parked review
  lanes E/F/G and every unrelated working-tree change. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 #1117 owner repair lane reopened

- Exact label `UX 1117 Repair`, Codex session `019f6d05-4fc4-7831-9ed4-9e0f00b0d622`, is working
  in `~/Jarv1s/.claude/worktrees/ux-988-closing-acceptance` on branch
  `ux/988-closing-acceptance`, using the recorded Luna/medium implementation runtime.
- The agent must ground the QA RED finding, produce a minimal repair/evidence plan, and await exact
  `UX Coordinator` approval before implementation. Its temporary untracked handoff must never be
  staged and must be removed before any product-code push.
- The binding CI correction remains in force: do not manually rerun CI, any job, or broad local
  gates. Preserve parked review lanes E/F/G and every unrelated working-tree change.
  `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 #1117 repair plan approved

- Exact repair session `019f6d05-4fc4-7831-9ed4-9e0f00b0d622` grounded the PR head and QA verdict.
  Its pointer plan at
  `~/Jarv1s/.claude/worktrees/ux-988-closing-acceptance/docs/superpowers/plans/2026-07-16-pr-1117-qa-red-repair.md`
  was approved: move Today/Wellness dark-mode consumers to `data-color-mode`, preserve legacy dark
  fallback when the new key is absent, reuse the stored `themes.active` GET read, and leave focused
  regression coverage.
- Implementation is running with focused tests only. No manual CI/job rerun or broad local gate is
  allowed. Evidence gaps must be reported truthfully; absent live proof remains code-complete,
  unproven. Parked review lanes E/F/G and unrelated changes remain untouched.

## Continuation note — 2026-07-16 #1117 repair pushed; acceptance unproven

- Repair commit `44206635` is pushed to `ux/988-closing-acceptance`; PR #1117 now has shared
  `data-color-mode` reads for Today/Wellness, the legacy dark fallback, and one stored
  `themes.active` GET read. Focused tests passed `14/14`; `git diff --check` was clean. Broad local
  gates and manual CI/job reruns were intentionally not run.
- Automatic exact-head CI run `29539532807` is in progress at
  `4420663551afa52ad6da05e9f5696fe0e8d3ab60`. Inspect it only; do not manually rerun it or any job.
- Exact-head UAT remains incomplete: onboarding, deeper News, microphone, full desktop/narrow
  walkthrough, #988 ledger, and the #983 37-finding matrix/narrated summary/release note are
  unproven. Do not start final QA or merge until the live-path/acceptance gate is complete.
- Exact repair session `019f6d05-4fc4-7831-9ed4-9e0f00b0d622` and its empty dedicated tab were
  reaped; the clean owner worktree remains parked. Parked review lanes E/F/G and unrelated changes
  remain untouched. `merges_since_relay` remains `0`.

## Continuation note — 2026-07-16 #1117 exact-head live UAT running

- Fresh detached exact-head UAT is running as label `UX 1117 UAT`, Codex session
  `019f6d0c-7e2c-74d3-a84c-a5d31acc9ef1`, in
  `~/Jarv1s/.claude/worktrees/uat-1117-final-44206635` using Sol/high and `webwright:webwright`.
- UAT must prove or explicitly block every missing live acceptance point, self-verify screenshots,
  and post durable evidence to PR #1117. It may push only evidence branch
  `evidence/pr-1117-44206635-live-uat`; it must never edit/push the PR head or product code.
- Automatic CI run `29539532807` remains the only exact-head CI action. Inspect it only; never
  manually rerun it or a job. Final routine QA waits for both green CI and complete live evidence.
  Parked review lanes E/F/G and unrelated changes remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 CI GREEN; live UAT RED/BLOCKED

- Automatic CI run `29539532807` completed green at exact head
  `4420663551afa52ad6da05e9f5696fe0e8d3ab60`; no retry or broad local gate was started.
- Final live UAT posted RED/BLOCKED at
  `https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4997441312`, with sanitized evidence
  commit `b42f6b4afe0abb09a4dba730675f8b80f17b9dd0` and 41 inspected screenshots. Direct blockers:
  onboarding `Go to settings` lands on `/today`; Activity remains `Loading…` after 3.1 seconds;
  narrow Today wraps lead copy one word per line. Sports title truncation is a lower residual.
- Still unproven: microphone transcription, News freeform/feedback/graceful image failure,
  destructive export/delete, and end-to-end grants/model/skill consequences. The source-preserving
  #983 matrix cannot honestly reconstruct the original 37 identities from 40 exposed timestamp
  bullets without the missing retained transcript/video.
- Exact UAT session `019f6d0c-7e2c-74d3-a84c-a5d31acc9ef1`, its disposable worktree, excluded
  credential-bearing scripts, and empty tab were reaped. Reopen only the #1117 owner lane for a
  grounded repair plan; do not start final QA or merge. Parked review lanes E/F/G and unrelated
  changes remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 live-UAT repair planning

- Exact label `UX 1117 UAT Repair`, Codex session
  `019f6d42-caa7-72a0-ad37-390487dd05c1`, is planning in the clean
  `~/Jarv1s/.claude/worktrees/ux-988-closing-acceptance` owner worktree on Luna/medium.
- The agent must trace the three direct UAT blockers to shared roots, classify each unproven path,
  and await exact `UX Coordinator` plan approval before implementation. No manual CI/job rerun or
  broad local gate is allowed; its temporary handoff must not be staged.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 Activity repair awaiting automatic CI

- Delegated authority is held by exact label `UX Coordinator` and immutable Codex session
  `019f6cf0-dc6f-7351-9978-d2b1e6605a96`. Never touch primary Coordinator session
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`. `merges_since_relay` remains `0`.
- PR #1117 remains draft/open/unmerged at exact head
  `4d2d17ba418b9140a7ea307398fe9e447bd06446` on `ux/988-closing-acceptance`. The Activity repair
  adds `retry: false` to the React Query call so the existing 3-second abort can reach the truthful
  `Activity unavailable` / `Try again` UI. Focused Activity test passed (`1/1`) and file-level
  Prettier passed. No CI/job or broad local gate was manually rerun.
- Existing automatic CI run `29547586161` is in progress for that exact head. Inspect existing CI
  only. If any required check is red, stop the lane and diagnose existing logs only; never rerun a
  job, CI, or broad gate. If fully green, start a fresh detached Activity-focused live UAT: verify
  normal Activity settles, a controlled delay beyond 3 seconds shows the truthful error and retry,
  and retry recovers after delay removal. Reuse prior exact-head proof for unaffected surfaces.
- Prior full UAT verdict/evidence remains at PR comment `4998074616` and evidence commit
  `714fd48a6048131594ecc524902a9ce6b7a20f93`. Previously proven paths include onboarding to
  `/settings`, desktop/narrow Today, Light/Dark plus Teal, Calendar grants, model actions, skill
  creation, and nonzero-byte export. Accepted limitations remain microphone/provider prerequisites
  and unavailable News/email/deletion paths; Sports hero truncation remains deferred.
- Final QA and merge remain stopped until exact-head CI and Activity live UAT are green. Preserve
  parked review lanes E/F/G, the parked clean owner worktree, and all unrelated worktree changes.
  The owner repair pane is no longer live.
- Mid-doing relay: a compaction summary fired the mandatory coordinator relay before CI inspection.
  The successor must read only this latest continuation, invoke `coordinate`, adopt authority with
  its own immutable session id, reset `merges_since_relay` to `0`, commit and push only this
  manifest, confirm driving, then fresh-resolve and close exact label `UX Coordinator` plus session
  `019f6cf0-dc6f-7351-9978-d2b1e6605a96` and rename itself `UX Coordinator`. It should then inspect
  automatic CI run `29547586161` and follow the branch above without rerunning anything.

## Continuation note — 2026-07-17 #1117 Activity repair plan approved

- Graph trace: `ActivityPane` → `listActionAuditLog` → `requestJson` → `GET
  /api/ai/action-audit` → RLS-scoped repository. The prior 3-second abort/error UI is masked by
  React Query's default retry/backoff, leaving `isLoading` true during UAT.
- Temporary plan `docs/superpowers/plans/2026-07-16-pr-1117-activity-uat-repair.md` is approved:
  add `retry: false` only to the Activity query, because the visible `Try again` refetch owns retry;
  add one focused assertion and run focused test/file formatter only. Temporary plan/handoff must be
  removed before push.
- Exact session `019f6daf-1877-7f62-8eca-d0356d6b2c16` is implementing. Final QA and merge remain
  stopped; parked review lanes E/F/G and unrelated changes remain untouched.
  `merges_since_relay` is `0`.

## Continuation note — 2026-07-17 #1117 Activity fix pushed

- Activity root fix `4d2d17ba418b9140a7ea307398fe9e447bd06446` is pushed: its query now uses
  `retry: false`, preserving the existing abort plus `Activity unavailable`/`Try again` UI. Focused
  test passed `1/1`; file-level Prettier passed. No broad gate or manual CI/job rerun occurred.
- Automatic run `29547586161` is in progress at the exact head. Exact owner session
  `019f6daf-1877-7f62-8eca-d0356d6b2c16` was reaped; its tab auto-closed and the owner worktree is
  clean. Wait for full green before a focused exact-head Activity UAT.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-17 #1117 final UAT RED; Activity blocker

- Final exact-head UAT posted RED at
  `https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4998074616`, with sanitized evidence
  commit `714fd48a6048131594ecc524902a9ce6b7a20f93`. Release blocker: Activity remains loading on the
  normal path after 4 seconds; a controlled audit delay beyond 3 seconds shows neither the truthful
  error nor `Try again`, and removal/retry does not recover.
- Proven passing: onboarding Finish reaches `/settings`; desktop and `390x844` Today; independent
  Light/Dark plus Teal; Calendar grant remove/restore; model actions; skill creation; nonzero-byte
  export. Keep these out of the next repair scope.
- Explicit gaps remain honestly blocked by prerequisites/UI availability; Sports truncation stays
  deferred lower severity. Exact UAT sessions `019f6d7d-2ac3-7381-8e6e-284d721616f7` and
  `019f6d9f-b160-7aa3-ba26-62a91707d377`, their disposable tree, and credential-bearing scripts were
  reaped; sanitized evidence remains pushed.
- Reopen only an Activity owner repair plan. Final QA and merge remain stopped; parked review lanes
  E/F/G and unrelated changes remain untouched. `merges_since_relay` is `0`.

## Continuation note — 2026-07-17 #1117 Activity repair planning

- Exact label `UX 1117 Activity Repair`, Codex session
  `019f6daf-1877-7f62-8eca-d0356d6b2c16`, is planning in the clean owner worktree on Luna/medium.
  Scope is the Activity loading/error/retry live blocker only; all proven passing paths and the
  deferred Sports residual are out of scope.
- The agent must trace request/state flow, write a temporary unstaged minimal plan, and await exact
  coordinator approval before code. No manual CI/job rerun or broad local gate is allowed.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-17 #1117 UAT reporting relay

- Exact-head browser run `run_1` completed, but UAT session
  `019f6d7d-2ac3-7381-8e6e-284d721616f7` suffered repeated WebSocket transport failures during
  screenshot self-verification and was reaped after a fresh successor confirmed control.
- Exact label `UX 1117 UAT Finish`, Codex session
  `019f6d9f-b160-7aa3-ba26-62a91707d377`, is driving the same detached worktree on Sol/high. It must
  not rerun the browser flow; scope is remaining visual verification, CP report, secret scan,
  sanitized evidence push, PR verdict, and coordinator report only.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 second CI failure; stop line

- Automatic exact-head run `29542691419` failed `Verify foundation and app` at
  `61ae42ed351343e078531b0dd390405b45a219df`; both deployment smokes passed and image publishing
  skipped. This is the lane's second foundation-check failure, so stop-line issue
  `https://github.com/motioneso/Jarv1s/issues/1119` is open. Do not rerun the workflow/job or a
  broad local gate.
- Post-repair exact-head UAT aborted before browser execution, posted no PR verdict, and pushed no
  evidence branch. Exact UAT session `019f6d4e-e5ad-7731-8c14-2809d0a70773`, its disposable tree,
  and empty tab were reaped.
- Existing-log diagnosis is running as label `UX 1117 CI Diagnose`, Codex session
  `019f6d53-b02e-7550-82b5-3a34304b78ba`, in the clean owner worktree on Luna/medium. It may inspect
  failed logs and source only; no reproduction, retry, or code before an approved plan.
- Final UAT, final QA, and merge remain stopped. Parked review lanes E/F/G and unrelated changes
  remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-17 #1117 CI GREEN; final UAT running

- Automatic run `29543345062` completed fully green at exact head
  `f05d977c186b82b31b42b0d6cff3b98bb1d91b47`: foundation/app, both deployment smokes, and image
  publishing passed. No manual retry or broad local gate occurred.
- Fresh detached exact-head UAT is running as label `UX 1117 UAT GreenHead`, Codex session
  `019f6d7d-2ac3-7381-8e6e-284d721616f7`, in
  `~/Jarv1s/.claude/worktrees/uat-1117-final-f05d977c` on Sol/high with Webwright. It must post a
  sanitized exact-head verdict before final QA can start.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 follow-up CI root cause; repair approved

- Existing log shows format and lint passed; `pnpm verify:foundation` failed at TypeScript only:
  `tests/unit/api-timezone-request.test.ts:77` assigns `RequestInit.signal` (`AbortSignal | null |
  undefined`) to a narrower `AbortSignal | undefined` local.
- Approved repair widens only that test-local type to include `null`. Validation is the targeted
  unit test and file-level Prettier only; the proposed project-wide `tsc --noEmit` is explicitly
  disallowed as a broad gate. No new plan doc is created. Automatic CI supplies the typecheck.
- Exact session `019f6d59-87c8-74a1-a24b-56392b782ba6` is executing. Final UAT, final QA, and merge
  remain stopped; parked review lanes E/F/G and unrelated changes remain untouched.
  `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 type repair pushed

- Exact one-line type repair `f05d977c186b82b31b42b0d6cff3b98bb1d91b47` is pushed. Targeted
  unit test passed `10/10`; file-level Prettier passed. No project-wide `tsc`, broad gate, or manual
  CI/job rerun occurred.
- Automatic run `29543345062` is in progress at the exact head. Exact diagnosis session
  `019f6d59-87c8-74a1-a24b-56392b782ba6` and its empty tab were reaped; the owner worktree is clean.
  Wait for green before restarting exact-head UAT.
- Final UAT, final QA, and merge remain stopped. Parked review lanes E/F/G and unrelated changes
  remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 follow-up CI still RED

- Automatic run `29543062063` failed `Verify foundation and app` at exact head
  `3b331b3f6dbb7c610ad05c89a8e9c57cc8357c9b`; both deployment smokes passed and image publishing
  skipped. Do not retry or run a broad local gate. Stop-line issue #1119 remains open.
- Follow-up existing-log diagnosis is running as label `UX 1117 CI Diagnose 2`, Codex session
  `019f6d59-87c8-74a1-a24b-56392b782ba6`, in the clean owner worktree on Luna/medium. It must reuse
  the existing format-repair plan and create no new planning doc.
- Final UAT, final QA, and merge remain stopped. Parked review lanes E/F/G and unrelated changes
  remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 CI root cause; repair approved

- Existing-log diagnosis found deterministic branch cause in run `29542691419`: `pnpm
  format:check` failed only on branch-added
  `docs/superpowers/plans/2026-07-16-pr-1117-live-uat-red-repair.md`, which is absent on
  `origin/main`. This is not infrastructure/main parity and receives no waiver. Issue #1119 is
  updated with the diagnosis.
- Minimal pointer plan `docs/superpowers/plans/2026-07-16-pr-1117-ci-format-repair.md` is approved:
  format the one offending file, run a focused Prettier check for that file, commit only that
  repair, and push. Do not manually rerun CI/jobs or a broad gate; inspect the new automatic run.
- Exact diagnosis session `019f6d53-b02e-7550-82b5-3a34304b78ba` is executing the approved repair.
  Final UAT, final QA, and merge remain stopped; parked review lanes E/F/G and unrelated changes
  remain untouched. `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 CI format repair pushed

- One-file format repair commit `3b331b3f6dbb7c610ad05c89a8e9c57cc8357c9b` is pushed to
  `ux/988-closing-acceptance`; its focused Prettier check passed. Issue #1119 is updated. No manual
  CI/job rerun or broad local gate occurred.
- Automatic exact-head run `29543062063` is in progress. Wait for it to complete green before
  restarting exact-head live UAT. Exact diagnosis session
  `019f6d53-b02e-7550-82b5-3a34304b78ba` and its empty tab were reaped; the owner worktree is clean.
- Final UAT, final QA, and merge remain stopped. Parked review lanes E/F/G and unrelated changes
  remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 live-UAT repair plan approved

- Exact session `019f6d42-caa7-72a0-ad37-390487dd05c1` grounded exact head `44206635` and UAT
  comment `4997441312`. Its pointer plan at
  `~/Jarv1s/.claude/worktrees/ux-988-closing-acceptance/docs/superpowers/plans/2026-07-16-pr-1117-live-uat-red-repair.md`
  was approved: preserve onboarding Settings destination; bound Activity audit loading with
  truthful error/retry; stack the Today masthead at narrow width.
- Sports title truncation is deferred as a separate lower-severity CSS path. Remaining UAT gaps
  must be classified as code/environment/evidence without fabricated closure. Implementation uses
  focused checks only; no manual CI/job rerun or broad local gate.
- Final QA and merge remain stopped pending a new automatic CI run and fresh exact-head live UAT.
  Parked review lanes E/F/G and unrelated changes remain untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 #1117 post-repair CI/UAT running

- Owner pushed exact head `61ae42ed351343e078531b0dd390405b45a219df`: onboarding Settings
  destination, Activity 3-second abort plus truthful error/retry, and narrow Today masthead stack.
  Focused evidence: onboarding Playwright `7/7`, unit checks `12/12`, design-token check and
  `git diff --check` clean. Sports truncation remains explicitly deferred; other gaps remain
  classified as environment prerequisites or missing evidence without closure.
- Automatic CI run `29542691419` is in progress at the exact head. Inspect only; do not manually
  rerun it or a job. Exact owner session `019f6d42-caa7-72a0-ad37-390487dd05c1` and its empty tab
  were reaped; the clean owner worktree remains parked.
- Fresh detached exact-head UAT is running as label `UX 1117 UAT Final`, Codex session
  `019f6d4e-e5ad-7731-8c14-2809d0a70773`, in
  `~/Jarv1s/.claude/worktrees/uat-1117-final-61ae42ed` on Sol/high. It must post sanitized durable
  evidence before final QA can start.
- Final QA and merge remain stopped. Parked review lanes E/F/G and unrelated changes remain
  untouched; `merges_since_relay` is `0`.

## Continuation note — 2026-07-16 delegated UX Coordinator adoption

- Delegated UX Coordinator authority is Codex session
  `019f6dc5-45d7-7f23-b404-d4fef1bf587f`; `merges_since_relay` is reset to `0`.
- Automatic CI run `29547586161` completed `success` at exact PR #1117 head
  `4d2d17ba418b9140a7ea307398fe9e447bd06446`; all four jobs succeeded. No CI job or
  broad gate was rerun.
- PR #1117 remains open, draft, and mergeable. Final QA and merge remain stopped under the prior
  continuation gates. Preserve unrelated changes, parked lanes E/F/G, and primary Coordinator
  session `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Exact-head live-path UAT is running in fresh detached worktree
  `~/Jarv1s/.claude/worktrees/uat-1117-final-4d2d17ba` as label
  `UX 1117 UAT 4d2d17ba`, Claude session `1015b583-a992-4415-bbdc-277a4ee688d3`, on Sonnet/high.
  It may push only dedicated evidence branch `uat/1117-final-4d2d17ba`; final QA remains gated on
  its durable GREEN proof for exact head `4d2d17ba418b9140a7ea307398fe9e447bd06446`.
- UAT session `1015b583-a992-4415-bbdc-277a4ee688d3` hit its context tripwire after a successful
  live provisioning smoke, wrote `artifacts/webwright/pr-1117-4d2d17ba-final/UAT_HANDOFF.md`, and
  was reaped with no live resources. Successor label `UX 1117 UAT 4d2d17ba-2`, Claude session
  `da1a8e4d-48da-4055-9c9a-dd75ede7caaf`, resumed the same worktree on Sonnet/high to complete
  the eight Webwright critical points and durable exact-head evidence.
- UAT session `da1a8e4d-48da-4055-9c9a-dd75ede7caaf` passed CP1, corrected a CP2 script-selector
  error without touching product code, updated `UAT_HANDOFF.md`, and was reaped with no live
  resources before a verdict. Successor label `UX 1117 UAT 4d2d17ba-3`, Claude session
  `609e1e93-a120-4a45-bd47-57f1678820e2`, resumed on Sonnet/high to rerun the corrected script
  and finish CP1-CP8 evidence.
- Ben requested PRs #1117 and #1118 land. Both are CI-green and currently mergeable, but both
  modify `apps/web/src/styles/kit-today.css` with different blobs. Serialize merge order as #1117
  first; after it lands, integrate #1118 onto the new `main`, then require fresh exact-head live
  UAT and final QA before merging #1118. Do not validate #1118 against its pre-integration head.
- UAT session `609e1e93-a120-4a45-bd47-57f1678820e2` passed CP1-CP4 but reproduced CP5's missing
  Activity timeout error across four script trigger strategies, then relayed cleanly before
  root-cause classification. Focused successor label `UX 1117 CP5 Diagnose`, Claude session
  `7c8c1a97-fc45-4e10-923f-32bbe238d411`, owns the clean exact-head worktree on Sonnet/high to
  classify harness bug versus product defect; #1117 final QA and both merges remain stopped.
- CP5 diagnosis is genuine product RED at exact head `4d2d17ba418b9140a7ea307398fe9e447bd06446`:
  `settings-activity-pane.tsx` recomputes a `Date.now()`-derived `since` inside the query key, so
  each 3-second abort re-render mounts a new query before the error state can render. Durable RED:
  https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4998710772. CP1-CP4 pass; CP5 fails;
  CP6-CP8 are blocked. Diagnostic session was reaped; a product owner fix is required next.
- Product repair is building in isolated worktree `~/Jarv1s/.claude/worktrees/fix-1117-cp5-query-key`
  on branch `fix/1117-cp5-query-key`, label `Fix 1117 CP5 Query Key`, Claude session
  `c84ca792-8ff2-4cd5-a214-a6b551559916`, Sonnet/high. Pre-approved scope is the stable memoized
  query key plus the smallest regression check; it may fast-forward only PR #1117's head branch.
- Repair commit `6ca14fcad8bec023c98e699000a2384657232843` fast-forwarded PR #1117 with only
  `settings-activity-pane.tsx` and its unit test changed; focused typecheck and `git diff --check`
  exited 0. Automatic CI run `29552827799` is in progress and must only be inspected.
- Fresh exact-head UAT is running in `~/Jarv1s/.claude/worktrees/uat-1117-final-6ca14fca`, label
  `UX 1117 UAT 6ca14fca`, Claude session `61c9ee5d-b16f-4fc2-aae6-77807a5e2719`, Sonnet/high.
  Only durable evidence branch `uat/1117-final-6ca14fca` may be pushed; final QA remains gated.
- UAT session `61c9ee5d-b16f-4fc2-aae6-77807a5e2719` stopped before running because #1110 owns the
  same fixed Docker subnet `10.254.0.0/24`; no UAT result exists. It wrote
  `artifacts/webwright/pr-1117-6ca14fca-final/UAT_HANDOFF.md` and was reaped cleanly. Resume only
  after label `Build-1110-AppMap-11`, session `80422bad-c77e-4f44-aaeb-5c4f43f3602e`, confirms
  its stack is torn down and the subnet is clear.
- `Build-1110-AppMap-11` confirmed the subnet fully clear. UAT resumed from the prepared handoff
  as label `UX 1117 UAT 6ca14fca-2`, Claude session
  `1d64f426-0873-470c-968b-6a30d232acd6`, Sonnet/high, with exclusive use of the exact-head
  worktree and no product-code authority.
- Exact-head UAT is GREEN: all CP1-CP8 passed at `6ca14fcad8bec023c98e699000a2384657232843`,
  including CP5 truthful error at 3.64 seconds and CP6 retry recovery. Evidence branch
  `uat/1117-final-6ca14fca` is at `9ff04747b825d9713437c4e305ba0d845c2922c2`; durable proof:
  https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4998813024. UAT session was reaped.
  Automatic CI run `29552827799` remains in progress; final QA is still stopped on CI.
- Automatic CI run `29552827799` completed `success` at exact head
  `6ca14fcad8bec023c98e699000a2384657232843`. Independent sensitive-tier final QA is running as
  native subagent `qa_1117_final` in fresh detached worktree
  `~/Jarv1s/.claude/worktrees/qa-1117-final-6ca14fca`; it trusts CI and must post its compact
  verdict to PR #1117 without rerunning gates.
- Independent sensitive-tier final QA is GREEN with 0 blocking and 0 non-blocking findings;
  invariants are intact and exit criteria met. Durable verdict:
  https://github.com/motioneso/Jarv1s/pull/1117#issuecomment-4998916253. PR #1117 is CLEAN against
  `main` and merge-ready at exact head `6ca14fcad8bec023c98e699000a2384657232843`.
- PR #1117 merged first at `65b8a7f8864647cb8c73baa648b6cde05eab1ccc`; issue #988 auto-closed.
  Sensitive merge digest: CI run `29552827799` green, exact-head UAT CP1-CP8 green, independent
  QA green with 0 findings. `merges_since_relay` is now `1`; no relay trigger has fired. PR #1118
  must now integrate this new `main` before any UAT/final-QA evidence can count.
- PR #1118 integration is running in fresh worktree
  `~/Jarv1s/.claude/worktrees/integrate-1118-post-1117`, branch
  `integrate/1118-post-1117`, label `Integrate 1118 after 1117`, Claude session
  `f97e5fca-68d9-4062-a5cc-11e10776c393`, Sonnet/high. It must rebase old head
  `0ca557c82e068f2bacded1781dafd6b22e12821e` onto #1117 merge
  `65b8a7f8864647cb8c73baa648b6cde05eab1ccc` and update the PR only by force-with-lease.
- PR #1118 rebased cleanly with 0 conflicts and force-with-lease updated its exact head to
  `00c43878c6ffada902f3955962f3f9101dc6e14b`; only `kit-today.css` and the existing UAT spec are
  in its diff. Automatic CI run `29554612636` is in progress and must only be inspected.
- Exact-head UAT is running in fresh worktree `~/Jarv1s/.claude/worktrees/uat-1118-final-00c43878`,
  label `UX 1118 UAT 00c43878`, Claude session `9fc16680-781e-4bd2-a4c8-e0125708e3cd`,
  Sonnet/high. It may push only evidence branch `uat/1118-final-00c43878`.
- UAT session `9fc16680-781e-4bd2-a4c8-e0125708e3cd` prepared the six-CP plan/script and held a
  healthy live instance at `127.0.0.1:20001`, then relayed before browser execution. Successor
  label `UX 1118 UAT 00c43878-2`, Claude session `f6db5ae7-8d10-4f6b-bcbd-82532cc2d97a`,
  Sonnet/high, resumed the same worktree to execute and publish the final verdict.
- Exact-head UAT is GREEN at `00c43878c6ffada902f3955962f3f9101dc6e14b`: CP1-CP6 passed,
  evidence branch `uat/1118-final-00c43878` is at
  `a4ee3c0ed9936b0c7c46dd8c4eb3d355ca0297af`, durable proof:
  https://github.com/motioneso/Jarv1s/pull/1118#issuecomment-4999028297.
- Automatic CI run `29554612636` is RED on `Verify foundation and app` job `87804059657`; both
  compose smoke jobs passed and image publishing was skipped. Stop-the-line: owner lane must
  diagnose the existing failure without rerunning CI; final QA and merge remain stopped.
- Owner diagnosis found two failures in `tests/integration/tasks-agency-tools.test.ts` caused by a
  pre-existing `AssistantToolGateway` action-request race; PR #1118's diff has no overlapping
  code. No fix or push was made. This is not yet a waiver: native subagent `qa_1118_ci_red` is
  running only that focused test file on exact `origin/main` SHA
  `65b8a7f8864647cb8c73baa648b6cde05eab1ccc` to establish or reject main-branch proof.
- Main-branch waiver proof is NOT established: on pinned `origin/main`
  `65b8a7f8864647cb8c73baa648b6cde05eab1ccc`, focused command
  `pnpm exec tsx scripts/test-integration.ts tests/integration/tasks-agency-tools.test.ts` exited 0
  with 7/7 tests passing, so the two PR-run failures did not reproduce. No waiver is recorded.
  PR #1118 remains stopped on RED CI pending Ben's explicit authorization for one failed-job rerun;
  current no-rerun instruction forbids coordinator action. `merges_since_relay` remains `1`.

## Continuation note — 2026-07-16 PR #1118 CI blocker relay

- Compaction tripwire fired. Flush this manifest and relay immediately; merge nothing first.
- PR #1118 exact head `00c43878c6ffada902f3955962f3f9101dc6e14b` has GREEN CP1-CP6 UAT but
  RED automatic CI run `29554612636`, failed job `87804059657`. The focused integration test
  passed 7/7 on pinned `origin/main`, so no waiver is established or recorded.
- Ben explicitly authorized one rerun of failed job `87804059657` on 2026-07-16. Attempt 2 job
  `87820200691` completed GREEN; no rerun authorization remains and no waiver was used.
- Delegated `UX Coordinator` authority is adopted by immutable Codex session
  `019f6e67-577e-78f0-9b4a-822c0c95c396`; `merges_since_relay` is reset to `0`.
- Preserve unrelated changes and parked lanes. Never touch primary Coordinator
  `f3e5e852-b905-47f4-bbb0-df8f9b2d95f1`.
- Ben explicitly authorized completion and merge of PRs #1118, #1122, and #1126 on 2026-07-17;
  primary successor `Coord-1109-1110-g12` owns #1122/#1126 while this delegated lock owns #1118.
- PR #1118 rebased cleanly onto `origin/main` `7dc9672f` at exact head
  `5be51d4863d05d2d82b438e34f507a76662cb2da`; fresh CI run `29598820300` is GREEN and exact-head
  live UAT is GREEN at PR comment `5005768157`. Fresh integrated routine QA is pending.
