# Coordination Run — 2026-06-18-deploy-readiness

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `ec808db4-8b97-48fb-9130-07e7d726634b`** (match `agent_session.value` in `herdr pane list`; pane `w1:p10`, tab `w1:t7`). _Authority transferred 2026-06-18 from the relaying Codex coordinator (session `019edcbd-30fe-7d71-9e48-ded1258b8d98`, old pane `w1:p1J`) to this Claude successor; old pane retired._ Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap — do not trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 1 (security-tier merge #312 → relay NOW per threshold)
**last_alive:** 2026-06-19T01:10Z (Claude coordinator `ec808db4…` — relaying)
**Gate serialization policy (2026-06-18):** run mechanical gates ~1–2 at a time. Concurrent
`verify:foundation` runs collide on cluster-global role grants → false-RED "tuple concurrently
updated", EVEN with isolated `JARVIS_PGDATABASE` (db:migrate grants touch shared `pg_authid`).
Gating agents instructed to RETRY verify:foundation on that signature. Gate-runners must run on a
clean worktree (stray untracked `.md` breaks format:check) and ensure their isolated DB exists
(db:migrate does not create it). See agentmemory `mem_mqk7fojw`.
**ci_status:** unavailable — `gh pr checks` reports no checks on deploy branches (GitHub Actions not the gate this run); judge merge-readiness off local CI-equivalent evidence per Ben's standing approval; security tier still needs per-merge Ben sign-off.
**Continuation note (RELAY 2026-06-19T01:10Z — Claude coordinator `ec808db4…` relaying after the
security-tier merge of #312, per the no-deferral relay threshold):**

SUCCESSOR FIRST STEPS: (1) claim the `Coordinator` label on your own pane, (2) re-confirm this lock
line then **rewrite the authority anchor to YOUR Claude session id**, (3) **close my pane `w1:p10`**
(the old coordinator) after verifying its session is `ec808db4…`, (4) re-adopt the live fleet below.
**Use Claude for any NEW build/QA agents until the Codex 5-h window resets.** `ci_status: unavailable`
— judge merge-readiness off local CI-equivalent evidence; **no security-tier merge without Ben
sign-off** (Ben has standing approval of the CI-equivalent gating policy).

REMAINING BOOKKEEPING (deferred to you per no-deferral rule):
- **#312/#255: move the board item to Done** (merge + issue-close already done). Phase-2 epic is #47.

LIVE FLEET (resolve panes fresh by label; numbers reflow):
- `Fix-313-RolePw` (`w1:p21`, Claude) — WORKING. Implementing approved 1-line `decodeURIComponent`
  fix + TDD for the role-password percent-encoding bug (real defect). On report (VF/AUDIT exit codes
  + head SHA): spawn **security re-QA (Opus)** on PR #313, post verdict, then Ben sign-off. Failure
  budget 1/2 used.
- `Gate-314-RateLimit` (`w1:p23`, Claude) — WORKING. CI-equiv re-gate of PR #314 (review already
  CLEAN, 0 blocking; prior RED was env grants-contention). On GREEN gate report → Ben sign-off.
  Non-blocking spec-drift note `rate-limit-key.ts:52` (malformed-bearer→cookie vs spec ip; no
  fresh-bucket bypass) — surface to Ben at sign-off.
- `Build-237-Sessions` (`w1:p1S`, Claude) — DONE/standby. #315 rebased to `4271bb6` (grounded, 0
  behind). **Spawn #315 security re-QA (Opus) grounded on 4271bb6**, post updated verdict to PR #315,
  then Ben sign-off. Non-blocking: cookie-session current-id path `session-service.ts:62` untested —
  may task Build-237 to add the me-sessions test if Ben wants it pre-merge.
- `w1:p1N` (Claude, idle, unlabelled, on `ui-improvement-plan` in shared tree) — UNIDENTIFIED; asked
  Ben whether to reap. Do not close blindly.

PENDING SIGN-OFFS (all security tier, all need Ben): #313 (after fix+re-QA), #314 (after green
gate), #315 (after grounded re-QA). Then serialized successors per chains B/C and the held queue
(#114, #123, #230, #236, #254, #306).

GATE DISCIPLINE: serialize mechanical gates ~1–2 at a time; retry verify:foundation on "tuple
concurrently updated" (cluster-global grants contention — see agentmemory `mem_mqk7fojw`); gate-runners
need a clean worktree + a pre-existing isolated DB. Per-merge digest: **#312 host-diagnostics → MERGED,
security, VF_EXIT=0/AUDIT_EXIT=0 @ b4b61e5, Ben-signed.**

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
| `docs/superpowers/specs/2026-06-18-route-local-junk-credential-rate-limit-gates.md` | #207  | security  | review CLEAN; RED was env (grants contention) — needs clean re-gate | Build-207-RateLimit (reaped) | — | deploy-207-rate-limit | #314 |
| `docs/superpowers/specs/2026-06-18-otnr-p3-ai-gateway-residual-hardening.md`        | #123  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-people-access-approval-revoke-sessions.md`       | #230  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-active-sessions-list-revoke.md`                  | #237  | security  | review CLEAN; RED was stale branch (behind 1) — Build-237 rebasing, then re-QA | Build-237-Sessions | w1:p1S | deploy-237-active-sessions | #315 |
| `docs/superpowers/specs/2026-06-18-account-card-real-status.md`                     | #236  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`                    | #255  | security  | **MERGED** (squash @ 2026-06-19T00:47Z, Ben sign-off). Issue closed. **Board move to Done still TODO (successor).** | — (reaped) | — | (deleted) | #312 |
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
- [ ] #314 security QA review **CLEAN** (0 blocking; 1 non-blocking spec-drift `rate-limit-key.ts:52`
      malformed-bearer→cookie vs spec ip, no fresh-bucket bypass). RED was env grants-contention only.
      Clean re-gate running as `Gate-314-RateLimit` (`w1:p23`, Claude) on current branch. After GREEN
      gate → Ben sign-off. Failure budget: 0 real code failures.
- [ ] #315 security QA review **CLEAN** (invariants ok; 1 non-blocking: cookie-session current-id
      path `session-service.ts:62` untested). RED was stale-branch only; Build-237 rebased to `4271bb6`
      (0 behind, grounded). **Re-QA queued for next clear gate window** (Opus, grounded on 4271bb6;
      post updated verdict to PR #315). After GREEN → Ben sign-off.
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
- `Gate-312-HostDiag` (`w1:p22`, Claude) — CI-equiv gate-runner; GREEN (VF_EXIT=0/AUDIT_EXIT=0 @
  b4b61e5), posted to PR #312, reaped.
- `QA-314-RateLimit` (`w1:p1Y`, codex) — reaped after CLEAN review verdict posted to PR #314; worktree
  `.claude/worktrees/qa-314-rate-limit` removed.
- `QA-315-Sessions` (`w1:p1Z`, codex) — reaped after CLEAN review verdict posted to PR #315; worktree
  `.claude/worktrees/qa-315-active-sessions` removal hit permission error (codex-owned), left for cleanup.
