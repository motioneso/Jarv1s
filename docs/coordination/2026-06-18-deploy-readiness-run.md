# Coordination Run — 2026-06-18-deploy-readiness

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Codex session id `019edd71-d7fa-7d23-894d-c00bf8ed98ee`** (match `agent_session.value` in `herdr pane list`; pane `w1:p26`, tab `w1:t7`). _Authority transferred 2026-06-19 from the relaying Claude coordinator (session `eaadc7f5-27f0-4128-909b-55134bba34e2`, old pane `w1:p24`) to this Codex successor; old pane retired. Earlier: 2026-06-19 from relaying Claude coordinator `ec808db4-8b97-48fb-9130-07e7d726634b`; 2026-06-18 from relaying Codex coordinator `019edcbd-30fe-7d71-9e48-ded1258b8d98`._ Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap — do not trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time. Agents escalate to the **label**; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**⚠️ ALL NEW AGENTS = CODEX (Ben directive 2026-06-19, supersedes the Claude-fallback note):** spawn
**every** new agent — build, gate-runner, QA, and the coordinator successor — as **Codex**
(`codex -s danger-full-access -a never "<boot>"`), NOT Claude, until Codex hits a usage window (then
fall back to Claude). The Codex 5-h window is back. Security-tier QA via Codex = genuine cross-model
adversarial coverage (satisfies the cross-model requirement). NEW QA spawns use the Herdr path
(`herdr agent start "QA-..." --tab <agents-tab> -- codex -s danger-full-access -a never "<qa prompt>"`)
since the native `Agent(model:opus)` path is Claude-only. Currently-running Claude lanes (Fix-313,
Gate-314, Build-237) finish as-is — do not kill warm work; only NEW spawns are Codex.
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0 (reset by Codex successor after adopting the #314 security-merge relay)
**last_alive:** 2026-06-19T01:46Z (Codex coordinator `019edd71…` — #313/#315 rebased pushes complete; #313 fresh re-QA running)
**Gate serialization policy (2026-06-18):** run mechanical gates ~1–2 at a time. Concurrent
`verify:foundation` runs collide on cluster-global role grants → false-RED "tuple concurrently
updated", EVEN with isolated `JARVIS_PGDATABASE` (db:migrate grants touch shared `pg_authid`).
Gating agents instructed to RETRY verify:foundation on that signature. Gate-runners must run on a
clean worktree (stray untracked `.md` breaks format:check) and ensure their isolated DB exists
(db:migrate does not create it). See agentmemory `mem_mqk7fojw`.
**⚠️ KEEP GITHUB ISSUES UPDATED (Ben directive 2026-06-19):** as each agent finishes a slice, update
its linked GitHub issue — post a progress comment at key transitions (PR ready-for-QA, QA verdict,
merge) and CLOSE the issue at merge. GitHub is source of truth; do not let issues drift behind the
agents. Issue↔PR map: #117↔#313, #207↔#314, #237↔#315, #236, #230, #123, #114, #254, #255↔#312 (closed).
**ci_status:** unavailable — `gh pr checks` reports no checks on deploy branches (GitHub Actions not the gate this run); judge merge-readiness off local CI-equivalent evidence per Ben's standing approval; security tier still needs per-merge Ben sign-off.
**Continuation note (RELAY 2026-06-19T01:11Z — Claude coordinator `eaadc7f5…` relaying after the
security-tier merge of #314, per the no-deferral relay threshold). SUCCESSOR MUST BE CODEX (Ben
directive — see ALL NEW AGENTS = CODEX above).**

SUCCESSOR FIRST STEPS (you are a CODEX coordinator): (1) claim the `Coordinator` label on your own
pane (`herdr pane rename <your-pane> Coordinator`); verify exactly one `Coordinator` pane = you.
(2) re-confirm this lock line then **rewrite the authority anchor to YOUR Codex session id**
(`agent_session.value` for your pane in `herdr pane list`). (3) **close my pane** (the relaying Claude
coordinator `eaadc7f5…`) after verifying its session id — resolve it fresh by label `Coordinator`
before I rename, or by session id `eaadc7f5…`. (4) re-adopt the live fleet below; confirm you are
driving. `ci_status: unavailable` — judge merge-readiness off local CI-equivalent evidence; **no
security-tier merge without Ben's explicit per-merge sign-off** (Ben has standing approval of the
CI-equivalent gating policy). **Update each finished issue with a merge-ref comment + close it.**

DONE THIS SESSION (Claude `eaadc7f5…`):
- Adopted authority from `ec808db4…`; closed old pane `w1:p10`; lock anchor rewritten to me.
- **#312/#255 board → Done**: verified already Done (project 2 "Issue and Roadmap Work", auto on close).
- **#314/#207 MERGED** (squash `b0c59ef` @ 01:09Z, Ben sign-off). Security tier. Independent review
  CLEAN + independent CI-equiv gate GREEN on integrated result (rebased clean onto post-#312 main,
  HEAD `6692f31`, VF=0/AUDIT=0/840 passed). Issue #207 closed w/ merge-ref comment; board auto-Done;
  Gate-314 worktree+branch+pane reaped. Non-blocking followup noted in the issue:
  `rate-limit-key.ts:52` malformed-bearer→cookie fallback (QA confirmed NO fresh-bucket bypass).
- `w1:p1N` skill-hardening session: committed its 7 `.claude/skills/` files as `48577ef` (by Ben's
  decision), pane reaped.
- **Uncommitted in shared tree (`ui-improvement-plan`)**: my manifest edits to THIS file +
  `docs/coordination/wellness-design-2026-06-15.md` (M) + `docs/superpowers/specs/2026-06-18-wellness-adversarial-remediations.md` (??).
  Ben says all are known committable session work (no foreign surprises) — I commit them by explicit
  path as part of this relay flush. If still uncommitted when you read this, commit them by path.

LIVE FLEET (resolve panes fresh by label; numbers reflow):
- `QA-313-RolePw` (Codex, spawned `w1:p25`, Agents tab `w1:t8`) — GREEN on #313 security re-QA
  for PR #313 / branch `deploy-117-role-passwords` HEAD `3c8d0c7` (detached worktree
  `.claude/worktrees/qa-313-rolepw`, `JARVIS_PGDATABASE=jarvis_qa_313`). Verdict posted to PR #313:
  VF_EXIT=0, AUDIT_EXIT=0, no blocking findings, merge-ready. Issue #117 updated. Ben sign-off
  received 2026-06-19. However #314 landed after that verdict; coordinator locally rebased #313 onto
  current `origin/main` (`b0c59ef`) as new HEAD `159c447`, pushed to PR #313, and `pnpm vitest run
  tests/unit/role-bootstrap.test.ts` passed 7/7. Fresh Codex re-QA is RUNNING (`QA-313-RolePw-ReQA`,
  w1:p29, detached worktree `.claude/worktrees/qa-313-rolepw-reqa`, DB `jarvis_qa_313_reqa`). Merge
  if GREEN, then reap QA-313 panes/worktrees.
- `Fix-313-RolePw` (`w1:p21`, Claude) — DONE/standby in `.claude/worktrees/deploy-117-role-passwords`.
  Fix landed: `role-bootstrap.ts` now `decodeURIComponent(url.password)` (reserved chars @ : / %
  round-trip), TDD red→green +1 unit test, VF=0/AUDIT=0, rebased on main HEAD `3c8d0c7`, PR #313
  updated. Owning agent for any QA-313 re-fix. Reap after #313 merges.
- `Build-237-Sessions` (`w1:p1S`, Claude) — DONE/standby in `.claude/worktrees/deploy-237-active-sessions`.
  #315 locally rebased onto current `origin/main` (`b0c59ef`) by dropping stale docs commits and
  cherry-picking the feature commit; new local HEAD `7d2b989`, `@jarv1s/module-registry` typecheck
  green. Push to GitHub is blocked by DNS (`Could not resolve host: github.com`); after push, spawn
  fresh Codex security re-QA and post updated verdict to PR #315, then Ben sign-off. Non-blocking:
  cookie-session current-id path
  `session-service.ts:62` untested — may task Build-237 to add the me-sessions test if Ben wants it
  pre-merge. Owning agent for any #315 re-fix; reap after #315 merges.

GATE SERIALIZATION RIGHT NOW: fresh QA-313 is running on `159c447`; #315 is pushed at `7d2b989` and
queued for fresh Codex re-QA after #313 to keep local gates serialized.

PENDING SIGN-OFFS (all security tier, all need Ben): #313 has Ben sign-off but needs fresh post-rebase
Codex re-QA before merge; #315 needs grounded CODEX re-QA then Ben sign-off. Then serialized successors per chains A/B/C and the held queue (#114, #123, #230, #236,
#254, then #306 manual). Preferred merge order: #117(#313), #114, #207(#314 ✅done), #123, #237(#315),
#230, #236, #255(#312 ✅done), #254, then #306.

GATE DISCIPLINE: serialize mechanical gates ~1–2 at a time; retry verify:foundation on "tuple
concurrently updated" (cluster-global grants contention — see agentmemory `mem_mqk7fojw`); gate-runners
need a clean worktree + a pre-existing isolated DB. Per-merge digest:
- **#312 host-diagnostics (#255) → MERGED**, security, VF=0/AUDIT=0 @ b4b61e5, Ben-signed.
- **#314 rate-limit gates (#207) → MERGED** squash `b0c59ef` @ 2026-06-19T01:09Z, security, VF=0/AUDIT=0
  on integrated result `6692f31`, Ben-signed. Issue closed; board auto-Done.

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
| `docs/superpowers/specs/2026-06-18-otnr-p1-bootstrap-role-passwords.md`             | #117  | security  | Ben sign-off received; rebased/pushed to `159c447`; fresh CODEX re-QA RUNNING (`QA-313-RolePw-ReQA`, w1:p29) | Fix-313-RolePw      | w1:p21 | deploy-117-role-passwords | #313 |
| `docs/superpowers/specs/2026-06-18-otnr-p2-secrets-vault-residuals.md`              | #114  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-route-local-junk-credential-rate-limit-gates.md` | #207  | security  | **MERGED** (squash `b0c59ef` @ 01:09Z, Ben sign-off). Issue closed; board Done. | — (reaped) | — | (deleted) | #314 |
| `docs/superpowers/specs/2026-06-18-otnr-p3-ai-gateway-residual-hardening.md`        | #123  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-people-access-approval-revoke-sessions.md`       | #230  | security  | queued: held for green gate             | —                   | —      | —                           | —    |
| `docs/superpowers/specs/2026-06-18-active-sessions-list-revoke.md`                  | #237  | security  | rebased/pushed to `7d2b989`; fresh CODEX re-QA queued after #313 | Build-237-Sessions | w1:p1S | deploy-237-active-sessions | #315 |
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
- [ ] #313 prior security QA was RED (decode bug). **FIX LANDED** by `Fix-313-RolePw`:
      `role-bootstrap.ts` now `decodeURIComponent(url.password)`, TDD red→green +1 unit test, VF=0/AUDIT=0,
      rebased on main HEAD `3c8d0c7`, PR #313 updated. **CODEX re-QA GREEN** (`QA-313-RolePw`, w1:p25,
      worktree `.claude/worktrees/qa-313-rolepw`, ground `3c8d0c7`) — verdict posted to PR #313
      (VF_EXIT=0, AUDIT_EXIT=0, no blocking findings, merge-ready). Ben sign-off received 2026-06-19.
      Because #314 landed after that verdict, coordinator rebased #313 onto current `origin/main`
      (`b0c59ef`) as HEAD `159c447`, pushed it, and `pnpm vitest run
      tests/unit/role-bootstrap.test.ts` passed 7/7. Fresh Codex re-QA is running; merge if GREEN.
- [x] #314 security QA review **CLEAN**; clean re-gate GREEN on integrated result (`6692f31`, VF=0/AUDIT=0).
      **MERGED** squash `b0c59ef` @ 01:09Z with Ben sign-off; issue #207 closed + board Done; Gate-314 reaped.
      Non-blocking spec-drift `rate-limit-key.ts:52` (malformed-bearer→cookie, no fresh-bucket bypass)
      recorded in the issue as a followup.
- [ ] #315 security QA review **CLEAN** (invariants ok; 1 non-blocking: cookie-session current-id
      path `session-service.ts:62` untested). RED was stale-branch only; Build-237 rebased to `4271bb6`
      before #314 merged. Coordinator locally rebased #315 onto current `origin/main` (`b0c59ef`):
      new HEAD `7d2b989`, stale docs commits dropped, one trivial import conflict resolved,
      `@jarv1s/module-registry` typecheck green, and pushed. Spawn fresh Codex re-QA after #313,
      post updated verdict to PR #315. After GREEN → Ben sign-off.
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
- `Gate-314-RateLimit` (`w1:p23`, Claude) — CI-equiv gate-runner; rebased #314 on integrated main +
  re-gated GREEN (VF=0/AUDIT=0 @ `6692f31`), posted to PR #314; reaped after #314 merged; worktree
  `.claude/worktrees/deploy-207-rate-limit` removed + branch deleted.
- `w1:p1N` skill-hardening session (`200d1a20`, Claude) — committed its 7 `.claude/skills/` files as
  `48577ef` (Ben's decision), then pane reaped 2026-06-19.
- Claude coordinator (`eaadc7f5…`, pane `w1:p24`/`w1:t7`) — relayed 2026-06-19T01:11Z to a CODEX
  successor after the #314 security-tier merge; reaped by successor.
