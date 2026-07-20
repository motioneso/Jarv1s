# Job Search Park Press Screens Implementation Plan

> **For agentic workers:** Use `coordinated-build` and TDD. This is the serialized screen slice
> that follows merged root PR #1209; do not run `verify:foundation` until the coordinator grants a
> database window.

**Goal:** Replace the four Job Search tab screens with the approved Park Press designs, retire the
temporary opportunities route, and remove every legacy screen artifact deferred by the root PR.

**Architecture:** Keep the merged first-run gate, module runtime/router/read-only API/store, and
authored outcome states. Add a small presentational `kit.tsx`; render real tool results through pure
exported views; keep all writes conversational through `hostActions.openAssistant`. The Matches
screen owns both bucket lists and opportunity detail under `/matches/*`. Monitors join configured
monitor data to `sources.list`, so board names come from the runtime registry and Workday cannot
appear.

**Tech stack:** TypeScript, host-provided React runtime, token-only module CSS, Vitest
`renderToString`, Playwright with mocked REST and the real esbuild bundle.

## Verified branch state

- Branch `feat/1197-job-search-screens` starts at merged root commit `d1bad9be`.
- `root.tsx` exposes the approved four tabs but still maps `/matches` and legacy
  `/opportunities/*` paths to `OpportunitiesScreen`.
- `kit.tsx` and `screens/matches.tsx` do not exist.
- Legacy `starter-drafts.ts`, `screens/onboarding.tsx`, `screens/opportunities.tsx`, and
  `screens/opportunity-detail.tsx` still exist.
- Overview, Monitors, and Profile still use the pre-#1197 compact layouts.
- `tests/unit/job-search-web-screens.test.tsx` and `tests/e2e/js06-module-surface.spec.ts` assert
  the legacy screen contracts.

## Confirmed test seams

1. **Pure view seam:** render exported view components with literal tool-result fixtures. Assert
   user-visible copy, navigation, safe text escaping, and empty/error behavior without mocking
   internal collaborators.
2. **Real bundle seam:** mount `dist/web/index.js` in Playwright and mock only REST boundaries.
   Exercise each tab, Matches detail routing, conversational actions, source-backed monitor rows,
   and the retired `/opportunities` path.
3. **Bundle contract seam:** existing module core/bundle tests continue proving host React reuse
   and no core-internal imports.

## Files

- Add: `external-modules/job-search/src/web/kit.tsx`
- Add: `external-modules/job-search/src/web/screens/matches.tsx`
- Modify: `external-modules/job-search/src/web/styles.ts`
- Modify: `external-modules/job-search/src/web/root.tsx`
- Rewrite: `external-modules/job-search/src/web/screens/overview.tsx`
- Rewrite: `external-modules/job-search/src/web/screens/monitors.tsx`
- Rewrite: `external-modules/job-search/src/web/screens/profile.tsx`
- Delete: `external-modules/job-search/src/web/starter-drafts.ts`
- Delete: `external-modules/job-search/src/web/screens/onboarding.tsx`
- Delete: `external-modules/job-search/src/web/screens/opportunities.tsx`
- Delete: `external-modules/job-search/src/web/screens/opportunity-detail.tsx`
- Rewrite: `tests/unit/job-search-web-screens.test.tsx`
- Rewrite: `tests/e2e/js06-module-surface.spec.ts`

Do not modify shared e2e helpers or worker/domain files.

### Task 1: Shared Park Press kit and overview

1. Replace legacy overview assertions with RED tests for the approved hero, setup checkpoints,
   readiness gates, monitor-health summary, and `/matches` review link.
2. Add RED tests for `FitBadge` labels and `Confidence`'s accessible confidence title.
3. Run:
   `pnpm vitest run tests/unit/job-search-web-screens.test.tsx`
4. Add the minimum `kit.tsx` primitives: `Eyebrow`, `Strap`, `SectionHead`, `FitBadge`, `Meta`, and
   `Confidence`. Use `--font-sans` letterspaced uppercase labels and tabular numerics; no mono.
5. Extend `styles.ts` with responsive, token-only `jsm-*` layout/presentation classes.
6. Rewrite Overview around real onboarding and monitor results. Keep prototype copy verbatim where
   it is authored copy; derive counts/status/schedules from the tool results.
7. Re-run the focused unit file and commit only kit/styles/overview/tests when green.

### Task 2: Matches list and detail under the final route

1. Replace opportunity-shell/feed/detail tests with RED Matches tests:
   - `/matches`, `/matches/{bucket}`, and `/matches/{bucket}/{identityHash}` parsing;
   - bucket tabs and detail links contain no `/opportunities` href;
   - Park Press hero/cards/fit/confidence/evaluation detail render real fixtures;
   - hostile external strings stay escaped and non-http(s) URLs never become links;
   - save/pass controls hand off to the assistant and invoke no web write tool;
   - monitored and unconfigured empty states remain distinct.
2. Add `screens/matches.tsx`, reusing the existing read tools and safety guards. Keep description
   text-only and preserve all authored loading/error/disabled outcomes.
3. Switch `root.tsx` to `MatchesScreen`; remove the `/opportunities` alias so the retired path
   falls back to Overview.
4. Run the focused unit file and commit only Matches/root/tests when green.

### Task 3: Source-backed monitors and redesigned profile

1. Replace legacy Monitors/Profile assertions with RED tests for:
   - Park Press monitor hero and watched-board cards;
   - board display names supplied by `sources.list`, with no Workday row;
   - schedule, health, query, run-now state, and empty state;
   - Profile & resume hero, approved revision metadata, target/location/dealbreaker fields, and
     conversational refine/update actions;
   - resume content remains absent and hostile profile strings stay escaped.
2. Rewrite Monitors so `monitor.list` and `sources.list` begin together; detail reads enrich rows
   without blocking sibling rows. Do not add write tools.
3. Rewrite Profile with defensive readers for the approved untyped field map. Display only bounded
   string lists and structured compensation; never render resume content.
4. Run the focused unit file and commit only Monitors/Profile/tests when green.

### Task 4: Delete legacy artifacts and rewrite mocked browser coverage

1. Delete all four deferred legacy files and remove their imports/tests.
2. Rewrite the real-bundle Playwright suite with one mocked scenario per screen plus Matches detail
   and retired-route coverage. Fixtures include `sources.list`; no Workday fixture or assertion is
   hardcoded into production code.
3. Keep screenshots for all four screens in light and dark themes under gitignored `test-results`.
4. Run DB-less focused checks:

   ```bash
   pnpm build:external:job-search
   pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx
   pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium
   pnpm check:design-tokens
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```

5. Confirm source files are below 1000 lines, the diff contains no legacy path/import, the bundle
   has no own React/core imports, and the tree is clean after explicit-path commits.
6. Report the branch gate-ready to `Coord 1193 Supervisor 3`. Do not run `verify:foundation`, push,
   open the PR, or merge until the coordinator grants the serialized full-gate window.

## Exit review

- Four approved Park Press screens render real read-tool data and authored state handling.
- Monitors derive board identity from `sources.list`; Workday is absent by construction.
- `/matches/*` is the only opportunity UI route; `/opportunities` alias is gone.
- No legacy onboarding/starter/opportunities files remain.
- Browser coverage exercises every screen through the real external bundle.
- Module isolation, read-only web access, external-string escaping, and bundle hygiene remain intact.
