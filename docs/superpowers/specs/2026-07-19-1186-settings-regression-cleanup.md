# #1186 — Settings regression cleanup

**Status:** Approved by Ben from live Agentation feedback on 2026-07-19  
**Issue:** #1186  
**Tier:** Routine UI regression repair  
**Builds on:** approved #986, #988, #991, and #993 specs

## Problem

Several landed Settings surfaces still look or behave unlike their approved design: Assistant
persona copy wraps too early, selected persona options look unselected, a locked model uses a
half-designed row, the left rail scroll boundary is misplaced, and Host connection guidance assumes
commands run directly on the host instead of through Docker Compose.

The Appearance annotation may already be satisfied by #988's independent theme/color-mode model and
must be live-tested before code changes. Persona preview and connector-cap messaging have separate
root-cause/spec owners (#1191 and #1192); People-folder presentation belongs to #1181.

## Decisions

1. **Appearance:** verify that changing light/dark mode leaves the selected built-in accent theme in
   effect. Change code only if the approved #988 behavior regressed.
2. **Persona layout:** remove only the width rule that causes premature description wrapping. Reuse
   the existing segmented/pressed-state primitive so selection is visually clear and remains exposed
   accessibly.
3. **Locked model:** use the same model field layout as the editable state, disabled and paired with
   a short reason/recovery note. Do not create a second card style or a text-only pseudo-setting.
4. **Settings rail:** align the sticky/scroll boundary with the top settings bar. Preserve internal
   scrolling when a genuinely short viewport cannot fit the navigation.
5. **Host guidance:** show commands that work from the documented Docker Compose deployment
   directory. Use the existing Note/code typography and active multiplexer state; never expose local
   filesystem paths or environment values.

## Scope

- `~/Jarv1s/apps/web/src/settings/settings-ai-pane.tsx`
- Existing Settings CSS containing card-description and rail rules
- `~/Jarv1s/apps/web/src/settings/settings-admin-panes.tsx`
- Focused existing Settings tests; one small regression test per changed behavior

## Explicitly separate

- #1191: Assistant persona preview CLI failure and safe error mapping
- #1192: connector cap cause/scope/freshness/recovery contract
- #1181: People folder selector/model and related typography
- #1182: remove non-actionable embedding controls

## Acceptance

- [ ] Light/dark mode and accent theme remain independent in a real browser.
- [ ] Persona descriptions use available width and selection is visually/accessibly unambiguous.
- [ ] The locked model uses the standard disabled field layout and explains how it becomes editable.
- [ ] The first navigation item remains visible until viewport height truly requires rail scrolling.
- [ ] Herdr and tmux commands work from the documented Docker Compose deployment directory.
- [ ] No visible Settings control is a no-op, and no new Settings section consists only of decorative
      text.
- [ ] A low-cost visual-QA agent clicks every interactive control in the touched sections at desktop
      and narrow widths. Screenshots alone are insufficient; any no-op or misleading control fails.
- [ ] Focused tests, design-token check, typecheck, and live `5178` evidence are green before resolving
      annotations.
