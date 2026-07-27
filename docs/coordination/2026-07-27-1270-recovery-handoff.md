# Handoff — #1270 recovery branch + live-path gate (2026-07-27)

Pointer-style. Details live in the commits, the spec, and agentmemory — not here.

## Done and pushed to `main`

- `818bf2c0` — **live-path gate adopted** (Ben ruled 2026-07-27). Hard invariant in `CLAUDE.md`,
  full rule in `docs/DEVELOPMENT_STANDARDS.md` → Live-Path Gate, pre-merge check in
  `.claude/skills/coordinate/SKILL.md` that overrides every tier's auto-merge-after-green.
  Same commit corrected two stale statuses (below).
- `bcfcabe3` — replaced the nonexistent `herdr agent send` with `herdr agent prompt` in
  `docs/agents/herdr-pane-message.md` + the coordinate skill.
- Three #1270 spec commits (`eaaf75c5` and earlier).

## Resolved, needs no further action

- **Voice/STT spec was never actually pending.** Issue #874 closed *completed* 2026-07-09 and the
  feature is on `main` (`apps/web/src/settings/settings-voice-config-group.tsx`,
  `packages/ai/src/voice-endpoint-routes.ts`). Only its status line was stale; corrected.
  Ben's "make sure that spec has an issue" → it already has one.
- **`docs/coordination/AWAITING-BEN.md` has no open items.**
- **Rescue directory `~/jarvis-uncommitted-rescue-2026-07-26/` is closed** — do not re-triage.
  Verdict in agentmemory `rescue-patch-triage-2026-07-27`. Only live find became issue #1318.

## In flight — the recovery branch

`recover/1270-0719-settings-onboarding` at **`/home/ben/jarvis-recover-1270`** (separate worktree;
`/home/ben/Jarv1s` is the shared checkout — never `git add -A` there). 11 commits, rebased clean on
today's `main`. Recovers the 2026-07-19 settings/onboarding stack: **#1270 and #1271 are recoveries,
not new builds.**

- Ben approved the one behaviour-removing commit (`fdbe5f2e`, −296 lines, drops the #368 "Ask
  Jarvis" finish affordance).
- `e7876203` fixes the only gate failure — two stale assertions in
  `tests/integration/onboarding-provider-install.test.ts`. Background: agentmemory
  `onboarding-provider-allowlist`.
- **Gate:** first run was rc=1 on those two tests. Re-run in progress at checkpoint time; log at
  `/tmp/claude-1000/-home-ben-Jarv1s/3691cb7d-1069-47ff-8e46-76d18086f1b6/scratchpad/gate2.log`.
  Grep `### FINAL` for the real exit code — **do not trust a wrapper `echo $?`**, that masked the
  rc=1 once already this session. Gate DB is `jarv1s_recover_gate` (DROP/CREATE it before each run).

## Next steps, in order

1. Confirm `### FINAL verify:foundation rc=0` in the gate log.
2. Open the PR for the 11 commits, referencing #1270 and #1271.
3. **Satisfy the live-path gate on this very branch** — it is provider sign-in UI, so green is not
   enough. Write `tests/uat/specs/1270-provider-signin.uat.spec.ts` and run `pnpm test:uat 1270`,
   then post the run + screenshots as a `gh pr comment`. Harness details in agentmemory
   `e2e-dev-uat-for-ui-features`. Assert: Settings → Assistant & AI offers CLI sign-in for Claude,
   Codex, and Gemini (not Claude alone); the flow starts; the terminal copy affordance is present.
4. **Known limit to state honestly, not paper over:** a *real* Codex device code needs a real Codex
   CLI and network, which the ephemeral UAT stack does not have. The UAT can prove the surface is
   reachable and the flow starts. Ben confirming a real device code on his own dev instance is a
   separate, human step — flag it as such rather than claiming the gate is fully met.
5. Ben has still not approved the #1270 spec itself
   (`docs/superpowers/specs/2026-07-27-1270-provider-signin-shared-design.md`); #1271 stays open.

## Standing corrections earned this session

- Ben wants terse reporting. Lead with the result; no recaps, no option surveys.
- Never conclude "never built" from a `main`-only grep in this repo, and never conclude "not
  approved" from a spec status line — check whether the issue closed *completed* first.
