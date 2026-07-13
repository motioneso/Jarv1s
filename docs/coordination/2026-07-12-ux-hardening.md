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
| #984 | `2026-07-12-private-chat-history-trust-hardening.md` | security | Decision 4/Slice 2 repair committed at `57c484ac`; full drawer 13/13 before fixture dedupe, focused 2/2 after, targeted Prettier and typecheck exit 0. Module lane released the global DB slot; process/Postgres scans were quiet, and #984 now owns one final full gate on fresh `jarv1s_ux984_gate*`. Label `UX 984 Private History Codex`, session `019f5a73-fb2a-7e13-9832-54c0503d5bd9`, pane `w1:pK3`; Slice 4 blocked on #868 |
| #985 | `2026-07-12-true-yolo-approval-popover-hardening.md` | security umbrella; routine UI slices | PR #1012 security QA RED at `issuecomment-4956103194`: five blockers cover native secret/hard-policy ordering, audit persistence/negative coverage, menu trigger/focus, false #1011 deferral, and live UAT evidence. Builder `UX 985 YOLO Approvals Codex`, session `019f5a73-f9f4-71e0-bf84-d0b5effe12ae`, pane `w1:pK2`, is reopened for bounded remediation; no merge/sign-off request |
| #986 | `2026-07-12-settings-shell-navigation-ia-hardening.md` | routine | DONE on PR #1010 at `6a88c8c5`; builder reports `VF_EXIT=0`, `AUDIT_EXIT=0`, Chromium 5/5. Independent routine QA is active in detached worktree under label `QA 1010 Settings Shell Codex`, session `019f5a91-13fa-7950-b4f2-96ea2ebf9c00`, pane `w1:pK6`; primary Coordinator alone merges |
| #987 | `2026-07-12-notes-people-source-picker-hardening.md` | sensitive | approved; worktree/handoff ready on `ux/987-notes-people-build`; held behind #986's `settings-personal-data-panes.tsx` lock |
| #989 | `2026-07-12-sports-settings-dogfood-hardening.md` | routine | PR #1009 head `c1093427`; all four CI checks green. Real-UI isolated Sports UAT is green at desktop + 390px with screenshots in `issuecomment-4955887307`. Independent re-QA active under label `QA 1009 Sports Settings R2 Codex`, session `019f5aa9-de55-7981-99b7-41a576e7e4ff`, pane `w1:pK8`; primary Coordinator alone merges |
| #990 | `2026-07-12-news-settings-dogfood-hardening.md` | routine | Task 4 Playwright is 3/3 green. Second full foundation attempt exited 1 with 150/152 integration files and 1628 passing tests; two reset suites hit catalog `tuple concurrently updated` while the primary module lane ran foundation concurrently. No third run/waiver. Lane is stop-line pending the global gate queue; infra issue #1013 tracks the root cause. Label `UX 990 News Settings Codex`, session `019f5a72-b4fb-7c30-8b75-5fc26c4bc9fa`, pane `w1:pK1` |
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
- QA #1012 YOLO Approvals, Codex session `019f5a9b-685d-7fa0-9a32-11e83ecd0ef3`.

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
