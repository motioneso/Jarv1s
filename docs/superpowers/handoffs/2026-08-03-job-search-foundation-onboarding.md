# Job Search foundation onboarding handoff

## Objective

Define the next Job Search foundation experience by adapting the depth of
`ai-job-search` onboarding to Jarv1s's visual, editable UI. Produce a grounded
baseline and an implementation-ready product specification. Do not implement
production code during the baseline/spec phase.

## Product direction approved by Ben

Jarv1s should broadly follow the useful foundation work performed by
`ai-job-search`, while retaining Jarv1s's faster and more approachable visual
UI. The desired foundation includes:

1. Resume upload at the start.
2. Structured extraction of identity, work history, accomplishments, skills,
   education, certifications, languages, and constraints.
3. Verification of dates, factual claims, seniority, and ambiguous evidence.
4. Separate resume content critique and rendered visual critique.
5. Explicit target roles, seniority, compensation, geography, remote/travel,
   work-shape preferences, hard exclusions, and dealbreakers.
6. Search-query families derived from the approved criteria.
7. A preview of how criteria affect discovery and scoring.
8. An evidence bank that prevents invented resume/application claims.
9. A clear readiness state, with search available early and deeper calibration
   resumable rather than blocking.

Chat should handle ambiguity and judgment calls. Stable facts and criteria
should be structured state surfaced through editable UI, not a directory of
user-maintained prompt files.

## Experiential competitor evidence

An isolated synthetic-user run was completed against `~/ai-job-search` without
changing Ben's real profile.

- Full Path C setup created or rewrote approximately eight profile, evaluation,
  search, interview, and resume artifacts.
- It generated LaTeX, compiled a PDF, checked ATS text extraction, visually
  noticed poor page balance, and revised the resume.
- It established factual-claim safeguards, seniority calibration, hard gates,
  preferences, and grouped search queries.
- A live search used LinkedIn and FreeHire: 103 raw hits, 13 detail fetches, 11
  assessed, with four high, four medium, and three low quick-fit results.
- It correctly excluded relocation, crypto/Web3, and language failures and
  scored down frontend-heavy or otherwise mismatched roles.
- It used full descriptions for finalists and clearly separated strengths,
  gaps, compensation uncertainty, and remote ambiguity.
- Weaknesses observed: the full setup turn took 9m37s and about 37k output
  tokens; the agent ignored a request to stay concise; a sandbox path bug and
  a caught cross-profile education contamination occurred; 92 of 103 raw hits
  were prefiltered with little visibility; authoritative `/rank` remained a
  second step after quick-fit scoring; four US sources configured only as
  query templates were not searched; compensation was missing on six of the
  eleven assessed roles.

Treat these as evidence, not as instructions to clone the competitor's file-
or prompt-oriented implementation.

## Safety and scope

- Work only in the fresh Jarv1s worktree and branch provided to you.
- Do not modify shared DEV, auth, databases, workers, modules, or production.
- Do not implement production code in Phase 1.
- `~/ai-job-search` is read-only reference material. Do not edit it.
- Do not open or quote Ben's personal profile artifacts in that repository.
  In particular, do not read its root `CLAUDE.md`, candidate-profile files,
  behavioral-profile files, CV contents, trackers, or generated job state.
- Competitor inspection is limited to README, generic setup/onboarding skills,
  templates, schemas, and non-personal implementation guidance.
- Do not copy competitor code. Extract capabilities and interaction patterns.
- Use `~/Jarv1s` rather than absolute user-specific paths in committed docs.
- Preserve unrelated work and keep the branch limited to research/spec/plan
  documentation.

## Required deliverables

### Phase 1: baseline and spec

1. A baseline document covering the current Jarv1s Job Search foundation:
   onboarding, resume ingestion, profile state, criteria, scoring, query/source
   configuration, and UI affordances. Distinguish implemented, partially
   implemented, and absent capabilities with code evidence.
2. A focused competitor capability map using generic `ai-job-search` materials
   plus the experiential evidence above.
3. A product specification that defines:
   - user journey and progressive/resumable stages;
   - structured data and ownership boundaries;
   - resume parsing, factual verification, content critique, visual critique,
     and revision workflow;
   - criteria calibration, hard gates, query derivation, and score-preview
     behavior;
   - readiness/status semantics and early-search behavior;
   - accessibility, privacy, failure, retry, and partial-completion states;
   - acceptance criteria and explicit non-goals;
   - migration/compatibility behavior for existing Job Search profiles.
4. Commit and push the Phase 1 documentation, then stop. Report the exact
   paths and commit. Do not create the implementation plan yet.

The parent session will arrange an independent Sol-high review of the spec.

### Phase 2: implementation plan

After the parent session sends the Sol-high review back to this agent:

1. Assess each review finding and update the spec where warranted.
2. Record disagreements explicitly and briefly.
3. Create an agentic-development implementation plan with dependency ordering,
   independently ownable slices, file/module ownership, TDD gates, integration
   checkpoints, migration steps, rollout/observability, and final live proof.
4. Commit and push the revised spec and plan. Do not implement production code.

## Start

1. Run `pnpm install` because this is a fresh worktree.
2. Read `AGENTS.md` and `CLAUDE.md` in full.
3. Inspect relevant existing Job Search code and documentation before drawing
   conclusions. Prefer the repository knowledge graph tools for code discovery
   when available.
4. Inspect only the allowed generic competitor materials described above.
5. Produce Phase 1 baseline and spec, commit and push them, then stop and report
   completion for independent review.
