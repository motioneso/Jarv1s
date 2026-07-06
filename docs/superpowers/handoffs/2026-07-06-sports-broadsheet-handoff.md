# Handoff — /sports broadsheet redesign (issue #839, epic #726)

**Date:** 2026-07-06 · **Branch/worktree:** `829-sports-broadsheet` · **Status:** mockup approved through rev 3; spec+plan NOT yet updated to match feedback; build NOT started.

Full durable state is in agentmemory: `~/.claude/projects/-home-ben-Jarv1s/memory/sports-broadsheet-redesign.md`. This doc is the quick pointer.

## What this is
Turn the shipped #829 hairline reskin (PR #831) into a true multi-column newspaper layout for `/sports`.
- **NO serif** — the broadsheet feel is layout/hairlines/heavy-sans, owner decision.
- Respects global light/dark theme (Option A — "more layout than colors").
- Honest-to-data: fill the composition from existing `SportsOverviewResponse`; no invented editorial backend.

## Key paths
- Frontend: `packages/sports/src/web/` (NOT stale `apps/web/src/sports/`).
- Data contract: `packages/shared/src/sports-api.ts` ← `GET /api/sports/overview`.
- Spec: `docs/superpowers/specs/2026-07-06-sports-broadsheet-grid-design.md` (needs revision — see below).
- Plan: `docs/superpowers/plans/2026-07-06-sports-broadsheet-grid.md` (needs revision — see below).
- Mockup: Artifact `https://claude.ai/code/artifact/fc483717-a4c1-4e74-9372-3655f0dce939`; source `scratchpad/sports-broadsheet-mockup.html` (in the session scratchpad, not committed).

## Approved layout (mockup rev 3)
- ALL explainer / "why you're seeing this" text REMOVED everywhere → stop rendering the `rationale` field. Non-negotiable.
- Two tickers: followed teams (kept) + "Around the Leagues" scores strip.
- **Scores column DROPPED** (Ben's call, rev 3): ticker + hero carry scores. Grid is 2-col: LATEST (2fr) | STANDINGS (1fr).
- LATEST = 2-up columns, thumbnail per story (`Headline.imageUrl`).
- STANDINGS = league selector + conference/division sections (DTO already supports via `StandingsGroup.sections[]` + `label`).
- NEWS BAND = blurb + "Continue reading →" (real `url`) + filter by league.
- Manage = link to existing settings (not a new build).

## Scope decisions (Ben, 2026-07-06) — the two that reach past frontend-only
1. **Blurb → add `Headline.summary` THIS milestone** (amends the spec's frontend-only non-goal).
   Honestly sourced: ESPN news API already returns `description` per article at
   `packages/sports/src/source/espn-source.ts:277-289` (currently dropped; article inline type at :264-271 must be widened).
   Carry through `SourceHeadline` (`source/sports-source.ts:12-15`) → `toPublicHeadline` (`sports-service.ts:432-436`)
   → add `summary` to shared `Headline` DTO. Update fixture `packages/sports/src/source/__fixtures__/nfl-news.json`
   (it lacks `description`). No new upstream fetch. There is no news DB table.
2. **Manage = link only, ALREADY EXISTS.** Constant `SETTINGS_HREF = "/settings?section=modules&module=sports"`
   already in `packages/sports/src/web/sports-page.tsx:38` and `sports-ticker.tsx:8` (ticker already renders a Manage link).
   Settings UI = `packages/sports/src/settings/index.tsx` (`SportsSettings`). Module links use plain `<a href>`.
- League logos → static asset map keyed by `competitionKey` (no DTO change; `CompetitionRef` has no logo field).
- Team crests/photos → data population only (`crestUrl`/`imageUrl` fields already exist).

## Next steps (in order)
1. Get Ben's read on rev-3 open questions: (a) is 2-up Latest w/ a thumbnail per story too busy? (b) does a lone Standings rail feel thin next to a wide Latest?
2. **Update the spec**: amend the frontend-only non-goal for `Headline.summary`; add second ticker, dropped scores column, standings selector, news blurb/filter, manage link, per-story Latest images, explainer removal.
3. **Update the plan** to match.
4. Split `Headline.summary` server change as its own task (needs its own `task` issue per [[build-needs-task-issue]] + spec gate).
5. Offer execution choice (Subagent-Driven recommended). **Build NOT started until Ben approves.**

## Gotchas
- Gate: `pnpm verify:foundation`. CSS 1000-line file cap → keep editorial CSS in a NEW `packages/sports/src/web/styles/sports-5-editorial.css` (`sports-1.css` is at ~965/1000).
- Screenshots of live prod `/sports` (local box :1533): scratchpad `shot-sports.mjs` / `shot-fold.mjs` (better-auth signed cookie).
- If committing this doc into the worktree: `prettier --write` it first or `verify:foundation` format:check fails ([[handoff-doc-prettier-trap]]).
- Shared working tree — stage only your own paths; another session may have uncommitted work.
