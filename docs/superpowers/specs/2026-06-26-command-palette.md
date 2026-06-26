# Command palette / Ctrl-K quick actions (#518)

**Status:** proposed
**Date:** 2026-06-26
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/apps/web/src/styles/kit-tasks.css` (`.kbar*` command-palette pattern already present), `~/Jarv1s/apps/web/src/app-route-metadata.ts` (`buildShellNavigation`, route grouping, hidden-nav rules), `~/Jarv1s/apps/web/src/shell/app-shell.tsx` (global shell + topbar action model), `~/Jarv1s/apps/web/src/settings/settings-personal-data-panes.tsx` (module/configure routing), `~/Jarv1s/apps/web/src/settings/settings-feedback.tsx` (normal app toast/confirm behavior), `~/Jarv1s/apps/web/src/tasks/task-capture.tsx` (quick-add task pattern), `~/Jarv1s/apps/web/src/tasks/tasks-page.tsx` (task list query + current task creation flow), `~/Jarv1s/apps/web/src/api/client.ts` (`createTask`, `listTaskLists`), `~/Jarv1s/packages/tasks/src/lists.ts` (`Personal` default list behavior), issue #518 interview decisions.

## 1. Decision

Add a **global command palette** opened by `Ctrl+K` / `Cmd+K` that behaves like the existing Claude
Design command menu pattern already reflected in Jarv1s's `.kbar` styles: a centered modal surface,
single search input, grouped result sections, arrow-key navigation, and Enter-to-run execution.

This is a **command menu**, not a global search product. v1 exposes a curated set of navigation and
safe quick actions for power users. It does **not** search tasks, notes, events, or any other user
entities, and it does **not** expose destructive/admin-heavy actions.

## 2. Product shape

- **v1 includes both navigation and actions.**
- **Commands only in v1.** No entity/global search, no "jump to task/note/event".
- **Open state shows the full visible command set immediately.** Search narrows that set; it does
  not begin from an empty screen.
- **Results are grouped, not flat.** The grouped layout from the existing `.kbar__group` pattern is
  the baseline.
- **Hide commands the actor cannot run.** The palette should feel clean, not aspirational.
- **Run immediately when possible.** If an action needs more input, the palette can stage into a
  short guided sub-flow or route into an existing fuller UI.
- **Dangerous/destructive/admin-heavy actions are out of scope for v1.**
- **Quick-create task is in scope** as a two-step palette flow: choose list, then enter title.
- **After task creation:** close the palette, keep the user on the current page, and show the normal
  app toast confirmation.

Target feel: closer to **Linear's command menu** than a universal search surface.

## 3. Why this shape

Jarv1s already has the right primitives:

- the shell already has one global frame and route model;
- settings already distinguishes between "configure in place" and "open another screen";
- the tasks module already supports fast title-first creation;
- the design system already has a command-palette visual pattern (`.kbar*`).

The lazy v1 is therefore a **thin command registry + global launcher**, not a new search platform.
That keeps scope aligned with issue #518 and leaves entity search for a later dedicated slice if it
proves necessary.

## 4. Command groups for v1

v1 should ship with grouped commands in this rough order.

### 4.1 Navigate

Fast route changes to major user-facing surfaces the actor can already access:

- Today
- Tasks
- Calendar
- Wellness
- Notifications
- Briefings
- Settings

These should derive from the same web navigation model already used by the shell, rather than from a
separate hardcoded list wherever possible. Hidden shell items that are intentionally not primary nav
today may still be included here if they are user-safe destinations and the user has permission.

### 4.2 Tasks

Safe task commands that fit the "quick action" bar:

- Create task
- Open Tasks
- Open task settings

Only **Create task** is a mutating command in v1. It is in scope because Jarv1s already supports
fast title-first task capture and has a normal toast pattern for lightweight confirmations.

### 4.3 Appearance

Immediate personal appearance commands:

- Switch to each available theme
- Open Appearance settings

Theme switching is a good palette action because it is reversible, actor-scoped, and needs no
confirmation.

### 4.4 Settings

Safe, high-frequency settings destinations:

- Open Settings
- Open Modules settings
- Open connected accounts / data sources
- Open notifications settings
- Open tasks settings

This group should follow existing settings and module-surface routing patterns. Commands that need a
full settings pane should route there; they should not recreate a mini settings editor inside the
palette.

## 5. Explicit v1 exclusions

Do **not** include any of these in v1:

- global entity search across tasks, notes, events, email, or notifications
- destructive actions such as delete, archive, revoke, disconnect, disable, or sign out
- admin-only or owner-heavy settings/actions
- actions that require dense forms, multi-field editing, or long confirmation copy
- command history, recents, pinned commands, or AI-suggested commands
- palette-driven note/event creation

If a command is arguable, the v1 bar is simple: if it is not obviously safe, fast, and reversible,
skip it.

## 6. Filtering and visibility rules

The palette must only show commands that are actually runnable in the actor's current app state.

### 6.1 Actor permission filtering

- If a destination or action depends on a module permission, hide it when that permission is absent.
- Never show admin-only commands to non-admin actors.
- Do not render disabled items in v1; hide them entirely.

### 6.2 Module filtering

- If a module is disabled for the actor or for the instance, hide its commands.
- If a module has no user-facing route or no contributed settings surface, do not synthesize one.
- The palette should respect the same active-module and module-settings rules already used by the
  shell and settings surfaces.

### 6.3 Surface availability filtering

- Navigation commands must point at real routes already available in web.
- Settings commands must point at an existing settings destination, not a placeholder.
- Action commands must only appear when their backing API/UI path is already present.

### 6.4 Search filtering

- Search matches command label, short description, and explicit keyword aliases.
- Search does **not** query server data in v1.
- When the query is empty, show all visible commands grouped.
- When filtered, keep grouped presentation and hide empty groups.

## 7. Interaction model

Use the existing command-palette pattern already represented by `.kbar`, not a new interaction
model.

### 7.1 Open / close

- Open from anywhere in the authenticated shell with `Ctrl+K` on Windows/Linux and `Cmd+K` on macOS.
- Focus lands in the palette input immediately.
- `Escape` closes the palette.
- Clicking the scrim closes the palette.
- If the user is typing in a text input, textarea, or contenteditable field, the shortcut should not
  steal focus unexpectedly.

### 7.2 Keyboard behavior

- `ArrowUp` / `ArrowDown` move the active row.
- `Enter` runs the active command.
- Hover and keyboard focus share the same active visual treatment.
- The footer help row can reuse the existing `.kbar__foot` pattern.

### 7.3 Grouped result UI

- Groups appear as uppercase section labels using the existing `.kbar__group` structure.
- Each item keeps the existing icon + label + description + shortcut layout.
- Empty search results show the normal empty state, not an alternate workflow.

## 8. Action behavior rules

### 8.1 Immediate actions

Run immediately, then close the palette:

- navigation commands
- theme switch commands

### 8.2 Route-to-UI actions

Close the palette, then route into the fuller existing UI:

- settings destinations
- tasks settings
- module configuration surfaces

The palette should not duplicate multi-control settings panes just because they are reachable from
the menu.

### 8.3 Staged palette actions

Use a short in-palette sub-flow only when the missing input is minimal and fits the command-menu
pattern cleanly. v1 has exactly one such action: **Create task**.

## 9. Quick-create task flow

Quick-create task is the only mutating v1 command and has a locked two-step flow.

### 9.1 Step 1: choose list

After selecting `Create task`, the palette stages into a list picker:

- show the actor's task lists from the existing tasks list query
- keep the same palette shell and search field
- let the user narrow and pick a list with keyboard or pointer

If the actor has zero lists, the app's existing default-list behavior still applies at the data
layer, but the preferred palette behavior is to surface the default/Personal list choice explicitly
when possible rather than hiding the list step.

### 9.2 Step 2: enter task title

After list selection, the palette stages into a title-entry step:

- prompt for task title only
- submit on Enter
- create the task through the existing `createTask` path
- use the chosen list's `listId`

No description, due date, priority, tags, or recurrence in v1. Those belong in the fuller task UI.

### 9.3 Success behavior

On success:

- close the palette
- keep the user on the current page
- invalidate the normal task queries so surrounding UI refreshes naturally
- show the normal app toast confirmation

### 9.4 Failure behavior

On failure:

- keep the palette open on the title-entry step
- preserve the typed title
- show the normal error feedback pattern

## 10. Accessibility and quality bar

- The palette must be keyboard-first, not keyboard-optional.
- It must expose an appropriate dialog/listbox/option pattern to assistive tech.
- Focus must return to the previously focused element when the palette closes.
- Reduced-motion users should get the existing no-animation behavior already established in the
  `.kbar` styles.

## 11. Build boundaries

This spec is intentionally a **single-slice UI affordance**, not a broader command framework.

v1 should prefer:

- one global palette host mounted from the authenticated shell
- one curated registry of commands
- reuse of existing routing, settings, toast, theme, and task APIs

v1 should avoid:

- a generalized cross-product search backend
- speculative plugin command contribution machinery
- command analytics, personalization, or ranking systems

If later slices need module-contributed commands, that can build on this surface after the core UX
proves itself.

## 12. Acceptance criteria

- [ ] `Ctrl+K` / `Cmd+K` opens a grouped command palette from anywhere in the authenticated shell.
- [ ] Opening the palette with an empty query shows the full visible command set, grouped.
- [ ] v1 includes both navigation commands and safe quick actions.
- [ ] v1 includes commands only; it does not search user entities or remote content.
- [ ] Commands the actor cannot run are hidden rather than shown disabled.
- [ ] Navigation and theme commands run immediately.
- [ ] Actions that need fuller controls route into the existing UI instead of recreating that UI in
      the palette.
- [ ] Dangerous, destructive, and admin-heavy commands are excluded from v1.
- [ ] `Create task` uses the locked two-step flow: choose list, then enter title.
- [ ] Successful task creation closes the palette, keeps the user on the same page, refreshes task
      data, and shows the normal app toast.
- [ ] The palette is keyboard-first and accessible.

## 13. Out of scope follow-ups

- global search across tasks/notes/calendar/email
- recents, favorites, command history, or usage ranking
- module-contributed command registration
- multi-step mutating flows beyond quick-create task
- destructive-action confirmations inside the palette
