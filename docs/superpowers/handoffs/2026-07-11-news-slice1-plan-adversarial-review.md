# Handoff: Adversarial review of Personalized News Slice 1 plan

**Role:** Independent Claude Fable 5 plan critic  
**Mode:** Read-only review; do not implement or edit the plan/spec  
**Grounding target:** current `origin/main` plus the committed review inputs on this branch

## Inputs

- Approved spec:
  `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`
- Proposed Slice 1 plan:
  `docs/superpowers/plans/2026-07-11-personalized-news-slice1.md`
- Project rules: `CLAUDE.md`, `AGENTS.md`, and `docs/DEVELOPMENT_STANDARDS.md`
- Shipped News V1 implementation under `packages/news/`

## Objective

Try to disprove that the proposed plan is safe, minimal, build-ready, correctly sliced, and faithful
to the approved product decisions. Treat agreement as failure: look for concrete reasons the plan
would produce wrong behavior, security gaps, false UI affordances, unnecessary architecture,
unmergeable intermediate state, missing files/tests, or collisions with current main.

## Required review lenses

1. **Scope fidelity:** identify any requirement missing from Slice 1 or work pulled forward from
   later slices without necessity.
2. **Default-deny:** prove whether any route/repository/UI path could commit an unvalidated custom
   source/topic before Slice 2.
3. **RLS/data lifecycle:** challenge every table policy, role grant, cascade declaration, export
   inclusion/omission, admin behavior, and snapshot privacy claim.
4. **Module isolation:** inspect proposed AI/web-search availability wiring and the News export seam
   for forbidden imports or table access.
5. **Data model:** attack status fields, uniqueness, domain normalization, snapshot JSONB, limits,
   future Slice 2/3/4 compatibility, and migration-order assumptions.
6. **Independent merge value:** decide whether Slice 1 is useful and truthful if merged alone.
7. **Ponytail:** identify tables, interfaces, routes, UI, or tests that can be deleted while still
   meeting Slice 1 outcomes.
8. **Buildability:** verify current symbols/files/routes/test conventions on fresh main and flag
   wrong filenames, absent APIs, impossible tests, or hidden dependency changes.
9. **Verification:** hunt missing adversarial tests, especially Fastify schema stripping, RLS
   cross-user/admin access, domain suffix tricks, export leaks, and deletion parity.
10. **Collision/risk:** identify migration and shared-file collision points and confirm the risk tier.

## Output

Write `docs/superpowers/reviews/2026-07-11-personalized-news-slice1-plan-adversarial.md` with:

- verdict: `APPROVE`, `APPROVE WITH REQUIRED CHANGES`, or `REJECT`;
- confidence percentage;
- blocking findings first, each with plan section/file evidence and the smallest correction;
- non-blocking simplifications;
- missing verification;
- a corrected task/slice outline if the current one is structurally wrong; and
- an explicit statement of whether implementation may start after the required corrections.

Do not change the plan or spec. Commit only the review file on your review branch. Then send a short
completion message to the `Codex` pane in the Jarv1s Herdr workspace, naming the verdict and review
path.

## Start

1. Read this handoff, the spec, plan, `CLAUDE.md`, `AGENTS.md`, and development standards in full.
2. Run `pnpm audit:preflight` and record the grounded commit.
3. Inspect current code using CodeGraph/codebase-memory first, then exact file reads as needed.
4. Perform the adversarial review and write/commit the required report.
5. Notify the Codex pane and stop; do not implement.
