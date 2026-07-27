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

## Done since

- **Gate green**, read from the log not a wrapper: `### FINAL verify:foundation rc=0`. Integration
  158 files / 1721 passed / 2 skipped; unit 442 files / 3382 passed.
- **PR #1323 open** — https://github.com/motioneso/Jarv1s/pull/1323. Body states plainly that the
  live-path gate is NOT yet met and the PR must not merge on green.
- **`068c16fc` adds `tests/uat/specs/1270-provider-signin.uat.spec.ts`** (12 commits now). Two
  tests: the wizard offers all three CLI providers; the Settings walk covers the authMethod
  passthrough, the real sign-in affordance, and the terminal copy button.

## Next steps, in order

1. Confirm the UAT run: log at `<scratchpad>/uat1270.log`, grep `### FINAL test:uat`. Screenshots
   land under `test-results/…/0*.png` in the worktree (the UAT config sets no `screenshot` option,
   so the spec captures five frames explicitly).
2. Post the run + screenshots as a `gh pr comment` on #1323 — that comment IS the gate artifact.
3. **Known limit to state honestly, not paper over:** a *real* Codex device code needs a real Codex
   CLI and network. The provisioned stack installs CLIs into an empty `/data/cli-tools` volume and
   leaves `JARVIS_HOST_CLIS` unset, so `cliAvailable` is false and the spec exercises the *fallback*
   sign-in path. Ben confirming a real device code on his own dev instance is a separate, human
   step — flag it as such rather than claiming the gate is fully met.
4. Ben has still not approved the #1270 spec itself
   (`docs/superpowers/specs/2026-07-27-1270-provider-signin-shared-design.md`); #1271 stays open.

## Selector facts the next session should not re-derive

- Wizard order is `welcome → cliAuth → connectors → finish`; advance with **"Start setup"**.
- Wizard provider labels are **Claude / Codex / Antigravity** — the `google` kind is NOT "Gemini".
- Settings nav: usermenu → *Settings & permissions* → *Admin / Setup* → *Assistant & AI*.
- Main's Settings picker **already** listed Anthropic/OpenAI/Google. `f5b44c52`'s Settings-side
  change is the per-entry `authMethod` passthrough (main hardcoded `"cli"` for every entry); the
  three-provider widening was the onboarding allowlist in `packages/settings/src/repository.ts`.
- `supportsAutomatedProviderLogin` requires `cliAvailable`, so "Log in"/"Re-authenticate" only
  render when a CLI binary is present; otherwise the CLI block shows "Use terminal to sign in".

## Standing corrections earned this session

- Ben wants terse reporting. Lead with the result; no recaps, no option surveys.
- Never conclude "never built" from a `main`-only grep in this repo, and never conclude "not
  approved" from a spec status line — check whether the issue closed *completed* first.
