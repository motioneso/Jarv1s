# #1187 — Unified, actionable instance-module inventory

**Status:** Approved by Ben from live Agentation feedback on 2026-07-19  
**Issue:** #1187  
**Annotations:** `mrs7d04t-i9o3cy`, `mrs7mknx-iekzvf`, `mrs7n6bc-7aqwjr`,
`mrs7nz2f-g2ngs8`, `mrs94lf2-v77w9l`  
**Tier:** Security — admin-gated controls launch the trusted module download/activation path  
**Builds on:** module-distribution issue #964 and its lifecycle-state design

## Problem

Instance Modules presents optional built-ins and downloadable registry modules as different concepts,
shows non-actionable Required labels, duplicates per-user configuration, and asks users to interpret
raw permission identifiers before install. The result looks incomplete and obscures the actions that
actually exist.

## Decisions

1. Render one **Module library** from the existing merged lifecycle view. A module's source does not
   determine its section.
2. Show only admin-actionable rows in this surface:
   - absent and compatible → **Download and install**;
   - installed and disabled → **Enable**;
   - installed and enabled → **Disable**;
   - restart/update/failure/incompatible states keep their existing truthful action or disabled
     reason.
   Core modules that cannot be changed are not settings and are omitted instead of receiving a
   Required badge or a text-only row.
3. Do not render per-user module settings in Instance Modules. Existing **Configure** navigation
   remains the user-level owner of module preferences.
4. Installation confirmation leads with the registry/local module description. Preserve security
   review, but translate capabilities into concise user consequences (for example external network
   access, stored module data, or side-effecting tools) rather than a raw permission-name dump.
5. Show the external-module trust warning only when the inventory actually contains a module from a
   source outside the pinned Jarv1s registry. In the current first-party-only v1 it is absent.
6. Reuse existing lifecycle APIs, actions, authorization, integrity verification, and JDS controls.
   This is a presentation/composition change, not a second install state machine.

## Expected scope

- `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-instance-modules-pane.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-module-registry-section.tsx`
- Focused Settings module-inventory tests and existing install-flow browser coverage

## Non-goals

- No route, registry schema, download pipeline, hash, worker, restart, auth, RLS, or module lifecycle
  change.
- No third-party marketplace or configurable registry source.
- No new card/list abstraction or dependency.
- No weakening or removal of user-relevant install risk information.

## Acceptance

- [ ] Optional built-in and downloadable modules share one inventory and the correct lifecycle action.
- [ ] No Required badge, non-actionable core row, separate registry block, or duplicated per-user
      module settings remain.
- [ ] Install confirmation describes what the module does and retains concise, understandable risk
      consequences.
- [ ] The external-source warning appears only for an actual external source.
- [ ] Every visible action completes, changes lifecycle state, or reports a truthful disabled/error
      reason; a no-op button fails acceptance.
- [ ] A low-cost visual-QA agent clicks install/download, enable/disable, Configure, cancel, and
      confirmation actions in an isolated live/UAT instance at desktop and narrow widths.
- [ ] Independent security QA confirms admin-first authorization and the trusted download/hash path
      are unchanged; Ben explicitly signs off before merge.
