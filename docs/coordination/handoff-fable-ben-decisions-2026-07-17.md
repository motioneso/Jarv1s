# Fable handoff — emulate Ben for #1110 / #1122 decisions

Ben explicitly delegated Fable to emulate him for exactly the two decisions below. Your rulings
substitute for Ben's response to the coordinators for these questions only.

## Guardrails

- Do not edit code or documentation.
- Do not rerun CI, run a local gate, merge, close issues, relabel, or change project status.
- You may authorize one concrete next action in a ruling, but do not execute it.
- Never approve merging a red PR or waive the live-path gate. A CI waiver is valid only if the
  coordinate skill's full waiver protocol is proved.
- Prefer an honest, minimal root-cause path. Do not spend another rerun merely to gather the same
  evidence, and do not create milestone-scale infrastructure unless the locked exit criterion
  truly requires it.

## Evidence to inspect

- `~/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/docs/coordination/AWAITING-BEN.md`
  sections `#1110 app-map` and `#1122 CI`.
- GitHub PR #1122, issues #1110, #1121, and #1123, including check metadata and relevant comments.
- The approved #1110 spec and its exit criteria. Read only the sections needed for these rulings.
- The coordinate skill's red-CI waiver and live-path rules.

## Decision 1 — PR #1122 stop-the-line

The verification job failed three times. The first was a fixed code regression; the later two
timed out with the same DB/auth-heavy integration signature. Choose the exact next disposition:
fresh-runner authorization, CI/Postgres infrastructure investigation, a protocol-compliant waiver
path if genuinely proved, or another concrete action. State what evidence clears the block and
what remains prohibited.

## Decision 2 — #1110 exit criterion

Rule whether deterministic live UAT plus unit-level grounding is sufficient for #1110 while the
real-chat E2E harness is tracked in #1121, or whether #1121 must land first. If approving the
deferral, state the exact live proof still required before #1110 may merge. If rejecting it, state
the minimum additional proof required without broadening into unrelated infrastructure.

## Durable output

1. Post the CI ruling on issue #1123.
2. Post the exit-criterion ruling on issue #1110, linking #1121 and PR #1122.
3. Send one compact summary with both comment URLs through the `herdr-pane-message` skill to:
   - `UX Coordinator`
   - `Coord-1109-1110-g7`

## Start

Inspect the evidence, emulate Ben's product and delivery judgment, make both rulings, post them,
and message both coordinators. Stop after reporting; do not execute the authorized next actions.
