# Relay handoff — #656 sports module (r8 → r9)

**Continuation of a coordinated build.** You are the successor to `Build-656-sports-r8`. Resume in
the SAME worktree on the SAME branch under the Coordinator. Read this doc IN FULL, then resume via
the `coordinated-build` skill.

Run: `2026-06-30-rfa-fleet` · Issue: #656

## Coordinates

- **Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
- **Branch:** `coord/656-sports-module`, HEAD `fb56311e` (do NOT branch off; keep committing here)
- **Bootstrap:** `[ -d node_modules ] || pnpm install` — node_modules already exists; do NOT
  reinstall.
- **Coordinator:** Herdr label **`Coordinator`**. Resolve fresh by label each time via
  `herdr pane list`; confirm EXACTLY ONE pane holds it before messaging; session id is authority,
  label is routing, the `…-N` pane number is ephemeral (reflows) — never address/reap by a bare
  number.
- **Spec/plan:** `docs/superpowers/specs/2026-06-30-sports-module.md`,
  `docs/superpowers/plans/2026-07-01-sports-module.md` (15 tasks, Task 12 at plan L1195, Task 13 at
  L1260). Risk tier: standard (module isolation + owner-only RLS on `app.sports_follows`).

## Done (committed on this branch)

- **Tasks 1–11** — see prior relay docs / commit history (`ca03c959`, `b051e692`, etc.) — package,
  contract, migration, source/cache/repo/service/routes, briefing tool, module-registry
  registration, briefing section wiring.
- **Task 12 (partial, coordinator-approved "Option A") — `fb56311e`**:
  - `apps/web/src/api/sports-client.ts` (new): `getSportsOverview`, `getSportsCatalog`,
    `listSportsFollows`, `createSportsFollow`, `deleteSportsFollow` — mirrors
    `weather-client.ts`, uses `requestJson` from `./client.js`.
  - `apps/web/src/api/query-keys.ts`: added `sports: { overview, catalog, follows }` block.
  - `apps/web/src/app-route-metadata.ts`: added `"sports"` to the `WebRouteMeta["id"]` union,
    `sports: "You"` to `SECTION_OF`, and a `webRoutes` entry (`path: "/sports"`, title "Sports",
    subtitle "FOLLOWED", `match: p => p.startsWith("/sports")`) — inserted between `wellness` and
    `settings`.
  - `tests/unit/web-sports-client.test.ts` (new): mocks global `fetch`, asserts query keys + all
    5 client fns hit the right path/method/body (mirrors `web-theme-api-client.test.ts` pattern).
  - `tests/unit/web-route-metadata.test.ts`: fallout fix — the `webRoutes.map(path)` full-list
    `toEqual` assertion needed `"/sports"` inserted (same class of fix as Task 10/11's
    foundation.test.ts / briefings.test.ts fallout).
  - **Deliberately deferred to Task 13** (escalated + coordinator-confirmed "Option A"): the plan's
    `app.tsx` step (`lazy(() => import("./sports/sports-page"))` + `<Route>` under
    `ModuleGatedRoute`) is NOT done. `sports-page.tsx` is a Task 13 deliverable that doesn't exist
    yet; wiring the import now would break `apps/web` typecheck/build. **Task 13 must add the page
    AND the app.tsx wiring together** in the same commit (or same green sequence) so typecheck
    never goes red on this branch.
  - **Self-corrected test placement** (not escalated — established repo convention, same rule as
    the sports-package test-placement note below): the plan literally says
    `apps/web/src/api/__tests__/sports-client.test.ts`, but root `vitest.config.ts` `include` is
    `spikes/**`, `tests/**`, `packages/people/src/__tests__/**` only — it does **not** pick up
    `apps/web/src/**` at all, and `apps/web/package.json` has **no test script and no
    vitest/testing-library devDependency**. Every existing web-client test in the repo
    (`web-theme-api-client.test.ts`, `web-route-metadata.test.ts`, etc.) lives under
    `tests/unit/*.test.ts` and imports from `../../apps/web/src/...`. Used that convention.
    **Task 13's `sports-page.test.tsx` (React Testing Library) will hit the same gap** — the plan
    says `apps/web/src/sports/__tests__/sports-page.test.tsx`, which also won't run under the root
    suite. Check root `tests/unit/` for an existing RTL-based web-page test to mirror (e.g. search
    for `@testing-library/react` usage) before assuming a path; if none exists, this may need a
    coordinator flag since it could mean adding RTL as a root devDependency (an infra decision, not
    a mechanical path fix like the client-test case was).

### Verification at relay (all GREEN)

- `pnpm --filter @jarv1s/web typecheck` — clean.
- `pnpm exec prettier --write` + `pnpm exec eslint` on all 5 touched files — clean.
- `pnpm vitest run tests/unit/web-sports-client.test.ts tests/unit/web-route-metadata.test.ts` — 2
  files / 5 tests passed.
- Did NOT re-run the full root suite or `verify:foundation` this relay (small, isolated diff;
  scoped tests above cover it). Successor should run the full gate before Task 15 close-out
  regardless.

## Left to do — Tasks 13–15 (Task 13's app.tsx wiring is now unblocked; proceed per coordinator's

existing Task 12/13 approval — no new gate needed for the app.tsx piece specifically, but confirm
before writing page/CSS if anything else looks off per the coordinated-build step ½ premise-check)

- **Task 13** (plan L1260) — Sports page UI + CSS (plan §4.6a) **plus the app.tsx wiring deferred
  from Task 12** (lazy import + `<Route>` under `ModuleGatedRoute`, `sportsGate =
myModulesEnabled("sports")` — see plan L1233-1244 for the exact snippet). Investigate the RTL
  test-infra gap noted above FIRST — before assuming `apps/web/src/sports/__tests__/...` is a valid
  path, grep root `tests/unit/` for any existing React Testing Library web-page test; if none
  exists, escalate to the Coordinator rather than unilaterally adding `@testing-library/react` +
  jsdom environment to root vitest config (that's an infra/tooling decision). At Task 13, cheaply
  try Open Design / Jarvis Design System source first for the CSS; if unavailable, author from the
  §4.6a taxonomy and note the fallback. Preserve the authored design system (`jds-*`, serif
  headings / mono eyebrows / sans body; raw colors only in `apps/web/src/styles/tokens.css`); only
  a small local `RationaleChip` if none exists; watch the 1000-line file-size gate on new CSS/TSX.
- **Task 14** (L1324) — Settings follow-picker pane.
- **Task 15** (L1364) — README loader-seam ledger + full-gate close-out (`pnpm verify:foundation`),
  then `coordinated-wrap-up` (PR + report). Coordinator owns QA/merge/board.

## Constraints to keep (Ben + Coordinator, verbatim intent)

- **Explicit staging only.** Never `git add -A`/`.`. Stage only your task's files.
- **Do NOT stage** `.claude/context-meter.log`, `docs/coordination/…` handoff copies, or
  `docs/superpowers/plans/2026-07-01-sports-task11-briefing-section.md` (intentionally untracked).
  This relay doc under `docs/superpowers/handoffs/` IS an intentional commit.
- **No repo-wide format.** (Single-file `prettier --write` on your own touched files is fine.)
- Preserve the **single chat-visible `sports.followedFactsToday` tool** decision — no new tools; no
  rich `sports.scores`.
- **RLS / DataContextDb / AccessContext untouched.** Owner-only on `app.sports_follows`; no admin
  bypass; `AccessContext` is `{ actorUserId, requestId }` only. Repositories take `DataContextDb`.
- Module isolation: sports collaborates only via its manifest + declared APIs. Forced
  composition-root wiring stays tagged `// LOADER-SEAM(sports):`.
- Test placement: repo tests live under `tests/unit` + `tests/integration` (root `vitest.config.ts`
  does NOT pick up `packages/*/src` **or `apps/web/src/**`** tests). Do not add
`packages/sports/src/**tests**/_`or`apps/web/src/\*\*/**tests**/_`— use`tests/unit/`.
- Relay again at ~80–100k tokens or the instant you see a compaction summary.

## First actions for the successor

1. `[ -d node_modules ] || pnpm install`; confirm branch `coord/656-sports-module`, HEAD `fb56311e`.
2. Run the `coordinated-build` required recalls (state + RLS/migration/frontend rows).
3. Message the Coordinator (label `Coordinator`): your pane id + `agent_session.value`, "r9 driving,
   starting Task 13 (page/CSS/app.tsx wiring) — will flag if RTL test-infra gap needs a coordinator
   call." Task 12 is fully approved/closed; no need to wait for a fresh go unless the RTL gap or
   something else surfaces.
