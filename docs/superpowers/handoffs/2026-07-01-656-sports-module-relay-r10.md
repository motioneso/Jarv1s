# Relay handoff — #656 sports module (r9 → r10)

**Continuation of a coordinated build.** Successor to `Build-656-sports-r9`. Same worktree, same
branch, under the Coordinator. Read this IN FULL, then resume via `coordinated-build`. Resume at
**Task 14**.

Run: `2026-06-30-rfa-fleet` · Issue: #656

## Coordinates

- **Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
- **Branch:** `coord/656-sports-module`, HEAD **`87a57b01`** (do NOT branch off; keep committing here)
- **Bootstrap:** `[ -d node_modules ] || pnpm install` — node_modules exists; do NOT reinstall
  (exception: the Task-14 dep add below legitimately needs an install — see there).
- **Coordinator:** Herdr label **`Coordinator`** = pane `w1:p10`, session
  `019f1f70-fb27-7cb1-9ce0-2af0329763a8` (codex). Re-resolve by label each time; confirm EXACTLY ONE
  holds it before messaging.
- **Plan:** `docs/superpowers/plans/2026-07-01-sports-module.md` — Task 14 at L1324, Task 15 at L1364.

## Done since r9 (committed)

- **Task 13 — `87a57b01`** `feat(sports): /sports page UI + route wiring (loader-seam 5)`:
  - `apps/web/src/sports/sports-page.tsx` — orchestrator: gameday/story hero, followed-team cards,
    league-filter scoreboard, headlines rail, standings rail, no-follows empty state (+ CTA
    `<a href="/settings/modules/sports">`). Binds `queryKeys.sports.overview`.
  - `apps/web/src/sports/sports-parts.tsx` — `initials`, `Crest`, `LiveDot`, `RationaleChip`,
    `FormPips`, icon set.
  - `apps/web/src/styles/sports-1.css` — ported from Design-System `sports.css`, fully tokenized
    (raw colors only in tokens.css; win=pine/draw=steel/loss=neutral; pulse behind
    `prefers-reduced-motion`). **992 lines — 8 under the 1000 gate; DO NOT grow it.** Follow-picker
    (`sp-pick*`/`sp-team*`/`sp-whole*`) CSS was deliberately NOT ported (it's Task 14's; add it to a
    SEPARATE file `sports-2.css` or you'll blow the file-size gate).
  - `apps/web/src/app.tsx` — lazy `SportsPage`, `sportsGate = myModulesEnabled("sports")`,
    `ModuleGatedRoute` at `webRoutePath("sports")` (the Task-12 deferred wiring, landed here).
  - `tests/unit/sports-page.test.tsx` — 5 tests, renderToString SSR convention. GREEN.
  - Gates run green on touched files: web typecheck, eslint, prettier, check:design-tokens,
    check:file-size. Coordinator notified.

## Task 14 — settings follow-picker pane (fully scoped; resume here)

Create `packages/sports/src/settings/index.tsx`, **default export `SportsSettings`**. Mirror
`packages/wellness/src/settings/index.tsx` (local `requestJson`, `useQuery`/`useMutation` +
`invalidateQueries`; `@jarv1s/settings-ui` primitives `PaneHead`/`Group`/`Row`/`Switch`/`Badge`/`Note`).
Auto-mounts via the settings-ui Vite **filesystem scanner** (`scanModuleSettings`) — no
`settings-page.tsx` edit, no package `exports` entry needed.

**Endpoints (paths confirmed in `packages/sports/src/routes.ts` + `apps/web/src/api/sports-client.ts`):**

- `GET /api/sports/catalog` → `SportsCatalogResponse { competitions: (CompetitionRef & {teams: TeamRef[]})[] }`
- `GET /api/sports/follows` → `SportsFollowsResponse { follows: SportsFollowDto[] }`
- `POST /api/sports/follows` body `CreateSportsFollowRequest { competitionKey, teamKey?: string|null }`
- `DELETE /api/sports/follows/:id`
- DTOs in `packages/shared/src/sports-api.ts`: `TeamRef{teamKey,competitionKey,name,shortName,crestUrl}`,
  `CompetitionRef{competitionKey,label,kind:"league"|"tournament",marquee}`,
  `SportsFollowDto{id,competitionKey,teamKey:string|null,createdAt}`. `teamKey:null` = whole league.

**UI (spec §4.6a item 6):** competitions grouped; "whole league" toggle (`teamKey:null` follow) +
team grid with crests + check toggles; active = `--pine-soft`/`--accent`; `marquee` tag on the
World Cup (`fifa.world`). Inline `["sports","follows"]` / `["sports","catalog"]` keys are the
sanctioned package-side exception.

### ⚠️ Two non-obvious traps (both already investigated by r9)

1. **Test = SSR render, NOT click→mutation.** The plan's Step-1 wording ("toggling calls
   createSportsFollow") CANNOT be done — repo has NO jsdom/RTL by design; Coordinator already ruled
   renderToString-only for this build. Every pane test (`settings-people-pane.test.tsx`) asserts
   rendered HTML via `client.setQueryData` + `renderToString`, never events. **Write the test that
   way:** place it at `tests/unit/settings-sports-pane.test.tsx` (NOT the plan's
   `packages/sports/src/settings/__tests__/…` — root vitest doesn't pick up `packages/*/src`).
   Import `SportsSettings` from `../../packages/sports/src/settings/index.js`; prime catalog+follows;
   assert competition labels, team names, active-state class on a followed team, and the marquee tag
   render. Root vitest ALIASES `@jarv1s/settings-ui`, react, react-query (verified) so it resolves
   with no install. This is the same self-corrected test-placement convention used in Tasks 12/13.

2. **`packages/sports/package.json` is missing pane deps.** It has only db/module-sdk/shared/
   structured-state/fastify. The pane imports `react`, `@tanstack/react-query`, `@jarv1s/settings-ui`
   — wellness's package.json has all three; sports does NOT. The `packages/sports` `typecheck`
   script (`tsc --noEmit`, part of `verify:foundation`) WILL FAIL without them. **Add those 3 deps
   (copy wellness's versions: `react ^19.0.0`, `@tanstack/react-query ^5.0.0`,
   `@jarv1s/settings-ui workspace:*`) then run `pnpm install`.** This is the one sanctioned install.
   It's plan-approved parity (not new external infra), and pnpm worktrees isolate node_modules +
   lockfile, so it won't disturb the other active session (`Build-647-imap-send-r6`, w1:p22). r9
   already told the Coordinator this dep add is coming; a courtesy re-flag is fine but not a gate.

**Commit (explicit staging):** `git add packages/sports/src/settings/ packages/sports/package.json
pnpm-lock.yaml tests/unit/settings-sports-pane.test.tsx apps/web/src/styles/sports-2.css`
`feat(sports): settings follow-picker pane (auto-mounted via manifest)`.

## Task 15 — README ledger + full-gate close-out (plan L1364)

Create `packages/sports/README.md` listing the 6 loader-seams (grep-verify each
`// LOADER-SEAM(sports)` tag). Note accepted deviation (briefing-only chat-visible tool, §4.8) +
deferred fast-follows (§9). Then `pnpm verify:foundation` (full gate incl. `foundation.test.ts`
migration-list `toEqual` — sports migration row must already be present from Task ≤11; if red, add
the row). Then `coordinated-wrap-up` (PR + report to Coordinator). Coordinator owns QA/merge/board.

## Constraints (Ben + Coordinator, verbatim intent — KEEP)

- **Explicit staging only.** Never `git add -A`/`.`. **Do NOT stage** `.claude/context-meter.log`,
  `docs/coordination/…` copies, or `docs/superpowers/plans/2026-07-01-sports-task11-briefing-section.md`
  (untracked by design). This handoff doc IS an intentional commit.
- No repo-wide format (single-file `prettier --write` on own files fine). Single chat-visible
  `sports.followedFactsToday` tool — no new tools. RLS/DataContextDb/AccessContext untouched
  (`AccessContext` = `{actorUserId, requestId}`). Tests only in `tests/unit`+`tests/integration`.
  Raw CSS colors only in tokens.css; result colors NEVER red.
- Relay again at ~80–100k tokens / on any compaction summary.

## First actions

1. Confirm branch `coord/656-sports-module`, HEAD `87a57b01`; `[ -d node_modules ]` (skip install).
2. `coordinated-build` required recalls (state + frontend row).
3. Message Coordinator (`w1:p10`, verify label): "r10 driving, resuming Task 14 (settings pane);
   will add 3 workspace deps to packages/sports + pnpm install (wellness parity, worktree-isolated)."
   Then build Task 14 → 15.
