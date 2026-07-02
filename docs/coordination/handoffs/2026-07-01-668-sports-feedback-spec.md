# Handoff — Issue #668 Sports Feedback Spec

You are taking over issue #668:

https://github.com/motioneso/Jarv1s/issues/668

## Goal

Produce an approved design spec for the sports page feedback pass. Do not implement code yet.

The feedback came from Agentation dogfooding on `/sports` after PR #666. The issue body contains
the full captured comments. Group the work into a focused spec that can be implemented later.

## Required Process

1. Read `AGENTS.md` and `CLAUDE.md`.
2. Read issue #668 in full.
3. Read the existing sports spec/plan and current sports code enough to ground the design:
   - `docs/superpowers/specs/2026-06-30-sports-module.md`
   - `docs/superpowers/plans/2026-07-01-sports-module.md`
   - `packages/sports/`
   - `apps/web/src/sports/` if present, and the sports route/page assets in `apps/web/src`.
4. Use the brainstorming/spec process. Keep scope focused.
5. Write the design spec to:
   - `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
6. Self-review the spec for placeholders, ambiguity, contradictions, and scope creep.
7. Commit the spec on branch `coord/668-sports-feedback-spec`.
8. Report back with:
   - spec path
   - commit SHA
   - any open questions
   - clear note that no implementation was done

## Scope Hints

Treat these as the initial themes:

- Real assets: team logos, national flags/emblems, story images.
- Source links: hero and followed-team/league stories link to originating article/source.
- Relevance: followed-team news and highlighted games must actually match followed teams.
- Names/dates: full team names and next-match dates.
- Layout/content model: compact Top Stories plus broader league news grid.
- League-specific standings: columns/groups should match competition semantics.

## Guardrails

- Spec before build. Do not edit product code.
- Preserve Jarv1s invariants from `CLAUDE.md`.
- Do not casually add dependencies or a broad sports-platform abstraction.
- Keep issue #668 as the source of truth for captured feedback.
- Do not touch `docs/coordination/` except this handoff doc.
- Use `~/Jarv1s` in documentation, not absolute `/home/...` paths.
