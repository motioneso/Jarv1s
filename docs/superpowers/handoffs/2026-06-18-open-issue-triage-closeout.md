# Open Issue Triage Closeout

Date: 2026-06-18
Repo: `~/Jarv1s`

## Status

The local issue-triage queue from the recovered handoff was processed through #306.

GitHub updates are partially blocked because this host currently cannot resolve `github.com` or
`api.github.com`. Do not infer that missing labels/comments mean a spec was not written.

## Local Commits From This Continuation

- `d3fdd67` — #252 AI provider test/model detect spec
  - `docs/superpowers/specs/2026-06-18-ai-provider-test-and-model-detect.md`
- `e4317e6` — #253 AI capability routing persistence spec
  - `docs/superpowers/specs/2026-06-18-ai-capability-routing-persistence.md`
- `c7aad76` — #254 connector health monitoring spec
  - `docs/superpowers/specs/2026-06-18-connector-health-monitoring.md`
- `9b0e6b9` — #255 host diagnostics safe ops spec
  - `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`
- `d995cb9` — #270 additional email provider connectors spike
  - `docs/superpowers/specs/2026-06-18-additional-email-provider-connectors-spike.md`
- `6826bf7` — #299 AI provider/model visibility spec
  - `docs/superpowers/specs/2026-06-18-ai-provider-model-visibility.md`
- `1863e25` — #306 Phase 2 deploy checkpoint/final gate spec
  - `docs/superpowers/specs/2026-06-18-phase-2-deploy-checkpoint-final-gate.md`

Coordinator confirmed each commit was docs-only and present locally through `1863e25`.

## GitHub State Known From This Session

- #251 was updated before DNS failed:
  - removed `task`
  - added `needs-spec`
  - posted triage comment explaining env/operator-configured auth providers and activation trigger
- #252 label/comment update was attempted after the spec was written but failed due DNS:
  - `error connecting to api.github.com`

## Pending GitHub Follow-Up When DNS Recovers

Verify current issue labels first, then update:

- #252: add `RFA`; comment with spec path and explicit exclusions:
  provider test/model discovery only; CLI re-auth separate; credential editing already real; #253
  owns capability routing.
- #253: add `RFA`; comment with
  `docs/superpowers/specs/2026-06-18-ai-capability-routing-persistence.md`.
- #254: add `RFA`; comment with
  `docs/superpowers/specs/2026-06-18-connector-health-monitoring.md`.
- #255: add `RFA`; comment with
  `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`.
- #270: keep as spike/deferred unless Ben chooses the next provider. Comment with
  `docs/superpowers/specs/2026-06-18-additional-email-provider-connectors-spike.md` and the
  activation trigger.
- #299: add `RFA` for provider/model visibility work if the implementation issue remains open for
  that residual. Comment with
  `docs/superpowers/specs/2026-06-18-ai-provider-model-visibility.md`.
- #306: add/keep `manual-acceptance`; comment with
  `docs/superpowers/specs/2026-06-18-phase-2-deploy-checkpoint-final-gate.md`.

## Worktree Caution

Unrelated dirty style files existed throughout the later triage:

- `apps/web/src/styles.css`
- `apps/web/src/styles/components-core.css`
- `apps/web/src/styles/components-jarvis.css`
- `apps/web/src/styles/tokens.css`

They were intentionally not staged by the triage/spec work.
