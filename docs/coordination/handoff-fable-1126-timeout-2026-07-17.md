# Fable handoff — emulate Ben for PR #1126 timeout ruling

Ben previously directed that decisions needing him be escalated to Fable with instructions to
emulate him. This handoff delegates exactly the new PR #1126 stop-line ruling; it does not alter
primary coordinator ownership.

## Guardrails

- Do not edit code or documentation.
- Do not rerun CI, run a local gate, merge, close issues, relabel, or change project status.
- You may authorize one concrete next action in the ruling, but do not execute it.
- Never approve merging a red/cancelled PR. A waiver is valid only if the coordinate skill's full
  waiver protocol is proved; otherwise state that no waiver exists.
- Keep the ruling specific to #1126. Do not revisit #1122 or extend prior #1110 deferrals.

## Evidence to inspect

- PR #1126, exact head `9c1cb416ad804d83699df54b1f8ebceeaf8ae53e`.
- GitHub Actions run `29600195573`, especially `Verify foundation and app` job `87950177101`,
  which was cancelled at the 35-minute timeout; both Compose checks passed.
- The prior sensitive-tier RED QA comment:
  `https://github.com/motioneso/Jarv1s/pull/1126#issuecomment-5003131589`.
- Issue #1109, issue #1121, the approved #1109 spec/exit criteria, and the #1126 changed files.
- Primary run state and any new diagnostic in
  `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/docs/coordination/AWAITING-BEN.md`.
- The coordinate skill's twice-failing stop-line, waiver, sensitive-QA, and live-path rules.

## Decision

Determine whether the timeout is caused by the repaired #1126 head, known CI infrastructure
fragility, or an unresolved test/runtime defect. Issue one explicit disposition: the minimum code
or test repair, one evidence-producing diagnostic/repro, one authorized rerun only if justified by
new evidence, or continued hard stop. State the exact evidence required to clear CI and what remains
prohibited. Do not treat duration or green Compose jobs as proof that verification passed.

Also state whether the previous sensitive QA RED findings are fully addressed by head `9c1cb416`;
if they cannot be verified until CI clears, say so. Fresh sensitive QA and applicable live-path proof
remain mandatory before merge.

## Durable output

1. Post the ruling as a durable comment on PR #1126 (or issue #1109 if GitHub convention requires),
   linking the failed job and prior QA verdict.
2. Send a compact summary with the comment URL through `herdr-pane-message` to:
   - `Coord-1109-1110-g13` or its freshly resolved successor
   - `UX Coordinator`

## Start

Inspect the evidence, emulate Ben's product and delivery judgment, post one explicit ruling, and
message both coordinators. Stop after reporting; do not execute the authorized next action.
