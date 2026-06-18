# Coordination Run — 2026-06-18-deploy-readiness

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Codex session id `019edcbd-30fe-7d71-9e48-ded1258b8d98`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap — do not trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> Coordinator memory for the deploy-readiness RFA queue in
> `docs/coordination/2026-06-18-deploy-readiness-rfa-order.md`. GitHub is source of truth for
> issue/board state; this file tracks operational state only.

## Phase 0 Readiness

- Coordinator lock: claimed; exactly one Herdr pane labelled `Coordinator`.
- Codex usage watch: self pane read on 2026-06-18 showed `5h 27% left`. If this drops near zero
  before the Codex 5-hour window resets, hand off coordination to a Claude coordinator in the same
  Herdr tab and instruct it to spawn/use Claude build and QA agents until Codex resets.
- Main gate: **blocked**. Ben's wrap-up reports local `pnpm verify:foundation` exit 1 from briefing
  worker timeouts in `tests/integration/briefings-synthesis.test.ts` and
  `tests/integration/briefings.test.ts`; `pnpm audit:release-hardening` exit 0.
- Checkout note: coordinator pane is currently on branch `ui-improvement-plan` at `adf957b`; `origin/main` is `32b898f`.
- Spec gate: cleared locally by restoring seven approved deploy-readiness specs from reflog commit
  `45f46f9d63add32bed0def5077042aee7ad78b55` after they were dropped from refs.
- Spawn policy: **do not spawn deploy feature agents** until the briefing timeout gate is fixed and
  the integrated gate is green. A narrow `gate-fix-briefings` agent may run first to restore the
  green baseline.

## Queue

| Spec                                                                                | Issue | Tier      | Status                                  | Agent label | Pane | Branch | PR  |
| ----------------------------------------------------------------------------------- | ----- | --------- | --------------------------------------- | ----------- | ---- | ------ | --- |
| `docs/superpowers/specs/2026-06-18-otnr-p1-bootstrap-role-passwords.md`             | #117  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-otnr-p2-secrets-vault-residuals.md`              | #114  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-route-local-junk-credential-rate-limit-gates.md` | #207  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-otnr-p3-ai-gateway-residual-hardening.md`        | #123  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-people-access-approval-revoke-sessions.md`       | #230  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-active-sessions-list-revoke.md`                  | #237  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-account-card-real-status.md`                     | #236  | security  | queued: held for green gate             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`                    | #255  | security  | queued: held for green main             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-connector-health-monitoring.md`                  | #254  | sensitive | queued: held for green main             | —           | —    | —      | —   |
| `docs/superpowers/specs/2026-06-18-phase-2-deploy-checkpoint-final-gate.md`         | #306  | manual    | blocked: final gate after prerequisites | —           | —    | —      | —   |

## Dependency / Merge Order

- **Hard blockers before deploy feature spawn:** green integrated gate; briefing timeout fix.
- **Serialized security chain A:** #117 → #114. Reason: deployment secret/bootstrap hardening should land before adjacent secret/vault residual work.
- **Serialized security chain B:** #207 → #123. Reason: shared auth/token/rate-limit/MCP/AI tool surface; #123 depends on token-launch hardening not fighting rate-limit policy changes.
- **Serialized account/session chain C:** #237 → #230 → #236. Reason: #230 exposes admin revoke sessions UI and #236 may link to real active sessions if #237 has landed.
- **Ops chain D:** #255 can run independently once `main` is green; #254 can run independently but lands after any connector/secret residual if #114 changes shared connector secret guards. #255 and #254 both touch admin settings UI; serialize unless handoffs assign non-overlapping files or the agents coordinate `apps/web/src/settings/settings-admin-panes.tsx`.
- **Final manual gate:** #306 runs only after Phase 1 prerequisite stack is merged and deployed.
- **Preferred merge order:** #117, #114, #207, #123, #237, #230, #236, #255, #254, then #306 manual acceptance.

## CI Waivers

No waivers.

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding Escalations

- [ ] Briefing integration timeout gate is red; dispatch `gate-fix-briefings` before deploy feature
      lanes.
- [ ] #306 is manual-acceptance only; no build agent should be spawned for it.

## Reaped Sessions

- <none>
