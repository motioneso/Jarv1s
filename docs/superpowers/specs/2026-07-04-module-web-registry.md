# Module web registry (frontend plugin seam)

**Status:** draft (2026-07-04) — design spec for task issue #799, part of epic #798 (module docking
seams). Extends ADR 0009 ("a module connects, never alters") to the web app. Flip #799 to `RFA`
once this spec is approved.

**Grounded on:** `origin/main` @ `cc23e808` (audit findings verified at `2797fc1f`; the delta is a
design-token rename with no modularity impact). Re-run `pnpm audit:preflight` before building.

---

## Problem

The backend docks a module with one manifest + one `module-registry` entry, but the web app has no
plugin seam at all. Wellness's UI is ~3,557 LOC across `apps/web/src/wellness/` (14 files) plus 3
CSS files, and registering it required hand-edits to ~13 shared web files:

- `apps/web/src/app.tsx:37-38,88,193,199-202` — lazy page import, `myModulesEnabled("wellness")`
  gate, `<ModuleGatedRoute>` entry, `wellnessEnabled` prop threading into `TodayPage`.
- `apps/web/src/app-route-metadata.ts:10,21,75-79` — route id/path/title/match registration.
- `apps/web/src/api/client.ts:508-597` — ~10 hand-written fetch functions.
- `apps/web/src/api/query-keys.ts:104-110` — query-key namespace.
- `apps/web/src/shell/command-palette-model.ts:36` — palette module list.
- `apps/web/src/settings/settings-module-view-model.ts:22` — `USER_TOGGLEABLE_MODULE_IDS` set.
- `apps/web/src/settings/settings-types.ts:18`, `settings-sample-data.ts:118`,
  `settings-personal-data-panes.tsx:93` — description, sample data, icon map.
- `apps/web/src/onboarding/section-tour-model.ts:34-35`, `section-tour-step.tsx:37`,
  `member-welcome-step.tsx:15` — tour entries.

Sports repeated the same pattern (`app.tsx:40-41,89,207-210`, `app-route-metadata.ts:11,22,82-86`,
`api/sports-client.ts`, `query-keys.ts:99-102`, `settings-module-view-model.ts:22`, three
`styles/sports-*.css` files).

Two manifest fields are **decorative** on the web side today, the same failure mode `routes[]` had
before the docking-ports slice:

- `navigation` (`ModuleNavigationEntryManifest`, `packages/module-sdk/src/index.ts:388-396`) — the
  web nav is hand-built.
- `settings[].entry` (`ModuleSettingsSurfaceManifest`, `packages/module-sdk/src/index.ts:398-407`)
  — both wellness and sports ship React settings panes at `packages/<module>/src/settings/index.tsx`
  exported via a `./settings` subpath, and `apps/web/package.json` declares both workspace deps
  (`:20,:22`), **but no file under `apps/web/src` imports either package**. The panes are
  unit-tested (`tests/unit/settings-sports-pane.test.tsx` imports the package source directly via a
  relative path) and dead in the shipped UI. The web settings screen renders its own hand-written
  panes instead.

## Goal

A module's entire UI — routes, nav entry, today widgets, settings pane, command-palette entries,
API client, query keys, CSS — lives in `packages/<module>/` and docks into the web shell through
**one entry in one web-side registry file**, mirroring `BUILT_IN_MODULES`. Migrating sports proves
the mechanism; migrating wellness proves it scales; the decorative fields become load-bearing or
are deleted (no stale concepts).

## Architecture

**A typed web contribution per module, statically registered.** Vite needs statically analyzable
imports, so discovery stays a literal array — the same trade the backend registry makes
(`packages/module-registry/src/index.ts:696`). The invariant we buy is _one edit in one file_, not
zero edits.

1. **`@jarv1s/module-web-sdk` (new, browser-safe package).** Holds only types + tiny helpers; peer
   deps `react` and `@tanstack/react-query`; no node imports (same constraint as `@jarv1s/shared` —
   it will be Vite-bundled). Defines:

   ```ts
   export interface ModuleWebContribution {
     readonly moduleId: string; // must match the backend manifest id
     readonly routes?: readonly ModuleWebRoute[]; // path, title, icon, order, lazy element
     readonly todayWidgets?: readonly ModuleTodayWidget[]; // slot + lazy component + enablement key
     readonly settingsPane?: ModuleSettingsPane; // lazy component + description + icon
     readonly commandPaletteEntries?: readonly ModulePaletteEntry[];
     readonly onboarding?: ModuleOnboardingContribution; // tour section + welcome line
   }
   ```

   `ModuleWebRoute.element` is a `() => Promise<{ default: ComponentType }>` thunk so the shell
   controls `React.lazy` and code-splitting per module.

2. **Module web entry: `packages/<module>/src/web/index.ts`**, exported via a `"./web"` subpath in
   the module's `package.json` `exports` map (the proven `./settings` pattern,
   `packages/sports/package.json`). It exports a single `ModuleWebContribution` and is the ONLY
   thing `apps/web` may import from a module package. Everything web-specific moves under it:
   - `apps/web/src/sports/*` → `packages/sports/src/web/` (page, news, parts).
   - `apps/web/src/api/sports-client.ts` + the query-key namespace → the module web dir. Query keys
     stay namespaced by `moduleId` (preserve the `["sports", ...]` shapes so React Query caches
     survive the move — see memory `jarv1s frontend workspace querykey`).
   - Module CSS files move into the package and are imported by the module's own components. The
     tokens rule is unchanged: raw CSS colors stay in `apps/web/src/styles/tokens.css` only; module
     CSS uses tokens and `jds-*` primitives.
   - **Server/browser split guard:** `./web` (and `./settings`) subpaths must never transitively
     import fastify/kysely/node code. Enforced by a unit test that imports each registered `./web`
     entry under a browser-like condition set and by the existing web build in CI.

3. **Web registry: `apps/web/src/modules/registry.ts`** — the single web-side docking file:

   ```ts
   import { sportsWebContribution } from "@jarv1s/sports/web";
   export const MODULE_WEB_CONTRIBUTIONS = [sportsWebContribution /* , ... */] as const;
   ```

   Derived consumers (each loops the array instead of hand-coding modules):
   - `app.tsx` renders `<ModuleGatedRoute>` per contributed route; the gate stays the existing
     generic `myModulesEnabled(moduleId)` machinery.
   - `app-route-metadata.ts` derives module route metadata entries.
   - `command-palette-model.ts` appends contributed entries.
   - `settings-module-view-model.ts` derives the toggleable-module list from the `/api/modules`
     bootstrap payload (`lifecycle === "user-toggleable"`), replacing the hardcoded
     `USER_TOGGLEABLE_MODULE_IDS`; descriptions/icons come from the contribution.
   - Settings screen renders `contribution.settingsPane` for modules that provide one — making the
     module-side panes live and deleting the dead-code state.
   - Today page renders `todayWidgets` by slot (wellness check-in widget, sports desk) instead of
     importing module components directly.
   - Onboarding tour derives module sections from `onboarding` contributions.

4. **Consistency assertion (mirror the backend).** A unit test asserts: every
   `MODULE_WEB_CONTRIBUTIONS` id matches a backend manifest id; contributed route paths match the
   backend manifest `navigation` paths; no two contributions collide on path or palette id. This
   keeps manifest `navigation` as the source of truth and the web contribution as its renderer.

## Components / phases

**Phase A — mechanism + sports (small, newest, proves everything):**

1. Create `packages/module-web-sdk` (types only, ~150 LOC) + tsconfig/vitest aliases.
2. Create `apps/web/src/modules/registry.ts` + the derived-consumer refactors listed in §3. Behavior
   change target: **zero** — same routes, same gating, same visuals.
3. Move sports web code into `packages/sports/src/web/`, delete `apps/web/src/sports/` and
   `api/sports-client.ts`, register the contribution. The today-feed "Sports desk" integration
   (`apps/web/src/today/feed-source.ts:24-74`, `today-page.tsx:377-808`) becomes a `todayWidgets`
   contribution.
4. Wire `settingsPane` so `packages/sports/src/settings/index.tsx` actually renders in the settings
   screen; delete the duplicated web-side sports settings fragments.

**Phase B — wellness migration (bulk move, same shape):** move the 14 files + 3 CSS bundles, convert
the Today check-in/meds widgets and export modal to contributions, delete the wellness branches in
the 13 shared files. Respect the file-size gate when relocating CSS (split stays as-is).

**Phase C — cleanup:** remove any now-empty shared-file branches; grep for stranded module ids in
`apps/web/src` (CI check candidate: no module id may appear in shared web files outside
`modules/registry.ts`).

## Non-goals

- No dynamic/remote module loading, no module federation — static array + code-splitting only.
- No redesign of any screen; this is a functionality/structure pass, pixel-identical output
  (design passes are separate per project practice).
- No new backend manifest fields; `navigation`/`settings` metadata shapes are unchanged.
- Chat drawer, briefings UI, and platform screens stay core (not contributions).

## Verification

- `pnpm verify:foundation` + web build + Playwright e2e (`tests/e2e/wellness.spec.ts`, sports
  specs) green with zero test-expectation changes in Phase A/B (except import paths).
- `pnpm capture:screens` diff before/after each phase — screenshots must be identical.
- New unit tests: registry consistency assertion; browser-safety import test; settings pane renders
  from the package entry.
- Manual: disable sports for a user — nav entry, route (404 via existing guard), palette entry, and
  today widget all disappear.

## Risks / open questions

- **Bundle hygiene** is the main risk: a module package accidentally pulling server code into the
  web bundle. Mitigation: the import-condition unit test + keeping contracts in `@jarv1s/shared`
  (unchanged rule, `packages/shared/src/wellness-api.ts:720` documents it).
- **Query-key stability** during the move — keys must be byte-identical or user caches invalidate.
  Covered by unit tests asserting the exact key shapes.
- Open: should `onboarding` tour contributions land in Phase A or be deferred to Phase C? Default:
  Phase C (lowest value, touches the most copy).
