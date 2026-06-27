# Coordination Run - rfa-overnight-20260627

**Date:** 2026-06-27
**Coordinator lock:** label `Coordinator`, stable anchor = Codex session id
`019f0790-01da-70a2-a013-554a014c24b6`. Single-coordinator lock verified: exactly
one pane labelled `Coordinator`, and it is this session. Pane ids are routing hints only.
**Merge policy:** `routine`/`sensitive` may auto-merge after independent green QA;
`security` requires Ben's explicit merge sign-off after posted QA verdict.
**Relay threshold:** security-tier merge -> relay immediately; routine/sensitive
`merges_since_relay >= 2` -> relay. Compaction summary -> relay before merge.
**merges_since_relay:** 0

## Base

- GitHub source of truth checked at launch: open issues labeled `RFA` in
  `motioneso/Jarv1s`.
- Main CI: green on `origin/main` `a655128` (`CI`, run `28271573833`).
- Coordinator worktree: `coord/rfa-overnight-20260627` at `385fa6e`; preflight passed
  with tree current and 20 local-only commits ahead of `origin/main`.
- Clean agent base: `rfa/spec-base-20260627` at `b0d8db1`, created from green
  `origin/main@a655128` plus only the approved docs/spec commits through `385fa6e`.
  Child worktrees branch from this base so they can read specs without inheriting the
  coordinator branch's unrelated local command-palette delta.
- GitHub approval comments override stale `Draft` headers for #525, #526, #531, #532,
  #533, and #534. Header cleanup is not a build prerequisite.
- Ben approval: overnight autonomous directive on 2026-06-27; proceed through RFA queue,
  with security-tier merges held for explicit sign-off.

## Queue

| Issue | Spec | Tier | Status | Build | Review | Branch | PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #528 | `docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md` | security | CI GREEN + security QA GREEN; awaiting Ben merge sign-off | Codex | opencode/GLM security QA | `rfa-528-memory-graph-substrate` | #545 |
| #526 | `docs/superpowers/specs/2026-06-27-unified-priority-model.md` | sensitive | blocker fix pushed at `e923424`; CI run `28286935159` in progress, QA rerun pending green checks (`w1:p3Q`) | Codex salvage after opencode/GLM | native Codex QA fallback | `rfa-526-unified-priority-model` | #544 |
| #534 | `docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md` | security | implementation committed; AGY wrap-up/push/PR requested (`w1:p3N`) | AGY | Codex security QA | `rfa-534-action-permission-tiers` | - |
| #529 | `docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md` | security | stacked on #528; candidate-store commit `508f7e8` landed, helpers in progress (`w1:p3Z`) | Codex | opencode/GLM security QA | `rfa-529-memory-distillation` | - |
| #530 | `docs/superpowers/specs/2026-06-27-passive-context-retrieval.md` | sensitive | PR #546 open on #528 base; branch pushed at `8877e5e`, CI running, QA pending green checks + stack order (`w1:p3T`) | Codex | opencode/GLM QA | `rfa-530-passive-context-retrieval` | #546 |
| #527 | `docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md` | security | queued after #526/#529 | opencode/GLM | Codex security QA | `rfa-527-usefulness-feedback` | - |
| #532 | `docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md` | security | queued after #528/#529/#530 | Codex | AGY security QA | `rfa-532-confidence-aware-memory` | - |
| #525 | `docs/superpowers/specs/2026-06-27-cross-tool-reasoning.md` | sensitive | queued after #530 | AGY | opencode/GLM QA | `rfa-525-cross-tool-reasoning` | - |
| #533 | `docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md` | security | queued after #532 | opencode/GLM | Codex security QA | `rfa-533-memory-dashboard` | - |
| #531 | `docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md` | security | queued after #526/#527 | Codex | AGY security QA | `rfa-531-proactive-monitoring` | - |
| #535 | `docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md` | security | queued after #526/#527/#528/#532/#533/#534 | AGY | opencode/GLM security QA | `rfa-535-long-running-goals` | - |
| #536 | `docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md` | security | queued after #526/#531/#534/#535 | opencode/GLM | Codex security QA | `rfa-536-recurring-briefings` | - |
| #537 | `docs/superpowers/specs/2026-06-27-automatic-commitment-extraction.md` | security | queued after #527/#528/#529/#532/#533/#534/#535/#536 | Codex | AGY security QA | `rfa-537-commitment-extraction` | - |
| #538 | `docs/superpowers/specs/2026-06-27-unified-person-contact-model.md` | security | queued after #525/#528/#532/#533/#537 | opencode/GLM | Codex security QA | `rfa-538-person-contact-model` | - |
| #520 | - | routine | blocked: no approved spec found | - | - | - | - |

Excluded by launch rule: #539, #540, #541 are open but labeled `needs-spec`, not `RFA`.

## Dependency / Merge Order

- **Wave 1:** #528, #526, #534. These unlock the memory spine, priority/proactive chain,
  and action-policy chain. They have disjoint primary surfaces; #528 is the migration-heavy
  lane, #526 uses existing preferences/scoring seams, #534 reuses the existing assistant
  gateway/action-request path.
- **Memory spine:** #528 -> (#529 and #530) -> #532 -> #533.
- **Priority/proactive:** #526 -> #527 -> #531.
- **Chat reasoning/person:** #528 -> #530 -> #525 -> #538.
- **Action/automation:** #534 -> (#535, #536, #537); #536 -> #537; #537 -> #538.
- **Long-goal chain:** #526 + #527 + #528 + #532 + #533 + #534 -> #535 -> #536 -> #537.
- **Merge order target:** #526 first if green; #528 and #534 require Ben sign-off.
  After a security PR is QA-green, leave it `awaiting-ben-signoff` and keep building
  non-conflicting queued work only when it does not violate the dependency/collision map.

## Collision Notes

- Use isolated lane databases for full gates; prior coordinated builds hit shared integration
  reset races. Handoffs should require `JARVIS_PGDATABASE=jarvis_build_<slug>` for full gates.
- No agent may touch `docs/coordination/`, project board, milestones, or merges.
- Agents must stage explicit paths only; no `git add -A`.
- Migration numbering is a merge-order concern. Agents must not assume a global migration number
  when a predecessor in the chain is unmerged.
- Shared surfaces to watch:
  - memory schema/package/API: #528, #529, #532, #533, #535, #537, #538;
  - chat `runTurn` and hidden context injection: #525, #529, #530, #532;
  - `app.preferences` and settings routes/UI: #526, #531, #534, #535, #536;
  - assistant gateway/policy/action requests/manifests: #525, #534, #535, #537;
  - pg-boss metadata-only jobs/schedules: #529, #531, #535, #536, #537, #538;
  - cross-source module manifests/read providers: #525, #531, #536, #537, #538;
  - export/delete/RLS coverage: #527, #528, #529, #531, #532, #533, #535, #537, #538.

## CI Waivers

None.

## Outstanding Escalations

- #520: RFA-labeled but missing approved spec. Do not spawn until a spec exists or Ben waives the
  spec gate.
- Security-tier PRs: build and QA may proceed; merge waits for Ben's explicit sign-off.
- #534: plan reviewed against current seams in `packages/module-sdk`, `packages/ai`, `packages/db`,
  and tasks settings/routes; no spec drift found. Coordinator approval was sent to pane `w1:p3N`
  with explicit constraints to keep the gateway as the single decision point, keep destructive and
  external actions hard-confirm, use one shared canonical+legacy compatibility helper for
  `tasks/task_changes`, keep canonical+legacy writes transactional, and avoid a second executor or
  global automation switch. The lane is already mid-implementation while the approval message sits
  queued behind active work.
- #529: next dependency-safe dogfood lane was spawned stacked on `rfa-528-memory-graph-substrate`
  head `519ad54` in worktree `~/Jarv1s/.claude/worktrees/rfa-529-memory-distillation`. Coordinator
  committed handoff `174997f` with migration slot `0119_memory_candidates.sql`, metadata-only
  payload, deterministic gate, pending-vs-promoted, and no-raw-graph-SQL constraints. An initial
  opencode spawn failed to stick; a Codex build lane was then launched successfully on
  `gpt-5.5` default-medium reasoning as pane `w1:p3Z` / session
  `019f08b7-6e1f-7480-9fd4-c784c2741968`. The lane grounded the spec on-branch, wrote
  `docs/superpowers/plans/2026-06-27-memory-distillation-pipeline.md`, and escalated for approval.
  Coordinator approved with no fork: keep queue name `chat.extract-facts`, keep PR base on
  `rfa-528-memory-graph-substrate`, use `0119` only for `memory_candidates`, keep graph writes on
  #528 public APIs/repository (candidate store direct SQL only), never distill incognito turns,
  keep pending candidates out of normal recall, leave commitment/task actioning to #537, and keep
  payload/logging metadata-only. First material commit is now in: `508f7e8`
  (`feat(memory): add memory candidate store`). Lane verified
  `pnpm vitest run tests/integration/memory-graph.test.ts -t "MemoryCandidatesRepository|memory_candidates"`
  green and moved on to distillation helpers.
- #526: plan approved from `docs/superpowers/plans/2026-06-27-unified-priority-model.md`; scope
  constrained to pure scorer, owner-scoped preference API/UI, and thin consumers over already-loaded
  candidates. Task 1 focused unit suite passed before commit `3f1abb1`. After Task 5, gate was red
  on parse/lint issues. GLM left a clean tree with committed lint/parse failures after several
  rework commits, so the stalled pane was closed and a single Codex salvage pane `w1:p3Q` was started
  on the same worktree to fix the red gate only. Salvage commit `67ca551` repaired package wiring,
  settings routes/manifests, scorer strictness, chat/briefings consumers, and focused tests. Build
  agent reported PR #544 at head `3e1cf2d`, rebased on `origin/main@a655128`, with
  `VF_EXIT=0`/`AUDIT_EXIT=0`. Planned AGY QA remained blocked by quota, so native independent QA
  worker `Aquinas` was spawned as fallback. QA posted a RED verdict: image build CI failed; direct
  `app.preferences` query in `packages/briefings/src/priority-consumer.ts` violates module
  isolation; settings UI priority pane was not reachable/editable. Findings relayed to build pane
  `w1:p3Q`; lane went back to rework. Follow-up CI run `28282300873` on head `bdf4dcb` is fully
  green, but rerun QA still found one blocking issue: `packages/settings/src/priority-routes.ts`
  persisted nested anchor objects verbatim, allowing unknown nested fields and potential secret/raw
  payload persistence inside `priority.model.v1`. That blocker is now routed to the build lane with
  explicit regression-test requirement. The salvage lane fixed that issue in commit `e923424`
  (`fix(priority): reject unknown anchor fields (#526)`), added a regression that rejects
  `rawSourceBody` with 400, reran focused `priority-api` plus `format:check`, `lint`, `typecheck`,
  `verify:foundation`, `audit:preflight`, and `audit:release-hardening` with green exit codes, then
  pushed PR #544 at head `e9234242e090df8bd523db223c851b357f42e853`. GitHub CI run `28286935159`
  is now in progress; do not spend another QA pass until those checks are green.
- #528: plan approved from `docs/superpowers/plans/2026-06-26-memory-graph-substrate.md`;
  plan committed as `150544c`; coordinator assigned next free global migration number `0118` for
  `packages/memory/sql/0118_memory_graph_substrate.sql`. Task 1 schema, Task 2 repository, and Task 3
  graph recall service are committed. Route/API, assistant tools, export/delete handling, and split
  integration coverage are committed through `519ad54`; build agent reported PR #545 with
  `VF_EXIT=0`/`AUDIT_EXIT=0`, rebased on `origin/main`. GitHub CI was pending at QA launch. Security
  QA first ran in detached worktree `qa-545-glm` via opencode/GLM pane `w1:p3R`, but reviewed the
  wrong checkout and posted an invalid spec-only RED verdict; coordinator posted a superseding PR
  comment. Corrected GLM QA ran in verified detached worktree `/tmp/jarv1s-qa-545-glm-2` after
  confirming HEAD `519ad54` and graph files are present; it posted GREEN security verdict with
  0 blocking / 3 non-blocking findings. As of the verdict, Verify/app and compose smokes were green,
  and all GitHub CI checks are green. Security-tier merge is now blocked only on Ben's explicit
  sign-off. Coordinator surfaced PR #545 and the valid QA verdict pointer to Ben, and must not merge
  until Ben explicitly approves.
- #530: spawned as a stacked dependent lane because #528 is QA/CI green but awaiting security-tier
  sign-off. Branch `rfa-530-passive-context-retrieval` is based on `origin/rfa-528-memory-graph-substrate`
  at `519ad54`; handoff commit `d3b7aaa`. PR base should stay `rfa-528-memory-graph-substrate` until
  #528 lands. Initial Codex pane `w1:p3T` hit a model-limit prompt, switched to `gpt-5.5 medium`,
  and resumed. The lane verified the chat runtime seam can take a graph-recall port via route deps
  and module registry, wrote `docs/superpowers/plans/2026-06-27-rfa-530-passive-context-retrieval.md`,
  received coordinator approval, then committed `3980da5` (`feat(chat): wire passive memory graph
  recall`) and `3449d0c` (`test(chat): cover passive context retrieval`). A targeted integration
  initially failed because the stub embedding threshold was too fuzzy for the test phrase; the lane
  narrowed the query to the exact remembered phrase without changing runtime behavior, committed
  cleanup `8877e5e` (`chore(chat): format passive retrieval plan`), and is now running the longer
  lane-DB full gate before PR/open report. The lane has now reported DONE with PR #546
  (`https://github.com/motioneso/Jarv1s/pull/546`), branch `rfa-530-passive-context-retrieval`
  pushed at head `8877e5e31c3ee6d8292368a7bdb3602c88c273ca`, base
  `rfa-528-memory-graph-substrate`, `VF_EXIT=0` on lane DB `jarvis_build_rfa_530_passive_context`,
  `AUDIT_EXIT=0`, and focused `lint`, `format:check`, `typecheck`, `test:chat`, `test:memory`
  green. GitHub CI run `28287158764` is still in progress, so independent QA waits for green
  checks. Because this PR is stacked on #528, merge remains blocked on #528 landing first even
  after QA passes.
- #534: AGY finished implementation and reported local `typecheck` plus unit/integration suites
  green after commit `feat(core): implement rfa-534 action permission tiers`. Coordinator nudged
  the pane into `coordinated-wrap-up`: full gate if needed, pre-push trio, rebase, push, PR open,
  then report. Await branch/PR/evidence. One minor process drift to note: pane narration showed
  `git add .` during its local commit path; because this is an isolated worktree the blast radius
  is contained, but keep explicit-path staging standard on later nudges.

## Reaped Sessions

- Closed stalled opencode/GLM pane `w1:p3M` for #526 after it remained idle on a clean but red tree;
  replacement Codex salvage pane is `w1:p3Q`.
- Closed native QA worker `Aquinas` after its RED verdict was posted to PR #544 and relayed.
- Closed native QA worker `Volta` after its RED rerun verdict was posted to PR #544 and relayed.
