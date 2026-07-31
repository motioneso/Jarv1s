# Fable 5 Review — Job Search Post-Onboarding UX Plan

**Date:** 2026-07-30
**Role:** Independent, adversarial design and implementation-plan reviewer
**Issue:** #1375

## Purpose

Review the approved Job Search UX correction spec and its draft implementation plan before build
approval. This is a read-only critique of the proposed work. Do not implement production code and
do not edit the spec or plan.

## Read in full

1. `CLAUDE.md`
2. `docs/superpowers/research/2026-07-30-job-search-ui-critical-review.md`
3. `docs/superpowers/research/2026-07-30-job-search-ui-post-onboarding-re-review.md`
4. `docs/superpowers/specs/2026-07-26-job-search-module-design.md`
5. `docs/superpowers/specs/2026-07-30-job-search-post-onboarding-ux-corrections.md`
6. `docs/superpowers/plans/2026-07-30-job-search-post-onboarding-ux-corrections.md`

Inspect the current code only where needed to test whether the plan names real seams and feasible
tests. Prefer the project’s code graph for code discovery.

## Review questions

Be severe and specific:

1. Does the plan fully implement every approved behavior, including captured job-description text?
2. Are any tasks architecturally misplaced, brittle, redundant, or larger than necessary?
3. Does the Fit-disposition design prevent contradiction without creating misleading score
   precision or a hidden combined verdict?
4. Is lazy LinkedIn description enrichment safe, correctly bounded, and compatible with existing
   storage, host-fetch, auth-wall, and read-tool contracts?
5. Can the proposed chat action-result outcome genuinely survive history reload without persisting
   unsafe tool output?
6. Do filters, row actions, and scroll/focus restoration preserve current paging, render caps, and
   optimistic reconciliation?
7. Do the Overview/Profile/Monitors changes remove templating without discarding useful state?
8. Are the proposed tests capable of detecting the live failures from the evidence reports?
9. Where does the plan overbuild? Prefer deletion, existing helpers, browser/native behavior, and
   the smallest root-cause fix.
10. Identify merge/topology risks from combining latest `feat/job-search`, #1246’s three
    implementation commits, and the research commits.

## Output

Write:

`docs/superpowers/research/2026-07-30-fable-5-job-search-plan-review.md`

Use this structure:

- Verdict: approve / approve with changes / reject
- Blocking findings
- Important non-blocking findings
- What the plan gets right
- Exact proposed edits to the spec or plan
- Items explicitly reviewed and accepted as-is

Rank every finding by severity and cite exact plan/spec sections and code paths. Distinguish verified
facts from hypotheses. Do not propose speculative abstractions.

Commit only the review report with:

`docs(job-search): add Fable 5 implementation-plan review`

## Start

1. Run `pnpm install` because this is a fresh worktree.
2. Read every required file in full.
3. Inspect the named code seams.
4. Write and commit the review report only.
5. Stop and leave a concise verdict in the pane. Do not push, open a PR, or modify live state.
