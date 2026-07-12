# News Slice 3 plan — Fable adversarial review handoff

## Assignment

Review the committed Personalized News Slice 3 implementation plan adversarially. This is a
read-only plan/security review. Do not implement code, edit the plan, create migrations, open a PR,
or touch GitHub bookkeeping.

## Grounding

- Base: `origin/main@c23a93b8890a`, including Slice 2 merge `aa7216a67562`.
- Plan under review:
  `docs/superpowers/plans/2026-07-11-personalized-news-slice3.md` at commit `97c28748`.
- Governing spec:
  `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md`.
- Project rules: `CLAUDE.md`, `AGENTS.md`, and `docs/DEVELOPMENT_STANDARDS.md`.
- Slice 2 reference:
  `docs/superpowers/plans/2026-07-11-news-s2-safe-discovery.md` and merged implementation.

Run `pnpm audit:preflight` first and record the exact reviewed commit. If CodeGraph/MCP is
unavailable, state that and use repository reads/searches. Inspect the actual merged code rather
than trusting the plan's assertions.

## Review bar

Try to break the plan, especially:

1. cross-owner access after a cache warm, admin/RLS bypass, expired-snapshot access, article-ID
   collision/oracle behavior, and authorization ordering;
2. whether byte retrieval truly shares the existing resolve-and-pin redirect/robots/rate/timeout
   path without a subtle second SSRF implementation;
3. MIME spoofing, polyglots, partial/oversized responses, cache memory bounds, error/body leakage,
   and CSP behavior;
4. whether the response shape can display all ≤40 ranked stories without falsely grouping neutral
   topic publishers as preferred sources or dropping them after the hero;
5. whether News, Today, and briefing reads genuinely share one snapshot and whether stale/expired,
   empty-success, V1 fallback, and refresh-generation semantics are correct;
6. immediate deletion/exclusion visibility and stale-worker resurrection resistance;
7. topic metadata enrichment load/ToS boundaries, redirect-domain policy, and whether the full
   1,000-character guidance fix actually closes the provider-policy bypass;
8. response-schema stripping, original image URL leakage, module isolation, logging/job secrets,
   no-migration/no-dependency claims, file-size pressure, and test gaps;
9. scope creep into Slice 4 or missing Slice 3 requirements; and
10. unnecessary machinery that can be deleted while keeping the security and product guarantees.

The named merge council remains Opus + independent Codex + Gemini; Fable is the adversarial plan
reviewer, not a substitute council provider. Gemini-family CLI is `agy`, never legacy `gemini`.

## Deliverable

Create only:

`docs/superpowers/reviews/2026-07-11-personalized-news-slice3-plan-adversarial.md`

Use this structure:

- reviewed commit and evidence inspected;
- verdict: `APPROVE`, `APPROVE WITH REQUIRED CHANGES`, or `BLOCK`;
- confidence percentage;
- numbered blocking findings, each with exact plan/code references and the minimum correction;
- non-blocking improvements;
- explicit assessment of all ten review-bar areas;
- a final statement whether implementation may begin.

Commit only that review file on your review branch. Then message the unique `News Codex` Herdr
label with the verdict, commit, and blocking finding count. Do not message a raw pane ID. Stop after
delivery.

## Start

1. Confirm you are Fable 5 and in the isolated review worktree/branch.
2. Install dependencies only if `node_modules` is absent.
3. Run preflight and read every grounding document in full.
4. Inspect the merged implementation, perform the adversarial review, write/format/commit the one
   review file, message `News Codex`, and stop.
