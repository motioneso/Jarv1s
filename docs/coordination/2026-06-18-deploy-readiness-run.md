# Coordination Run — 2026-06-18-deploy-readiness

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `ec808db4-8b97-48fb-9130-07e7d726634b`** (match `agent_session.value` in `herdr pane list`; pane `w1:p10`, tab `w1:t7`). _Authority transferred 2026-06-18 from the relaying Codex coordinator (session `019edcbd-30fe-7d71-9e48-ded1258b8d98`, old pane `w1:p1J`) to this Claude successor; old pane retired._ Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap — do not trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0
**last_alive:** 2026-06-19T00:30Z (Claude coordinator `ec808db4…`)
**ci_status:** unavailable — `gh pr checks` reports no checks on deploy branches (GitHub Actions not the gate this run); judge merge-readiness off local CI-equivalent evidence per Ben's standing approval; security tier still needs per-merge Ben sign-off.
**Continuation note:** Claude coordinator (`ec808db4…`) adopted the run 2026-06-18 from the relaying
Codex coordinator. Live fleet adopted: QA-313 (`w1:p1V`), QA-314 (`w1:p1Y`), QA-315 (`w1:p1Z`) all
codex/working; Build-237 (`w1:p1S`) done/standing-by. **Use Claude for any NEW build/QA agents until
the Codex 5-hour window resets.** Pending security work: #312 needs `gh pr checks`/comment/Ben sign-off;
#313/#314/#315 QA in flight (CI-unavailable local mode). No security-tier merge without Ben sign-off.

> Coordinator memory for the deploy-readiness RFA queue in
> `docs/coordination/2026-06-18-deploy-readiness-rfa-order.md`. GitHub is source of truth for
> issue/board state; this file tracks operational state only.

## Phase 0 Readiness

- Coordinator lock: claimed; exactly one Herdr pane labelled `Coordinator`.
- Codex usage watch: self pane read on 2026-06-18 showed `5h 27% left`. If this drops near zero
  before the Codex 5-hour window resets, hand off coordination to a Claude coordinator in the same
  Herdr tab and instruct it to spawn/use Claude build and QA agents until Codex resets.
- Codex usage watch update: self pane read later showed `5h 10% left`; coordinator relay to Claude is
  in progress.
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

| Spec                                                                                | Issue | Tier      | Status                                  | Agent label         | Pane   | Branch                      | PR   |
| ----------------------------------------------------------------------------------- | ----- | --------- | --------------------------------------- | ------------------- | ------ | --------------------------- | ---- |
| `docs/superpowers/specs/2026-06-18-otnr-p1-bootstrap-role-passwords.md`             | #117  | security  | qa-RED: fix lane re-opened (decode bug) | Fix-313-RolePw      | (spawning) | deploy-117-role-passwords | #313 |
| `docs/superpowers/specs/2026-06-18-otnr-p2-secrets-vault-residuals.md`              | #114  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-route-local-junk-credential-rate-limit-gates.md` | #207  | security  | qa                                      | Build-207-RateLimit | w1:p1R | deploy-207-rate-limit       | #314 |
| `docs/superpowers/specs/2026-06-18-otnr-p3-ai-gateway-residual-hardening.md`        | #123  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-people-access-approval-revoke-sessions.md`       | #230  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-active-sessions-list-revoke.md`                  | #237  | security  | qa                                      | Build-237-Sessions  | w1:p1S | deploy-237-active-sessions  | #315 |
| `docs/superpowers/specs/2026-06-18-account-card-real-status.md`                     | #236  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`                    | #255  | security  | GREEN verdict posted to PR; needs CI-equiv gate-runner + Ben sign-off | Build-255-HostDiag (reaped) | — | deploy-255-host-diagnostics | #312 |
| `docs/superpowers/specs/2026-06-18-connector-health-monitoring.md`                  | #254  | sensitive | queued: held for green main             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-phase-2-deploy-checkpoint-final-gate.md`         | #306  | manual    | blocked: final gate after prerequisites | —                   | —      | —                           | —    |

## Gate Fix Lane

| Scope                                     | Tier    | Status                                          | Agent label       | Pane   | Branch             | PR  |
| ----------------------------------------- | ------- | ----------------------------------------------- | ----------------- | ------ | ------------------ | --- |
| briefing integration timeout baseline fix | routine | complete: environment collision, no code change | GateFix-Briefings | w1:p1M | gate-fix-briefings | —   |

## Dependency / Merge Order

- **Hard blockers before deploy feature spawn:** cleared if feature agents use isolated `JARVIS_PGDATABASE` values. Briefing timeout root cause was shared `jarv1s` DB contention with a live `dev:worker`, not a code failure.
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

- [x] Briefing integration timeout gate investigated. Root cause was shared `jarv1s` DB contention
      with a live `dev:worker`; `JARVIS_PGDATABASE=jarv1s_gatefix pnpm test:briefings` passed 5x.
      Feature lanes must use isolated `JARVIS_PGDATABASE` values.
- [x] #312 security QA GREEN verdict posted to PR #312 (`#issuecomment-4747231184`) by Claude
      coordinator now that `gh` is reachable; `gh pr checks 312` = no checks (CI-unavailable).
      REMAINING before merge: (a) spawn a CI-equivalent gate-runner to produce GREEN
      `verify:foundation`+`audit:release-hardening` on the #312 merge result (QA did not run the
      mechanical gate locally), then (b) Ben's explicit security-tier merge sign-off.
- [ ] #313 security QA returned **RED** (`#issuecomment-4747228352`, grounded `3ca0767`). Blocking:
      `role-bootstrap.ts:51` percent-encoded password vs pg-decoded runtime connect. Fix lane
      re-opened as `Fix-313-RolePw` (Claude) in `deploy-117-role-passwords` per
      `docs/coordination/handoffs/2026-06-18-fix313-role-password-decode.md`. Re-QA after fix.
      (Failure budget: 1 of 2 used on this lane.)
- [ ] #314 security QA running in `QA-314-RateLimit` (`w1:p1Y`); `gh pr checks 314` reported no
      checks, so QA is using CI-unavailable local-verification mode.
- [ ] #315 security QA running in `QA-315-Sessions` (`w1:p1Z`); `gh pr checks 315` reported no
      checks, so QA is using CI-unavailable local-verification mode.
- [ ] #306 is manual-acceptance only; no build agent should be spawned for it.

## Reaped Sessions

- `GateFix-Briefings` (`w1:p1M`) — reaped after completing environment-collision diagnosis; worktree
  `.claude/worktrees/gate-fix-briefings` removed.
- `Build-255-HostDiag` (`w1:p1P`) — reaped after PR #312 done report; worktree retained until merge.
- `QA-312-HostDiag` (`w1:p1T`) — reaped after GREEN verdict saved; worktree retained until verdict
  can be posted to PR #312.
- `Build-117-RolePw` (`w1:p1Q`) — reaped after PR #313 done report; worktree retained until merge.
- `Build-207-RateLimit` (`w1:p1R`) — reaped after PR #314 done report; worktree retained until
  merge.
- `QA-313-RolePw` (`w1:p1V`) — reaped 2026-06-18 after RED verdict posted to PR #313; QA worktree
  `.claude/worktrees/qa-313-role-passwords` removal hit a permission error (codex-owned files), left
  in place for later cleanup.
- Codex coordinator (`019edcbd…`, old pane `w1:p1J`) — closed 2026-06-18 after authority transfer to
  Claude coordinator `ec808db4…`.
