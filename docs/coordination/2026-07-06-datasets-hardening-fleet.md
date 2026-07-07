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
| docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation follow-up, #798) | #834 | sensitive | building | dep-cycle-2 | w1:p98 | 834-jobs-settings-cycle | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md | #835 | routine | building | settings-ui-scanner-relay | w1:p99 | 835-scanner-reserved-paths | — |
| docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md | #837 | routine | building (relaying) | sports-cleanup | w1:p97 | 837-sports-postmerge-cleanup | — |

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

## Continuation note (relay @ 2026-07-06, context hit 70%)

**Coordinator lock:** this relay's anchor is session `6b766f7c-577d-4e32-b5b8-b441e6788036`
(pane `w1:p80`) — about to spawn successor in the SAME pane/tab (not the agents tab). Update the
lock line at the top of this file to the successor's session id once confirmed driving.

**Phase 1 done**, Phase 2 (supervise) IN PROGRESS. Fleet state as of this relay, all in `w1:t1B`:

| Agent (current label) | Pane | Worktree | Issue | Status |
| --- | --- | --- | --- | --- |
| `datasets-chain` | `w1:p94` | `832-datasets-host-pinning` | #832→#833→#836 | plan for #832 approved, building |
| `dep-cycle-2` (relay successor) | `w1:p98` | `834-jobs-settings-cycle` | #834 | plan approved, resuming task 1/4, confirmed driving |
| `settings-ui-scanner-relay` (relay successor) | `w1:p99` | `835-scanner-reserved-paths` | #835 | plan approved, confirmed driving, not yet started coding |
| `sports-cleanup` | `w1:p97` | `837-sports-postmerge-cleanup` | #837 | plan approved (3 tasks), **relaying now — successor not yet confirmed, this is the successor's first job** |

**Successor's first job:** `sports-cleanup` (`w1:p97`) messaged that it hit 77% context and is
relaying after plan approval, before coding started. Watch for its "successor confirmed driving,
safe to reap" message (may already be in-flight); when it lands, do the normal relay-ack
(bounded pane read to confirm the new pane's session id + status, close `w1:p97`, update the
Queue table + Reaped-sessions section below with the new label/pane/session — follow the exact
pattern already used for the `dep-cycle`→`dep-cycle-2` and `settings-ui-scanner`→
`settings-ui-scanner-relay` relays recorded in Reaped sessions).

**Second successor job, arrived same instant as this relay:** `datasets-chain` (`w1:p94`) also just
announced a relay — context hit 70% mid Task 1/2 of TDD on #832 (approved plan), no PR yet. Its
"no action needed from you yet" means it's self-relaying without waiting for an ack; watch for its
successor pane in `w1:t1B` (label will likely be `datasets-chain-2` or similar), do the standard
relay-ack (bounded read confirming session id + status), reap `w1:p94`, update Queue + Reaped
sessions.

**No merges yet** — `merges_since_relay` still 0, nothing has reached Phase 3 (verify & merge).
All 4 lanes are still mid-build on their first (or in datasets-chain's case, first-of-three)
plan. No escalations outstanding beyond the sports-cleanup relay above.

Persistent Monitors from the prior session do NOT survive this relay — re-establish both:
1. Fleet liveness: diff `herdr pane list` for `tab_id == 'w1:t1B'`, emit on `agent_status` change
   per pane (see Reaped-sessions history above for the pattern already proven out this run).
2. Sports-broadsheet watch (below) — Ben explicitly asked to be kept apprised.

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
