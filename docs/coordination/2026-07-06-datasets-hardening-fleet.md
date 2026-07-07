# Coordination Run — 2026-07-06-datasets-hardening-fleet

**Date:** 2026-07-06
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `6b766f7c-577d-4e32-b5b8-b441e6788036`** (pane `w1:p80` at time of writing — resolve fresh by label+session, not this pane number). Relayed from prior anchor `f64fd971-3fad-4880-a2fd-6dbb7aba935e` (pane `w1:p8S`, now `done`, pending reap).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; no `security`-tier items in this run.
**Relay threshold:** routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> Externalized coordinator memory. GitHub is the source of truth for spec/issue/board status;
> this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #832 | routine | building | datasets-chain | w1:p94 | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #833 | sensitive | building | datasets-chain | w1:p94 | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #836 | routine | building | datasets-chain | w1:p94 | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation follow-up, #798) | #834 | sensitive | building | dep-cycle | w1:p95 | 834-jobs-settings-cycle | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md | #835 | routine | building | settings-ui-scanner | w1:p96 | 835-scanner-reserved-paths | — |
| docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md | #837 | routine | building | sports-cleanup | w1:p97 | 837-sports-postmerge-cleanup | — |

Risk tier basis: #833 and #834 touch a security-adjacent guard path (redirect header handling)
and a module-isolation boundary respectively — no auth/RLS/secrets, so `sensitive` not
`security`, but flagged for an explicit invariant check during QA. All others `routine`.

## Dependency / merge order

- **Parallel group 1 (3 independent worktrees, launch together):** #834, #835, #837 — no shared
  files with each other or with the datasets cluster (confirmed via Opus collision-map subagent).
- **Serialized chain A (1 worktree, one agent, rebase each on prior):** #832 → #833 → #836 — all
  three rewrite `packages/datasets/src/host-pinning.ts` (redirect loop) and/or `client.ts`. Order:
  #832 first establishes the pinning-error taxonomy; #833 then #836 both mutate the same redirect
  loop body, so they land back-to-back on top of it.
- **Merge order:** #834 / #835 / #837 merge independently whenever green (any order). Datasets
  chain merges strictly #832 → #833 → #836 (each PR based on the previous, not on stale main).

## CI waivers

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

## Outstanding escalations

- [ ] none yet — no blockers, just mid-spawn when relay fired.

## Reaped sessions

- `f64fd971-3fad-4880-a2fd-6dbb7aba935e` (old Coordinator, pane `w1:p8S`) — relayed cleanly at
  70% meter warning mid-Phase-1-spawn; closed by successor after confirming driving, 2026-07-06.

## Continuation note (updated 2026-07-06, Phase 1 spawn complete)

**Phase 1 done.** All 4 build agents spawned into the new `w1:t1B` "agents" tab, confirmed on
Sonnet 5, all `working`:
- `datasets-chain` — `w1:p94` — `.claude/worktrees/832-datasets-host-pinning` — #832→#833→#836
- `dep-cycle` — `w1:p95` — `.claude/worktrees/834-jobs-settings-cycle` — #834
- `settings-ui-scanner` — `w1:p96` — `.claude/worktrees/835-scanner-reserved-paths` — #835
- `sports-cleanup` — `w1:p97` — `.claude/worktrees/837-sports-postmerge-cleanup` — #837

Now in **Phase 2 (supervise)**: persistent Monitor armed on `w1:t1B` pane statuses (agent_status
flips only) plus the separate sports-broadsheet watch below. Old coordinator pane `w1:p8S`
confirmed handed off cleanly and was reaped.

**Separate, non-fleet item to watch (Ben asked explicitly):** pane `w1:p8Y` (label none, worktree
`829-sports-broadsheet`, branch `worktree-829-sports-broadsheet`, model "Fable 5") is an
**already-running, independent** build agent NOT part of this manifest — idle at last observation.
Ben wants status changes surfaced to him. Re-established as a persistent background Monitor
(this session) polling `herdr pane list` for this pane's `agent_status`, emitting only on change.
`837-sports-postmerge-cleanup`'s handoff doc already warns that build agent about this other one
running concurrently (both touch sports files, but different scopes) — no action needed there
beyond the watch.

**Explicitly excluded from this run (Ben's call):** sports issues #840/#841/#842/#845 (standings/
headline follow-ups) — do NOT queue these tonight.
