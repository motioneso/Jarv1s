# JS-09 — epic acceptance and seven-day validation

**Status:** Draft — issue #938; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #937 and every hard runtime prerequisite in the dependency spec

## Goal

Verify the complete packaged MVP against #913's technical, security, lifecycle, and first-week
success intent. This slice fixes defects found by acceptance but adds no new product scope.

## Automated gate

- Independently built package installs/enables without default-image or `BUILT_IN_MODULES` changes.
- Invalid/disabled/hash-drifted package contributes nothing.
- Fresh user completes six checkpoints and approves a truthful resume/profile.
- Owner/admin isolation, export/delete, disable preservation, re-enable, and purge pass.
- Greenhouse/Lever/Ashby fixtures plus manual capture pass compliance and normalization checks.
- Two identical monitor runs produce no duplicate opportunity/evaluation.
- Changed content creates a new evaluation; unchanged content does not.
- Scheduled run completes with browser/chat closed; payload/log scans contain no private content.
- Source/AI failure degrade independently and preserve retryable state.
- Ranking emits evidence, gaps, freshness, confidence, unknowns, and respects the 25/day cap.
- Retention/tombstones and protected-record resolution pass.
- Provider independence is exercised through at least two configured adapter shapes.

The independently packaged module runs its full lint/type/unit/integration/web build. Any required
core runtime changes run `pnpm verify:foundation` and `pnpm audit:release-hardening` in the core repo.

## Manual acceptance

1. Install and enable the package on a running compatible instance.
2. Complete all onboarding with a real resume; inspect diff/evidence and approve.
3. Configure a supported public board and local due time.
4. Run twice and verify active, deduplicated, explained results.
5. Close the browser and verify the next due scheduled run.
6. Save genuinely worthwhile active roles during the seven-day observation.

Success is five distinct still-active opportunities marked saved within seven days of monitoring
enablement. If compliant supply yields fewer, acceptance records source coverage, filters, monitor
health, and a truthful insufficient-supply result; it never pads recommendations.

## Merge and observation policy

Automated gates and day-one manual acceptance are required before implementation merges. The
seven-day usefulness observation starts after merge/deployment and does not hold a technically green
PR open. Epic #913 remains open throughout the observation. Findings may produce changes or child
tasks; the epic closes only after the seven-day result and any required corrective work are recorded.

## Evidence artifact

Produce one release-review summary containing package/runtime versions, enabled adapters, safe run
counts, dedup/evaluation results, security/lifecycle gate outcomes, and the seven-day success result.
Do not include resume/profile text, descriptions, credentials, prompts, or private tool output.

## Non-goals

- No application CRM, employer outcome measurement, source analytics, or scope expansion during
  acceptance.
