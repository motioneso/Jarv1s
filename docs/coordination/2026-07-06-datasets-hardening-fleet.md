# Coordination Run — 2026-07-06-datasets-hardening-fleet

**Date:** 2026-07-06
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `20d80002-bd0f-409f-81cb-7aa441000ae2`** (pane `w1:p9B` at time of writing — resolve fresh by label+session, not this pane number). Relayed from prior anchor `6b766f7c-577d-4e32-b5b8-b441e6788036` (pane `w1:p80`, `done`, reaped 2026-07-06).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; no `security`-tier items in this run.
**Relay threshold:** routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> Externalized coordinator memory. GitHub is the source of truth for spec/issue/board status;
> this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #832 | routine | building | datasets-chain-2 | w1:p9C | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #833 | sensitive | building | datasets-chain-2 | w1:p9C | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #836 | routine | building | datasets-chain-2 | w1:p9C | 832-datasets-host-pinning (chain: 832→833→836) | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation follow-up, #798) | #834 | sensitive | building | dep-cycle-2 | w1:p98 | 834-jobs-settings-cycle | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md | #835 | routine | qa | settings-ui-scanner-relay | w1:p99 | 835-scanner-reserved-paths | #846 |
| docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md | #837 | routine | qa | sports-cleanup-2 | w1:p9A | 837-sports-postmerge-cleanup | #847 |

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
- `7c7eff4c-e45c-4f1f-b406-30c0fd70dcc1` (dep-cycle, pane `w1:p95`) — relayed at 70% meter warning
  mid-task-1; successor `dep-cycle-2` (session `f6bbc908…`, pane `w1:p98`) confirmed driving same
  worktree/branch; reaped 2026-07-06.
- `f972ec66-e8a1-4de3-87d2-f99b84afb037` (settings-ui-scanner, pane `w1:p96`) — relayed at 70%
  meter warning right after plan approval, before coding started; successor
  `settings-ui-scanner-relay` (session `c2541244…`, pane `w1:p99`) confirmed driving same
  worktree/branch; reaped 2026-07-06.
- `6b766f7c-577d-4e32-b5b8-b441e6788036` (old Coordinator, pane `w1:p80`) — relayed at 70% meter
  warning mid Phase 1 spawn / Phase 2 supervise handoff; successor confirmed driving (session
  `20d80002…`, pane `w1:p9B`, same tab `w1:t15`); reaped 2026-07-06.
- `3fb02854-0cd3-4c8f-a7ca-ab9adc597a1b` (sports-cleanup, pane `w1:p97`) — relayed after plan
  approval, before coding started; successor `sports-cleanup-2` (session `f396257a…`, pane
  `w1:p9A`) confirmed driving same worktree/branch; reaped 2026-07-06.
- `0d5ad1d5-c963-4142-b422-73741d2c2cdd` (datasets-chain, pane `w1:p94`) — relayed at 70%+ meter
  warning mid Task 1/2 of TDD on #832; successor `datasets-chain-2` (session `c99a6e28…`, pane
  `w1:p9C`) confirmed driving same worktree/branch, Sonnet; reaped 2026-07-06.

## Current state (as of this relay-ack, 2026-07-06)

All 4 lanes live in `w1:t1B`, coordinator now resident at session `20d80002…` (pane `w1:p9B`,
label `Coordinator`, tab `w1:t15`):

| Agent (current label) | Pane | Worktree | Issue | Status |
| --- | --- | --- | --- | --- |
| `datasets-chain-2` | `w1:p9C` | `832-datasets-host-pinning` | #832→#833→#836 | building #832 (host-pinning violation logging), #833/#836 not started |
| `dep-cycle-2` | `w1:p98` | `834-jobs-settings-cycle` | #834 | building, task 1/4 |
| `settings-ui-scanner-relay` | `w1:p99` | `835-scanner-reserved-paths` | #835 | building |
| `sports-cleanup-2` | `w1:p9A` | `837-sports-postmerge-cleanup` | #837 | building (plan approved, 3 tasks) |

**No merges yet** — `merges_since_relay` still 0, nothing has reached Phase 3 (verify & merge).
No escalations outstanding.

Persistent Monitors re-established this session:
1. Fleet liveness: diff `herdr pane list` for `tab_id == 'w1:t1B'`, emit on `agent_status` change
   per pane.
2. Sports-broadsheet watch (below) — Ben explicitly asked to be kept apprised.

**Separate, non-fleet item to watch (Ben asked explicitly):** pane `w1:p8Y` (label none, worktree
`829-sports-broadsheet`, branch `worktree-829-sports-broadsheet`, model "Fable 5") is an
**already-running, independent** build agent NOT part of this manifest — idle at last observation.
Ben wants status changes surfaced to him. Watched via persistent background Monitor polling
`herdr pane list` for this pane's `agent_status`, emitting only on change.
`837-sports-postmerge-cleanup`'s handoff doc already warns that build agent about this other one
running concurrently (both touch sports files, but different scopes) — no action needed there
beyond the watch.

**Explicitly excluded from this run (Ben's call):** sports issues #840/#841/#842/#845 (standings/
headline follow-ups) — do NOT queue these tonight.
