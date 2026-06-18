# Coordination Run — 2026-06-18-overnight-automation

**Date:** 2026-06-18
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `019ed85e-46bb-78b2-b632-a995a8c84731`** (match `agent_session.value` in `herdr pane list`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. Pane numbers (`w…-N`) reflow on every restart/split/reap; do not trust any pane number written in this file as an identifier. Agents escalate to the label; the coordinator merges only when its own pane's session id matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; `security`-tier needs Ben's explicit merge sign-off.
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` >= 2 → relay. Compaction summary = already past safe → relay, merge nothing.
**Additional context ceiling:** coordinator self-reads `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` after major events and before every spawn/merge wave. If the visible status line reports >= 500K used, flush this manifest, write the mid-doing continuation note, and relay before more work.
**merges_since_relay:** 0

> This is the coordinator's externalized memory. Keep it current. GitHub is the source of truth for issue/board status; this file holds in-flight operational state.

## Grounding

- `pnpm audit:preflight` passed on 2026-06-18: `HEAD=76568c7`, `origin/main@76568c7`, behind=0, ahead=0.
- Latest `main` CI was red before this run: `Verify foundation and app` failed on `tests/unit/ai-tmux-bridge.test.ts` because the test hard-coded a PDT date while CI runner local time is UTC.
- CI repair committed directly to `main`: `ff0ba95` (`test: make Codex transcript date expectation timezone-safe`).
- Manifest formatting committed to `main`: `0b39d7f` (`docs: format overnight automation manifest`).
- Onboarding provider-check isolation committed to `main`: `4eb41fe` (`test: isolate onboarding provider check from host auth`).
- Local verification for CI repair:
  - `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts` green.
  - `TZ=UTC pnpm vitest run tests/unit/ai-tmux-bridge.test.ts` green.
  - `pnpm verify:foundation` green: 67 unit files / 402 tests; 54 integration files / 816 passed, 2 skipped.
- Must wait for latest GitHub Actions run `27743056244` on `4eb41fe` to finish green before spawning build lanes.

## Decisions

- Fixed the CI test, not production code. Root cause: `transcriptGlobDir("openai-compatible")` intentionally uses host-local `Date#getFullYear/getMonth/getDate` because Codex writes session directories by local calendar date. The old test assumed PDT (`2026/06/17`) and failed correctly on UTC CI (`2026/06/18`).
- Fixed the onboarding provider-check integration test, not production code. Root cause: the route now intentionally shells out to `claude auth status` for Anthropic checks, while the test injected a fake chat engine that this code path no longer uses. The test now prepends a temporary fake `claude` executable to `PATH`, so CI does not depend on the runner's real Claude auth state.
- The first manifest push failed CI because the Markdown table was not Prettier-formatted; fixed by formatting-only commit `0b39d7f`.
- No agents spawn while `main` is red or while the repair run is still pending.
- Overnight scope stays inside the approved queue: #297, #299 mechanical/minor subsets, then #244. Security/design-question issues are excluded from unattended merge.

## Queue

| Spec / contract                                          | Issue | Tier      | Status                        | Agent label         | Pane | Branch                         | PR  |
| -------------------------------------------------------- | ----- | --------- | ----------------------------- | ------------------- | ---- | ------------------------------ | --- |
| CI repair: timezone-safe Codex transcript date test      | —     | routine   | pushed-to-main; awaiting CI   | —                   | —    | main @ `ff0ba95`               | —   |
| CI repair: isolate onboarding provider-check test        | —     | routine   | pushed-to-main; awaiting CI   | —                   | —    | main @ `4eb41fe`               | —   |
| issue body: validate recurrence JSONB boundary           | #297  | routine   | queued                        | TasksRecurrence-297 | —    | overnight-297-recurrence-jsonb | —   |
| issue body: #299 tasks-only mechanical subset after #297 | #299  | routine   | queued                        | TasksMinors-299     | —    | overnight-299-tasks-minors     | —   |
| issue body: #299 settings/scripts/jobs mechanical subset | #299  | routine   | queued                        | InfraMinors-299     | —    | overnight-299-infra-minors     | —   |
| docs/superpowers/specs/2026-06-15-corrections-log.md     | #244  | sensitive | queued after lower-risk lanes | Corrections-244     | —    | overnight-244-corrections-log  | —   |

## Excluded / Held

- #299 design question about AI provider list route vs RLS widening: held for Ben/product-security decision.
- #260 owner/admin bootstrap: auth/admin surface plus unresolved policy choice; security-tier/design input.
- #238, #239, #237, #251, #252, #253: sessions/export/delete/auth/credentials/admin surfaces; not unattended.
- #218 chat session resumption: actionable but too broad for this cleanup batch without a tighter approved spec/handoff.

## Dependency / Merge Order

- First: CI repair must be green on GitHub Actions.
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

- [ ] Await GitHub Actions result for `4eb41fe` / run `27743056244`.

## Continuation Note

- **Relay reason:** coordinator self-read showed ~474K used at 2026-06-18 00:10 PDT, close to Ben's explicit 500K ceiling. Relay before spawning any build lanes.
- **Next action:** invoke `coordinate`, claim/update the coordinator lock to the successor's session id, confirm exactly one `Coordinator` label, read this manifest in full, then watch GitHub Actions run `27743056244`.
- **If latest CI is green:** spawn #297 first and #299 infra/settings/scripts if collision scan still shows no overlap. Hold #299 tasks subset until #297 lands. Hold #244 until the lower-risk lanes are done.
- **If latest CI is red:** pull the exact failing job log and continue systematic debugging. Do not spawn the fleet on red `main`.
- **Untracked files in main worktree:** `docs/superpowers/handoffs/2026-06-18-onboarding-service-testing-webwright.md` and `docs/superpowers/specs/2026-06-15-corrections-log.md` existed before this run; do not sweep them with broad staging.

## Report

- Write `docs/coordination/overnight-report-2026-06-18.md` when queue is dry or stopped by a hard gate. Include commits/PRs, decisions made, verification, skipped items, and any issues left for Ben.

## Reaped Sessions

- <none yet>
