# Overnight Report — 2026-06-18 Automation

## Summary

The approved overnight queue completed. GitHub Actions stayed billing-blocked for the run, so merges
used Ben-approved local CI-equivalent evidence plus independent QA.

## Merged

- PR #303 / issue #297 — recurrence JSONB boundary regression coverage.
  - Merge: `2cbea96`
  - Evidence: `VF297_EXIT=0`; 67 unit files / 409 tests; 54 integration files / 817 passed, 2
    skipped.
- PR #304 / issue #299 tasks subset — mechanical tasks cleanup.
  - Merge: `e9e6b87`
  - Evidence: `VF_EXIT=0`, `AUDIT_EXIT=0`, pre-push format/lint/typecheck green.
  - QA: `QA-304-TasksMinors` GREEN, 0 findings.
- PR #302 / issue #299 settings/scripts/jobs subset — mechanical settings/scripts/pg-boss cleanup.
  - Merge: `d002958`
  - Evidence: `VF_EXIT=0`, `AUDIT_EXIT=0`, pre-push trio green.
- PR #305 / issue #244 — memory corrections log.
  - Merge: `bd43a0f`
  - Evidence: `VF_EXIT=0`, `AUDIT_EXIT=0`; 68 unit files / 413 tests; 54 integration files / 822
    passed, 2 skipped.
  - QA: `QA-305-Corrections` GREEN, 0 findings.

## GitHub State

- #297 closed and Done.
- #244 closed and Done.
- #299 remains open/Backlog with a status comment: the tasks and settings/scripts/jobs subsets
  landed; AI/chat, memory/file-size, frontend quadrant mirror, and provider-list-vs-RLS design
  question remain.

## Decisions

- Used the approved local CI-equivalent gate while GitHub Actions is billing-blocked.
- Kept #299 provider-list route vs RLS widening out of unattended scope; it still needs a
  Ben/product-security decision.
- Treated #244 as `sensitive`, not `security`: it touched memory lifecycle and owner-scoped RLS, but
  did not introduce auth/session/token/secret policy surfaces.
- Fixed coordinator relay instructions so Codex successor coordinators launch with
  `codex -s danger-full-access -a never`, preventing sandbox-blocked Herdr operations.

## Verification

- CI repair local gate on `d8aa546`: `verify:foundation`, release-hardening tests/audit,
  `build:web`, e2e, compose smoke, and prod compose smoke all passed.
- Each merged lane carried local full-gate evidence in its PR body or manifest entry.
- Independent QA was run for #304 and #305 before merge.

## Skipped / Held

- #299 AI/chat minors, memory/file-size, frontend quadrant mirror: still open on #299.
- #299 provider-list vs RLS widening: held for Ben/product-security.
- #260, #238, #239, #237, #251, #252, #253: held because they touch auth/sessions/credentials/admin
  or delete/export surfaces.
- #218: held as too broad without a tighter approved spec/handoff.

## Environment Notes

- GitHub Actions still reports no usable checks because account billing/spending blocks runner
  assignment.
- The main worktree still has one pre-existing untracked file:
  `docs/superpowers/handoffs/2026-06-18-onboarding-service-testing-webwright.md`.
