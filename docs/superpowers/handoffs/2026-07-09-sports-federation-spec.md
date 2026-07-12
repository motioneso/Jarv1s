# Handoff — finish the Sports federation club-following spec + plan (#907)

**You are running on Claude Fable 5.** Ben asked specifically for a Fable review. Your job is to
**finish the spec and produce the implementation plan** — you own the remaining spec/plan work. Do
**not** write feature code; this is spec-before-build (a hard gate).

## Context

- **Issue:** #907 (task) — "Sports: follow clubs across all Champions-League-eligible federations +
  full English pyramid". Read it: `gh issue view 907`.
- **Spec (draft):** `docs/superpowers/specs/2026-07-09-sports-federation-club-following.md` — already
  written by the main session, seeded into this worktree. Review and edit it **in place**.
- **Ben's ask (2026-07-09 /today live pass):** follow clubs in every Champions-League-eligible
  federation (UEFA/CONCACAF/CONMEBOL/AFC/CAF/OFC — Liga MX, Brazil, etc.), and give England its full
  football pyramid (`eng.1`–`eng.5`).
- **The key finding the spec rests on:** the follow system is already club-agnostic (POST `/follows`
  never validates `teamKey`; clubs are enumerated live from ESPN `/{sport}/{league}/teams`). The
  ONLY architectural wall is `SportsService.getCatalog()` firing one ESPN `/teams` call **per
  league, eagerly, every picker load** — fine at 8 leagues, a 50+ fan-out at federation scale. The
  spec's job is to remove that wall (leagues-eager / teams-lazy + confederation-browse picker).

## Your tasks

1. **Ground every load-bearing claim in the actual source** (this worktree is clean `origin/main`
   @ `d89f27cd`). Verify, don't trust:
   - `packages/sports/src/sports-service.ts` `getCatalog()` — confirm the per-league eager `/teams`
     fan-out.
   - `packages/sports/src/routes.ts` POST `/follows` — confirm `teamKey` is NOT validated.
   - `packages/sports/src/source/espn-source.ts` `listTeams` / `resolve` / endpoint URLs +
     `ESPN_FETCH_HOSTS`.
   - `packages/sports/src/source/catalog.ts` `CatalogEntry` (note `espnSport`/`espnLeague`/`logoUrl`
     + `competitionLogoUrl`).
   - `packages/sports/src/web/sports-standings.tsx` — confirm `"table"` and `"groups"` render
     identically (so new soccer leagues need no new shape).
   - `packages/sports/sql/0133_sports_follows.sql` — owner-only RLS, `team_key NULL` = whole comp.
   - `packages/sports/src/settings/index.tsx` — the current flat client-side picker.
   - `packages/shared/src/sports-api.ts` — schemas you'll extend (**fast-json-stringify trap:** any
     new field must be in BOTH `required` AND `properties` or it's silently dropped).
   Fix any claim in the spec that the code contradicts.

2. **Adversarially improve the spec.** Steelman the design. Pressure-test: the lazy-load contract
   split (§4.2), the cross-league search fan-out avoidance (§4.4 — is the "warm-cache incremental
   fill" actually sound, or does it need a background warm job?), confederation modeling, caching
   TTL, `degraded` handling, e2e fixture impact, module isolation. Verify a **representative** set of
   ESPN soccer slugs actually resolve (curl `https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams`
   and the logo `https://a.espncdn.com/i/leaguelogos/soccer/500/{id}.png`) — enough to trust the
   dataset approach; you need NOT probe all 55 UEFA members (that's the implementation-time probe
   script's job). Edit the spec to reflect what you find.

3. **Draft the implementation plan.** Use the `writing-plans` skill if available. Produce a concrete,
   slice-by-slice, file-level plan (what changes in which file, in what order, with the test/
   verification checkpoint per slice) that a build agent could execute. The spec already proposes 4
   slices — refine them, or restructure if your review finds a better decomposition. Put the plan at
   `docs/superpowers/specs/2026-07-09-sports-federation-club-following-PLAN.md` (or append a "##
   Implementation Plan" section to the spec — your call, whichever reads better).

## Scope decision already made (confirm or challenge)

England gets its **full pyramid**; every other federation gets its **top division(s) that feed the
continental cup**, NOT full lower tiers (that would be enormous and mostly unfollowed). The dataset
structure must allow extending later. If you think this is wrong, say so in the spec with reasoning.

## Guardrails

- **No feature code.** Spec + plan only. Do not touch `packages/*` source beyond READING it.
- **Prettier the docs before committing** (`npx prettier --write docs/...`) — spec docs failing
  `format:check` is a recurring trap.
- Stay within the sports module conceptually; no news-module coupling.
- This is your **own** worktree (`feat/907-sports-federation`). Do not touch other worktrees or
  `main`. Commit your spec/plan edits here.
- Keep `docs/superpowers/DEVELOPMENT_STANDARDS.md` (if referenced) and the house spec format
  (see other files in `docs/superpowers/specs/`) — status header, "Grounded on", numbered sections.

## Start

1. `pnpm install` (fresh worktree — no node_modules).
2. Read `gh issue view 907` and the draft spec IN FULL.
3. Ground the claims (task 1), edit the spec.
4. Adversarially improve (task 2).
5. Write the implementation plan (task 3).
6. Prettier the docs, commit on this branch, and report back what you changed + where the plan is.
