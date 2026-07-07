# Coordination Run — 2026-07-06-datasets-hardening-fleet

**Date:** 2026-07-06
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `f64fd971-3fad-4880-a2fd-6dbb7aba935e`** (pane `w1:p8S` at time of writing — resolve fresh by label+session, not this pane number).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; no `security`-tier items in this run.
**Relay threshold:** routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> Externalized coordinator memory. GitHub is the source of truth for spec/issue/board status;
> this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #832 | routine | queued | datasets-chain | — | 832-host-pinning-log | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #833 | sensitive | queued | datasets-chain | — | 833-redirect-headers | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #836 | routine | queued | datasets-chain | — | 836-redirect-cachekey | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation follow-up, #798) | #834 | sensitive | queued | dep-cycle | — | 834-jobs-settings-cycle | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md | #835 | routine | queued | settings-ui-scanner | — | 835-scanner-reserved-paths | — |
| docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md | #837 | routine | queued | sports-cleanup | — | 837-sports-postmerge-cleanup | — |

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

- [ ] none yet

## Reaped sessions

- none yet
