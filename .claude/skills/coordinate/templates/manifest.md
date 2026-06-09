# Coordination Run — <run-id>

**Date:** <YYYY-MM-DD>
**Coordinator label:** <herdr label of the live coordinator pane>
**Merge policy:** autonomous-after-verified-QA (coordination mode)
**Context self-handoff threshold:** ~70%

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Spec | Issue | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/<slug>.md | #NN | queued | — | — | — | — |

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `merged` (or `handed-off` when relayed to a fresh session).

## Dependency / merge order

- **Parallel group 1:** <specs with no collisions — launch together>
- **Serialized chain A:** <spec-1> → <spec-2>  (reason: shared migration ordering / shared table / shared module)
- **Merge order:** <explicit order PRs land in `main`>

## Outstanding escalations

- [ ] <blocker / design-fork awaiting coordinator or Ben — who owns it, since when>

## Reaped sessions

- <pane id / label — spent agent killed, when, why (done | handed-off)>
