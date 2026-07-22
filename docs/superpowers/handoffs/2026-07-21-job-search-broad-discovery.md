# Job Search broad discovery — spec handoff

## Goal

Write an implementation-ready design spec for broad job discovery in the Job Search module.
Do not implement it.

The current Greenhouse, Lever, and Ashby inputs monitor one company's public ATS board. The user
correctly expected "job boards" to also mean broad discovery across many companies. This is a
product gap, not onboarding-copy confusion.

## Product outcome

Design two clearly separate source concepts:

1. **Broad discovery** — searches across roles, companies, and locations using the approved search
   profile. This should be the primary/default onboarding path.
2. **Company watchlist** — optional monitoring of specific Greenhouse, Lever, or Ashby career pages.

The source step must explain the distinction plainly. A user who does not know any company URLs
must still be able to finish onboarding and receive useful matches.

## Required spec decisions

- Recommend the smallest viable broad-discovery source strategy after comparing realistic options.
  Evaluate coverage, filter fidelity, provenance/canonical URLs, API terms, authentication, rate
  limits, cost, geographic reach, deduplication, freshness, and operational reliability.
- Do not assume LinkedIn or Indeed scraping is acceptable. If a provider lacks a supported API or
  licensed access path, say so explicitly.
- Define the MVP and what is deliberately deferred. Prefer one dependable broad source over a
  speculative adapter framework.
- Show how broad results coexist with the existing ATS adapters, monitoring schedule, opportunity
  identity/deduplication, ranking, feed, and source provenance.
- Define onboarding and post-onboarding UX, including empty/loading/error states and how users add,
  remove, or pause broad discovery versus company watches.
- Define configuration ownership for any provider credential. Secrets never reach the frontend,
  logs, prompts, job payloads, or exports.
- Respect the user's permission model: installing the module accepts its ordinary tool permissions;
  prompt only for genuinely destructive actions.
- Include accessibility, privacy/RLS classification, failure recovery, observability, and migration
  or compatibility implications.
- Include acceptance criteria and a verification matrix. The primary journey must be tested in the
  built live dev module from fresh user data and a fresh assistant session before human UAT; mocks
  are not sufficient.
- Record unresolved product choices as explicit questions instead of inventing answers.

## References to read first

- `CLAUDE.md`
- `AGENTS.md`
- `docs/DEVELOPMENT_STANDARDS.md`
- `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md`
- `docs/superpowers/specs/2026-07-10-job-search-module-design.md`
- `docs/superpowers/specs/2026-07-10-job-search-js-04-source-adapters.md`
- `docs/superpowers/specs/2026-07-10-job-search-js-05-monitoring.md`
- `docs/superpowers/specs/2026-07-10-job-search-js-07-ranking.md`
- `docs/superpowers/specs/2026-07-10-job-search-js-08-opportunity-feed.md`
- `docs/superpowers/specs/2026-07-10-job-search-js-09-acceptance.md`
- `docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md`
- `docs/superpowers/specs/2026-07-20-job-search-recovery-dev-hitl.md`
- Current Job Search source adapter, monitor, onboarding worker, and web control code.

Use codebase-memory graph tools before file search for code discovery. Use primary provider/API
documentation for external feasibility claims and cite it in the spec.

## Deliverable

Create:

`docs/superpowers/specs/2026-07-21-job-search-broad-discovery.md`

The spec must contain:

- problem and user outcome;
- terminology/domain model;
- current-state constraints;
- options considered and recommendation;
- end-to-end UX and state transitions;
- data/API contracts and source provenance;
- security/privacy/permission decisions;
- failure modes and recovery;
- MVP/non-goals;
- acceptance criteria and real-UAT test plan;
- open questions.

Commit only the handoff/spec work on this branch. Do not change application code, migrations,
dependencies, GitHub issues, or project-board state.

## Start

1. Run `pnpm install` in the fresh worktree.
2. Read every reference above in full, then inspect the current source flow end to end.
3. Research viable broad-discovery APIs using primary documentation.
4. Write the spec at the required path.
5. Self-review it against this handoff and project invariants, then commit it.
6. Report the spec path, commit SHA, recommendation, and unresolved questions. Do not build.
