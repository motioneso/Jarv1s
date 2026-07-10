# Fable 5 review handoff — Intelligent Job Search spec (#913)

## Assignment

Perform an independent, adversarial design review of the draft Intelligent Job Search module spec.
This is a review-only task. Do not edit the spec, source code, GitHub issue, project board, or any
other repository file.

The review must run on **Fable 5 (`claude-fable-5`) with no fallback**. If that model is unavailable,
stop and report that fact; do not silently continue on another model.

## Grounding

- Draft branch: `spec/913-intelligent-job-search`
- Draft base: `origin/main` at `90cc89d7a0510e078469104785fcba73c0d5d7c2`
- GitHub feature epic: #913
- Packaging prerequisite: #860
- Existing external-module safety design: #818
- The feature brief was approved by Ben before `/start`.

Run `pnpm audit:preflight` before reviewing and name the verified commit in the verdict. If the
review worktree is intentionally one commit ahead of `origin/main` because it contains only this
draft spec/handoff, an `ahead > 0, behind = 0` result is valid.

## Required reading

Read these in full before forming conclusions:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/DEVELOPMENT_STANDARDS.md`
4. `docs/module-developer-guide.md`
5. `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md`
6. `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md`
7. GitHub issue #860 (`gh issue view 860 --repo motioneso/Jarv1s`)
8. GitHub issue #913 (`gh issue view 913 --repo motioneso/Jarv1s`)

Use codebase-memory-mcp for any code discovery. Confirm current SDK/runtime claims against source;
do not assume the draft is correct.

## Review questions

Review the spec as both a product design and an architectural contract.

### Product

- Does the MVP actually deliver Ben's requested day-one flow: assistant-led profile setup, resume
  critique/optimization, search-goal definition, and durable agents that populate jobs?
- Is the first-week success test observable, honest, and not gamed by low-quality matches?
- Are any load-bearing features accidentally deferred, or is speculative scope included?
- Are Greenhouse/Lever/Ashby plus manual capture a credible minimum source set?
- Does “Jarv1s knows me” remain useful without becoming opaque or silently mutating the profile?

### Architecture

- Is the separation from the default image real, or does any decision smuggle this back into core?
- Are the #860 prerequisites complete and generic rather than job-search special cases?
- Is relational persistence genuinely required, and is the rejection of #818 KV well supported?
- Can external scheduled monitors and AI evaluation preserve metadata-only jobs, provider-agnostic
  AI, module isolation, RLS, lifecycle export/delete, and no admin bypass?
- Does assistant-led onboarding need a missing generic host seam the draft failed to name?
- Are source-host controls, scraping policy, prompt-injection treatment, and resume-truth rules
  strong enough?
- Are idempotency, stale-posting behavior, cost limits, failure recovery, and disable/uninstall
  semantics specified precisely enough for a later plan?

### Simplicity

- Identify anything that can be deleted or deferred without weakening the approved first-week
  outcome.
- Identify any “simple” choice that merely hides necessary complexity or creates a second system.
- Do not reject the feature merely because #860 is unfinished; judge whether the dependency is
  framed truthfully and whether the spec is approval-ready as a blocked consumer design.

## Deliverable

Return a compact structured verdict:

```text
MODEL: claude-fable-5 (confirmed; no fallback)
GROUNDED: <commit>
VERDICT: APPROVE | REVISE | REJECT
APPROVAL-READY: YES | NO

BLOCKING FINDINGS
1. [section] finding, evidence, required correction

NON-BLOCKING FINDINGS
1. [section] finding and suggested improvement

WHAT THE SPEC GETS RIGHT
- ...

BOTTOM LINE
<2-4 sentences>
```

No finding should rely only on taste. Cite the exact spec section and repository/issue evidence.
If there are no blocking findings, write `None`.

Send the verdict through the `herdr-pane-message` skill to the pane labeled
`Codex: Job Search Spec` (Codex session `019f49ed-b7eb-7693-9460-0151efe99769`). Also leave the
same verdict as your final response in your own pane.

## Start

1. Confirm the active model is `claude-fable-5` with no fallback.
2. Run the grounding preflight and record the commit.
3. Read every required source in full.
4. Inspect current SDK/runtime code where the draft makes architectural claims.
5. Produce and send the verdict. Make no edits.
