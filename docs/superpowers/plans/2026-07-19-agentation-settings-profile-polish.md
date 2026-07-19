# Agentation Settings Profile Polish

## Scope

Polish only the signed-in user's Profile settings feedback batch. Keep the
existing locale API and settings structure; do not expand into other Settings
surfaces.

## Tasks

1. Update `apps/web/src/settings/settings-personal-panes.tsx`:
   - remove the signed-in user's `Active` badge while retaining the `Owner`,
     `Admin`, or `Member` badge;
   - remove the redundant Account `Role` row;
   - rename the locale group to `Location`;
   - populate the time-zone select from native `Intl.supportedValuesOf("timeZone")`;
   - disable the unsupported `Language & region` select without changing its
     persisted value or introducing a new feature surface.
2. Extend `tests/unit/settings-personal-panes.test.tsx` with focused render
   assertions covering the removed labels/badge, renamed group, disabled
   control, and broad IANA time-zone output.
3. Run the focused unit test, formatting check for touched files, lint, and
   typecheck; commit only the two task files with the required trailer.

## Exit criteria

- Profile render retains the role badge but has no signed-in Active badge or
  Account Role row.
- Profile renders `Location`, all runtime-supported IANA zones, and a disabled
  Language & region control.
- Focused test, format, lint, and typecheck checks pass.
