# Module Settings Connector (contributed surfaces)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s` manifest seam (`ModuleSettingsSurfaceManifest`, `manifest.settings[]` — defined but unused), `apps/web/src/settings/settings-ui.tsx` atoms, `packages/module-sdk/src/index.ts` `ToolServices` seam, `packages/module-registry/src/active-modules-resolver.ts`, hard invariants (module isolation, private by default).

Parent of: #474 (Wellness AI access consent). Blocks: #474, #454, and every future module that ships a settings surface.

## 1. Decision

Module-owned settings surfaces must live in their owning package, not in core web. Today every
module's settings React component is hardcoded in `apps/web/src/settings/settings-module-subviews.tsx`
(Briefings, Chat, Notifications) — that coupling violates module isolation and blocks third-party
modules from shipping UI without editing core.

Build a **convention-based, build-time settings connector**:

- A module declares its settings surface(s) in its manifest (`manifest.settings[].entry`).
- A Vite build-time plugin scans all workspace + `node_modules/@jarv1s-*` manifests and
  auto-generates a loader map (`Record<moduleId, React.lazy>`).
- Core web renders contributed surfaces via a `<ModuleSettingsRouter>` that resolves the map.
- The shared UI atoms (`Switch`, `Group`, `Row`, `PaneHead`, `Note`, …) move into a new
  `@jarv1s/settings-ui` package so contributed components never import from `apps/web`.

Third-party modules drop a package in + rebuild → settings appears, **zero core edits**.

This matches the deployment model (Jarv1s is self-hosted, single-container; adding a module is
already a deploy/build event) and the stated constraint that user-developed modules must not require
editing core code.

## 2. Why not MFE / runtime loading

A runtime micro-frontend model would give true click-install plugin support, but:

- Jarv1s is self-hosted with rebuild-on-add as the deployment unit. Live plugin install is not on
  the near roadmap.
- MFE imposes recurring costs (shared-React singleton negotiation, per-module error/sandbox
  boundaries, security review of remote bundles) to solve a build-time problem.
- The convention-scan model's outputs (the manifest `entry` pointer, the loader map) upgrade cleanly
  to MFE later: the entry becomes the MFE entry point, the scan becomes a manifest aggregator.
  Nothing is wasted.

Revisit MFE only if/when a live plugin marketplace becomes a real roadmap item.

## 3. Convention contract

A module contributes a settings surface by:

1. Declaring it in its manifest:
   ```ts
   settings: [
     {
       id: "wellness", // matches the route/view id
       label: "Wellness",
       path: "/settings/wellness", // route the surface mounts at
       scope: "user", // ModuleScope
       order: 40,
       permissionId: "wellness.view",
       entry: "./settings" // NEW field — relative path within the package
     }
   ];
   ```
2. Exporting a default React component from that entry path:
   `packages/wellness/src/settings/index.tsx` → `export default function WellnessSettings(props) {}`

### `ModuleSettingsSurfaceManifest` extension

Add `entry?: string` to `ModuleSettingsSurfaceManifest` (`packages/module-sdk/src/index.ts`).
`entry` is a relative path within the contributing package (no leading `./` required, normalized by
the scanner). Omitting `entry` keeps the field purely declarative (route/label only, no UI) for
surfaces a module wants to advertise but not yet render — these show the graceful fallback (§6).

### Component contract

```ts
// @jarv1s/settings-ui — the props every contributed surface receives
export interface ModuleSettingsSurfaceProps {
  readonly onBack: () => void; // return to the modules list
  readonly onSelectSection?: (cat: string) => void; // navigate to another settings cat
  readonly onNavigate?: (path: string) => void; // navigate to an app route
}
```

Contributed components import atoms from `@jarv1s/settings-ui`, API helpers from
`@jarv1s/shared`/their own client, and React Query directly. They **must not** import from
`apps/web/*`.

## 4. Build-time scan plugin

New Vite plugin `vite-module-settings-scanner` (lives in the new `@jarv1s/settings-ui` package or a
sibling; see §8). Responsibilities:

1. Enumerate module packages: workspace `packages/*` whose `package.json` name starts with
   `@jarv1s/`, plus `node_modules/@jarv1s-*` (for future published modules).
2. Import each package's manifest (manifests are source-exported, no build step).
3. For each manifest, read `settings[]`; for each surface with a non-empty `entry`, register a
   `Record<moduleId, () => Promise<{ default: Component }>>` entry pointing at
   `@jarv1s/<pkg>${entry}` via Vite's dynamic `import()`.
4. Emit a virtual module `virtual:jarvis-module-settings` exporting `MODULE_SETTINGS_COMPONENTS` (the
   generated map) and `MODULE_SETTINGS_SURFACES` (the declarative metadata list).
5. Fail the build loudly if two modules claim the same `path` (mirrors the existing
   `route-guard.ts` route-collision check).

`apps/web` imports `virtual:jarvis-module-settings` once; `<ModuleSettingsRouter>` is the only
consumer.

### Dev vs prod

In dev, the virtual module regenerates on manifest change (HMR). In prod, it is generated once at
build and tree-shaken normally. No runtime filesystem scan.

## 5. Core web changes

- New `<ModuleSettingsRouter>` (in `apps/web/src/settings/`): reads
  `MODULE_SETTINGS_SURFACES` to extend the Modules pane's "Configure" affordance, and on
  navigation renders `React.lazy(MODULE_SETTINGS_COMPONENTS[moduleId])` inside a per-surface
  `<ErrorBoundary>` + `<Suspense>`.
- The Modules pane (`settings-personal-data-panes.tsx` `ModulesPane`) gains a generic branch: if a
  module declares a settings surface, its "Configure" link routes to the contributed component
  instead of the hardcoded `BriefingSettings`/`ChatSettingsView`/`NotificationSettings` switch.
- **Legacy subviews stay put.** Briefings/Chat/Notifications remain in
  `settings-module-subviews.tsx` for this slice. A follow-up cleanup migrates them to contributed
  surfaces (out of scope here) once the connector is proven.

## 6. Graceful fallback

If `manifest.settings[].entry` is present but no matching component is in the generated map (e.g. a
manifest advertises a surface the client doesn't have code for — a third-party module whose client
bundle isn't installed), the router renders a typed fallback:

> **[Module Name] settings**
> This module declares settings but its client surface isn't installed. Rebuild with the module
> package present to configure it here.

Never a blank screen, never a crash. The `<ErrorBoundary>` wraps every contributed component so a
thrown render error in one module's settings can't kill the whole Settings page.

## 7. `@jarv1s/settings-ui` package

Full extraction of `apps/web/src/settings/settings-ui.tsx` into a new workspace package:

- **Exports:** `Switch`, `Segmented`, `Badge` (+ `BadgeTone`), `ComingSoon`, `Avatar`, `Indicator`,
  `Select`, `PaneHead`, `Group`, `Row`, `Field`, `Choice`, `Note`, `Locked`, `NotWired`,
  `formatTimestamp`, plus the new `ModuleSettingsSurfaceProps` type and the
  `<ModuleSettingsRouter>` host component (or the router stays in web and only the atoms move —
  decide in implementation; atoms must move regardless).
- **CSS:** the settings atoms' styles currently live in `apps/web/src/styles/`. Move the
  settings-related rules into the package as a colocated CSS file that `apps/web/src/styles/index.css`
  `@import`s, OR keep CSS in web and have the package ship class names only. **Decision: keep CSS in
  `apps/web`** (one stylesheet, atoms are structural/className-only). The package exports components
  that render the established classNames; styling remains centralized. This avoids CSS-in-JS or
  per-package CSS fragmentation for now.
- **`apps/web/src/settings/settings-ui.tsx`** becomes a one-line re-export:
  `export * from "@jarv1s/settings-ui";` — every existing core file keeps working unchanged. (Full
  migration of core imports to the package is a later cleanup, out of scope here.)

`package.json` deps: `react`, `@jarv1s/shared` (for shared types), nothing else. No `apps/web` or
`@jarv1s/db` dependency — this package is presentation-only.

## 8. Where the scan plugin lives

Two options, pick in implementation:

- **In `@jarv1s/settings-ui`** as a sub-export (`@jarv1s/settings-ui/vite`). Pro: one package for
  the whole settings-surface story. Con: a presentation package now also owns build tooling.
- **In a sibling `@jarv1s/module-settings-scanner`** package. Pro: clean separation. Con: another
  package.

**Recommendation:** `@jarv1s/settings-ui/vite` — the atoms and the scanner are co-evolving parts of
the same "module settings surface" contract, and a fourth tiny package adds bookkeeping without
isolation benefit. Reconsider if the scanner grows large.

## 9. Security & invariants

- **No new context fields.** `AccessContext` stays `{ actorUserId, requestId }`. `ToolContext` stays
  as-is. The connector is a build-time UI-discovery mechanism; it carries no runtime authority.
- **Contributed components run with the user's own session.** A contributed settings component is
  client-side React calling the same `/api/*` routes the rest of the app does; it gains no
  privileges. RLS still applies. A buggy/malicious contributed component can at worst call APIs the
  user is already authorized for — same trust boundary as any other client code.
- **No secrets in atoms.** The `@jarv1s/settings-ui` package must never touch secrets, tokens, or
  connector credentials. Secret-bearing inputs (e.g. OAuth client secret) stay in the owning
  module's component, which already enforces encryption-at-rest via the existing settings routes.
- **Per-module `<ErrorBoundary>`** ensures one module's settings crash is contained.

## 10. Testing

- **Unit:** scanner, given a fixture set of manifests, produces the expected map; collisions fail
  loudly; surfaces without `entry` are excluded from the map but kept in the metadata list.
- **Unit:** `MODULE_SETTINGS_COMPONENTS` resolves each entry to a lazy component.
- **Integration (web):** a test-fixture module declaring a settings surface renders inside
  `<ModuleSettingsRouter>`; the fallback renders when `entry` is missing from the map.
- **Build smoke:** `pnpm verify:foundation` includes a check that every `manifest.settings[].entry`
  points at a file that exists in its package (catches dead pointers at build time).

## 11. Rollout / blast radius

- `packages/module-sdk/src/index.ts` — add `entry?: string` to `ModuleSettingsSurfaceManifest`.
- New package `@jarv1s/settings-ui` — extracted atoms + scan plugin + router (or router stays in web).
- `apps/web/src/settings/settings-ui.tsx` — becomes a re-export shim.
- `apps/web/src/settings/settings-personal-data-panes.tsx` (`ModulesPane`) — generic
  contributed-surface branch alongside the legacy subview switch.
- `apps/web/vite.config.ts` — register the scan plugin.
- No DB migrations. No API routes. No new permissions (the existing `wellness.view` etc. gate the
  routes the contributed components call).

Legacy Briefings/Chat/Notifications subviews are untouched. Wellness consent (#474 follow-up slice)
becomes the first real contributed surface.

## 12. Out of scope

- Migrating Briefings/Chat/Notifications to contributed surfaces (later cleanup).
- MFE / runtime plugin loading (deferred until live plugin marketplace is real).
- Per-module CSS theming (CSS stays centralized for now).
- A module marketplace or discovery UI (modules are configured at deploy time).
