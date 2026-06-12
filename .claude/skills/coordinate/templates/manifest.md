# Coordination Run — <run-id>

**Date:** <YYYY-MM-DD>
**Coordinator lock:** label `Coordinator` = pane `<pane-id>` (single-coordinator lock — exactly one pane holds this label for the life of the run; agents escalate to the **label** (routing), the coordinator merges only when its own `$HERDR_PANE_ID` matches this recorded **pane-id** (authority))
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/<slug>.md | #NN | routine\|sensitive\|security | queued | — | — | — | — |

Risk tier (content triggers, set at Phase 0 — see `coordinate` Risk tiering):
- `routine` — no schema/auth/secret surface → auto-merge after green QA.
- `sensitive` — shared-table migration / cross-module contract / export-delete / job-payload shape → auto-merge + Ben digest.
- `security` — auth/sessions/tokens/RLS/secrets/rate-limit/network-exposed/policy migration → cross-model Opus QA + `gh pr comment` verdict + **Ben merge sign-off**.

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `qa-failed`/`rework` → `awaiting-ben-signoff` (security) → `merged`
(or `handed-off` when relayed to a fresh session).

## Dependency / merge order

- **Parallel group 1:** <specs with no collisions — launch together>
- **Serialized chain A:** <spec-1> → <spec-2>  (reason: shared migration ordering / shared table / shared module)
- **Merge order:** <explicit order PRs land in `main`>

## CI waivers

A red required check merges ONLY if waived here. Each waiver: check name + the SHA it's proven
failing on `origin/main` at + the proof + **Ben-approved (y/date)**. A check failing twice =
stop-the-line + file an issue (no waiver).

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

## Outstanding escalations

- [ ] <blocker / design-fork awaiting coordinator or Ben — who owns it, since when>

## Reaped sessions

- <pane id / label — spent agent killed, when, why (done | handed-off)>
