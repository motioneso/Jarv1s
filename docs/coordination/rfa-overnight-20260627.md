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
| #528 | `docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md` | security | building Task 1; plan commit `150544c`, migration `0118` assigned (`w1:p3K`) | Codex | opencode/GLM security QA | `rfa-528-memory-graph-substrate` | - |
| #526 | `docs/superpowers/specs/2026-06-27-unified-priority-model.md` | sensitive | rework: lint/parse red after Task 5; fixing before PR | opencode/GLM | AGY QA | `rfa-526-unified-priority-model` | - |
| #534 | `docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md` | security | blocked: AGY quota until ~2026-06-27 00:55 PT (`w1:p3N`) | AGY | Codex security QA | `rfa-534-action-permission-tiers` | - |
| #529 | `docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md` | security | queued after #528 | AGY | Codex security QA | `rfa-529-memory-distillation` | - |
| #530 | `docs/superpowers/specs/2026-06-27-passive-context-retrieval.md` | sensitive | queued after #528 | Codex | opencode/GLM QA | `rfa-530-passive-context-retrieval` | - |
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
- #534: AGY quota reached at spawn; retry same pane after quota reset or reassign only if this
  blocks useful progress after #526/#528 plan gates.
- #526: plan approved from `docs/superpowers/plans/2026-06-27-unified-priority-model.md`; scope
  constrained to pure scorer, owner-scoped preference API/UI, and thin consumers over already-loaded
  candidates. Task 1 focused unit suite passed before commit `3f1abb1`. After Task 5, gate was red
  on parse/lint issues; GLM is in rework and must not open PR until lint/format/typecheck and
  relevant tests pass from a clean tree.
- #528: plan approved from `docs/superpowers/plans/2026-06-26-memory-graph-substrate.md`;
  plan committed as `150544c`; coordinator assigned next free global migration number `0118` for
  `packages/memory/sql/0118_memory_graph_substrate.sql`.

## Reaped Sessions

- None.
