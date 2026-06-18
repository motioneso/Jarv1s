# Coordination Run — 2026-06-18-overnight-automation

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Codex session id `019edb62-d2f6-77c0-b451-f8dae62ea049`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap; do not trust any pane number written in this file as an identifier. Agents escalate to the label; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; `security`-tier needs Ben's explicit merge sign-off.
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. Compaction summary = already past safe → relay, merge nothing.
**Additional context ceiling:** coordinator self-reads `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` after major events and before every spawn/merge wave. If the visible status line reports >= 500K used, flush this manifest, write the mid-doing continuation note, and relay before more work.
**merges_since_relay:** 1

> This is the coordinator's externalized memory. Keep it current. GitHub is the source of truth for issue/board status; this file holds in-flight operational state.

## Grounding

- `pnpm audit:preflight` passed on 2026-06-18: `HEAD=76568c7`, `origin/main@76568c7`, behind=0, ahead=0.
- Latest `main` CI was red before this run: `Verify foundation and app` failed on `tests/unit/ai-tmux-bridge.test.ts` because the test hard-coded a PDT date while CI runner local time is UTC.
- CI repair committed directly to `main`: `ff0ba95` (`test: make Codex transcript date expectation timezone-safe`).
- Manifest formatting committed to `main`: `0b39d7f` (`docs: format overnight automation manifest`).
- Onboarding provider-check isolation committed to `main`: `4eb41fe` (`test: isolate onboarding provider check from host auth`).
- Coordinator relay manifest flush committed to `main`: `4eaf647` (`docs: flush overnight automation state before relay`).
- CI repair pushed: Playwright smoke on `4eaf647` failed because `tests/e2e/app-shell.spec.ts`
  still looked for the old `Deny` action-request button after commit `46986c8` renamed the UI label
  to `Reject`. Fixed in `d8aa546`; local `pnpm test:e2e` passed 36/36.
- GitHub Actions is billing-blocked on `d8aa546`: run `27743608700` failed twice before runner
  assignment. All required jobs have zero steps and annotation: "The job was not started because
  recent account payments have failed or your spending limit needs to be increased. Please check the
  'Billing & plans' section in your settings".
- Ben approved using the local CI-equivalent gate while GitHub Actions is disabled.
- Successor coordinator claimed the lock on 2026-06-18 with Codex session id
  `019edb62-d2f6-77c0-b451-f8dae62ea049`; `herdr pane list` showed exactly one pane labelled
  `Coordinator`.
- Old relay coordinator pane was closed after matching label `Coordinator-RelayOld` plus Codex
  session id `019ed994-3159-7961-b750-f5c74c9c5fc3`.
- PR #303 (#297 recurrence JSONB boundary regression coverage) merged on 2026-06-18 at merge
  commit `2cbea96`; local gate evidence: `VF297_EXIT=0` with 67 unit files / 409 tests and 54
  integration files / 817 passed, 2 skipped.
- Local verification for CI repair:
  - `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts` green.
  - `TZ=UTC pnpm vitest run tests/unit/ai-tmux-bridge.test.ts` green.
  - `pnpm verify:foundation` green: 67 unit files / 402 tests; 54 integration files / 816 passed, 2 skipped.
- Local CI-equivalent gate on `d8aa546` passed 2026-06-18:
  - `pnpm verify:foundation` green: lint, format, file-size, typecheck, 67 unit files / 402 tests,
    migrations current, 54 integration files / 816 passed, 2 skipped.
  - `pnpm test:release-hardening` green: 17 tests.
  - `pnpm audit:release-hardening` green (`passed: true`).
  - `pnpm build:web` green.
  - `pnpm test:e2e` green: 36 passed.
  - `JARVIS_API_PORT=3099 JARVIS_WEB_PORT=5180 pnpm smoke:compose -- --api-port 3099` green.
  - Prod compose smoke green with local port override: `JARVIS_API_PORT=3099 JARVIS_WEB_PORT=5181
... pnpm smoke:compose:prod -- --api-port 3099`. First prod attempt only failed because local
    port `5173` was already occupied; rerun with `JARVIS_WEB_PORT=5181` passed.
- Local gate replaces GitHub Actions for this run until Actions billing/spending is restored.

## Decisions

- Fixed the CI test, not production code. Root cause: `transcriptGlobDir("openai-compatible")` intentionally uses host-local `Date#getFullYear/getMonth/getDate` because Codex writes session directories by local calendar date. The old test assumed PDT (`2026/06/17`) and failed correctly on UTC CI (`2026/06/18`).
- Fixed the onboarding provider-check integration test, not production code. Root cause: the route now intentionally shells out to `claude auth status` for Anthropic checks, while the test injected a fake chat engine that this code path no longer uses. The test now prepends a temporary fake `claude` executable to `PATH`, so CI does not depend on the runner's real Claude auth state.
- The first manifest push failed CI because the Markdown table was not Prettier-formatted; fixed by formatting-only commit `0b39d7f`.
- No agents spawn while `main` is red or while the repair run is still pending.
- Overnight scope stays inside the approved queue: #297, #299 mechanical/minor subsets, then #244. Security/design-question issues are excluded from unattended merge.

## Queue

| Spec / contract                                          | Issue | Tier      | Status                         | Agent label                                                    | Pane   | Branch                        | PR   |
| -------------------------------------------------------- | ----- | --------- | ------------------------------ | -------------------------------------------------------------- | ------ | ----------------------------- | ---- |
| CI repair: timezone-safe Codex transcript date test      | —     | routine   | pushed-to-main; local gate ok  | —                                                              | —      | main @ `ff0ba95`              | —    |
| CI repair: isolate onboarding provider-check test        | —     | routine   | pushed-to-main; local gate ok  | —                                                              | —      | main @ `4eb41fe`              | —    |
| Relay manifest flush                                     | —     | routine   | pushed-to-main; local gate ok  | —                                                              | —      | main @ `4eaf647`              | —    |
| CI repair: Approve/Reject e2e label                      | —     | routine   | pushed; local gate ok          | —                                                              | —      | main @ `d8aa546`              | —    |
| issue body: validate recurrence JSONB boundary           | #297  | routine   | merged                         | TasksRecurrence-297                                            | —      | main @ `2cbea96`              | #303 |
| issue body: #299 tasks-only mechanical subset after #297 | #299  | routine   | building                       | TasksMinors-299-Codex (`019edb87-3696-75b0-a87b-da944a54b02f`) | w1:p14 | overnight-299-tasks-minors    | —    |
| issue body: #299 settings/scripts/jobs mechanical subset | #299  | routine   | QA green; held for merge order | InfraMinors-299                                                | w1:p12 | overnight-299-infra-minors    | #302 |
| docs/superpowers/specs/2026-06-15-corrections-log.md     | #244  | sensitive | queued after lower-risk lanes  | Corrections-244                                                | —      | overnight-244-corrections-log | —    |

## Excluded / Held

- #299 design question about AI provider list route vs RLS widening: held for Ben/product-security decision.
- #260 owner/admin bootstrap: auth/admin surface plus unresolved policy choice; security-tier/design input.
- #238, #239, #237, #251, #252, #253: sessions/export/delete/auth/credentials/admin surfaces; not unattended.
- #218 chat session resumption: actionable but too broad for this cleanup batch without a tighter approved spec/handoff.

## Dependency / Merge Order

- First: CI repair must be green on the approved local CI-equivalent gate while GitHub Actions is disabled.
- Parallel group 1 after green main: #297 and #299 infra/settings/scripts subset can build in parallel if file collision scan confirms no overlap.
- Serialized tasks chain: #297 → #299 tasks subset. Reason: both touch tasks recurrence/contracts; #297 owns the recurrence JSONB boundary first.
- Final sensitive lane: #244 after lower-risk lanes. Reason: migration/shared memory lifecycle work; depends on #243 shared suppression store already landed as `0092`.
- Merge order: CI repair already on main → #297 → #299 tasks subset → #299 infra/settings/scripts subset → #244.

## CI Waivers

No waivers. Any red required check is stop-the-line unless proven red on `main` at same SHA and Ben-approved; Ben is signed off, so default is no waiver.

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding Escalations

- [x] Local CI-equivalent gate passed on `d8aa546`; GitHub Actions remains billing-blocked until Ben/account owner fixes billing/spending.

## Continuation Note

- **Relay reason:** coordinator self-read showed ~474K used at 2026-06-18 00:10 PDT, close to Ben's explicit 500K ceiling. Relay before spawning any build lanes.
- **Next action:** spawn #297 first and #299 infra/settings/scripts if collision scan still shows no overlap.
- **If local gate is green:** spawn #297 first and #299 infra/settings/scripts if collision scan still shows no overlap. Hold #299 tasks subset until #297 lands. Hold #244 until the lower-risk lanes are done.
- **If latest CI is red:** pull the exact failing job log and continue systematic debugging. Do not spawn the fleet on red `main`.
- **Untracked files in main worktree:** `docs/superpowers/handoffs/2026-06-18-onboarding-service-testing-webwright.md` and `docs/superpowers/specs/2026-06-15-corrections-log.md` existed before this run; do not sweep them with broad staging.

## Report

- Write `docs/coordination/overnight-report-2026-06-18.md` when queue is dry or stopped by a hard gate. Include commits/PRs, decisions made, verification, skipped items, and any issues left for Ben.

## Reaped Sessions

- `TasksMinors-299` Claude pane session `2f0178c2-b6c5-4208-ae1c-5b15999d4c63`: weekly-limit
  blocked before reading the handoff; replaced by `TasksMinors-299-Codex`.
