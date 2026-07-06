# Priorities Settings Design Language (#680)

**Status:** approved
**Issue:** #680
**Author:** Codex - 2026-07-04

## 1. Problem

The Priorities settings pane uses raw local markup that does not match the rest of the Settings
surface. It looks visually disconnected from the app's authored settings design language.

## 2. Decisions

- Treat this as a design-system conformance bug, not a new priority-model feature.
- Reuse existing Settings primitives and `jds-*` classes.
- Keep the current priority model behavior and API contract unchanged.
- Do not add new dependencies or a new component library.

## 3. Scope

- Update the Priorities pane to use the same visual structure as other settings panes.
- Preserve current controls:
  - priority mode;
  - anchors;
  - muted sources;
  - add/update/remove behavior;
  - loading, saving, and error states.
- Add focused tests only if the refactor changes behavior or needs a regression check.

## 4. Non-Goals

- New priority scoring behavior.
- New backend routes.
- Changes to the priority model schema.
- Broad settings redesign.

## 5. Acceptance

- Priorities settings visually match the rest of Settings.
- Existing priority model editing still works.
- The pane has no obvious raw/unmatched local styling compared with adjacent settings panes.
- Existing tests and typecheck pass.

## 6. Files In Play

- `~/Jarv1s/packages/settings-ui/src/priority/index.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-ui.tsx`
- `~/Jarv1s/apps/web/src/styles/settings.css`
- `~/Jarv1s/apps/web/src/styles/settings-panes.css`
- `~/Jarv1s/apps/web/src/styles/settings-panes-2.css`
- `~/Jarv1s/apps/web/src/styles/settings-panes-3.css`
