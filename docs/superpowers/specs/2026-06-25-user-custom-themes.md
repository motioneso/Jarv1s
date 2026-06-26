# User-created custom themes (#477)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/apps/web/src/styles/tokens.css` (CSS custom properties: paper/ink/line
surfaces, `--accent` = `--pine`, semantic `--amber`/`--red`/`--steel` with soft/ink/hover derivatives),
`apps/web/src/shell/app-shell.tsx:86-95` (`data-theme` attribute on `<html>`, `loadShellTheme`/
`saveShellTheme` in `theme-storage.ts`, theme is `"light" | "dark"` today), CLAUDE.md "preserve the
authored design system" + "keep raw CSS colors in `tokens.css` only".

## 1. Decision

Users can create, name, save, and select **custom themes** with full control over **aesthetic** color
tokens via an in-browser color picker (RGB/HEX) and **Coolors-style array paste** → palette → manual
slot assignment. **Semantic tokens (red=error, amber=caution, steel=info) are locked** — recoloring
them would hide error/caution signals, breaking the design's information architecture (CLAUDE.md
"preserve the authored design system"). Light and dark are **demoted from modes to peer themes** —
the light/dark toggle becomes theme selection; custom themes are peers to the built-ins.

## 2. Token model — aesthetic free, semantic locked

Split `tokens.css` tokens into two classes:

**Aesthetic (user-editable):** the look-and-feel backbone.

- `--paper`, `--paper-raised`, `--paper-sunken` (surfaces)
- `--ink`, `--ink-soft`, `--ink-faint` (text hierarchy)
- `--line`, `--line-soft` (borders/dividers)
- `--accent` (+ derived `--accent-hover`, `--accent-active`, `--accent-soft`, `--accent-soft-2`,
  `--accent-ink`) — the "one living accent." The user picks ONE accent hue; the soft/hover/active/ink
  variants are generated from it (color-mix / shade function) so the ramp stays coherent. Today
  `--accent` aliases `--pine`; a custom theme replaces the alias target.

**Semantic (locked, not user-editable):**

- `--red` / `--amber` / `--steel` (+ their soft/ink/hover derivatives). These carry meaning
  (error / caution / neutral-info). A custom theme inherits them unchanged from the base. The editor
  shows them read-only with a tooltip: "Locked — red signals errors, amber signals caution. These
  stay consistent across all themes so warnings are never hidden."

This split is the resolution to the CLAUDE.md "preserve the authored design system" tension: the
_aesthetic_ system is user-personalizable; the _semantic_ system (which carries information) is
preserved.

## 3. Theme = a complete token set; light/dark are peers

A **theme** is a complete set of aesthetic-token values. The built-in `light` and `dark` themes
become **two themes in a list** (no longer modes). The shell's `data-theme="<themeId>"` attribute
selects which token set applies; the existing `loadShellTheme`/`saveShellTheme` persists the active
theme id (now a string, not just light/dark).

Custom themes are peers: a user can have "Warm (built-in light)", "Dark (built-in)", "My Blue",
"Coolors Sunset" — and switch between any of them. There is no separate light/dark toggle; selecting
the dark theme IS selecting dark.

**Migration note:** existing users with `data-theme="dark"` stored migrate transparently — "dark"
becomes the active theme id, which is now the built-in dark theme. No data migration beyond reading
the existing stored value as a theme id.

## 4. Editor UX

A contributed **Appearance settings surface** (reuses the Module Settings Connector #487 — Appearance
is a natural module/section, or it lives in General; the editor itself is a settings sub-view):

- **Theme list:** built-in light, built-in dark, + the user's saved custom themes. Select = apply.
  Each custom theme has Rename / Duplicate / Delete.
- **Editor** (for a custom theme):
  - A **palette** of aesthetic-token slots (paper, ink, line, accent, + surface variants). Each slot
    shows its current color + an in-browser color picker (`<input type="color">` + a HEX/RGB text
    field).
  - **Accent is one hue** → its ramp is auto-generated and shown read-only (hover/active/soft/ink).
  - **Paste Coolors array:** a textarea accepts a Coolors-style array (e.g.
    `["#f4f1de","#e07a5f","#3d405b","#81b29a","#f2cc8f"]` or space/newline-separated hexes). Pasted
    colors populate a **staging palette** (not auto-assigned). The user then **drags or clicks** each
    staged color onto a token slot (manual assignment — per the locked decision). A staged color can
    fill any aesthetic slot; the user decides which.
  - **Live preview** of the theme applied to a sample panel (a mini app-shell with headings, a
    button, a row, a note) so the user sees the result before saving.
  - **AA contrast check** on save: accent-on-paper and paper-on-accent (and ink-on-paper) computed;
    if < 4.5:1, an inline warning ("Low contrast — text may be hard to read") shows but **save is
    allowed** (user override, informed). Semantic colors are untouched so they stay valid.
  - **Name + Save.**

## 5. Storage

Custom themes stored per-user in `app.preferences` under key `themes.custom` =
`readonly { id, name, tokens: { paper, ink, line, accent, ... } }[]`. Active theme id under
`themes.active`. Owner-scoped RLS via `app.preferences`. **No new table, no migration.**

Routes (owned by settings, user-scoped — these are the user's own themes):

- `GET /api/me/themes` → `{ builtIn: [{id:"light",...},{id:"dark",...}], custom: [...], activeId }`.
- `PUT /api/me/themes/active` body `{ id }` → sets active.
- `PUT /api/me/themes/:id` body `{ name?, tokens? }` → create or update a custom theme.
- `DELETE /api/me/themes/:id` → delete (cannot delete built-ins; cannot delete the active theme —
  switch first). Audit on delete.

The built-in light/dark token sets are server-known constants (so the GET returns their shapes and
the client never desyncs); custom themes carry only the aesthetic tokens (semantic inherited).

## 6. Application at runtime

On theme select / app load:

1. Read active theme id → fetch its token set (built-in constant or custom from preferences).
2. Apply aesthetic tokens to `:root` via `document.documentElement.style.setProperty("--paper", ...)`
   for each aesthetic token (overrides the `tokens.css` defaults for the session).
3. Semantic tokens are NOT set by custom themes — they fall through to the `tokens.css` defaults,
   preserving their meaning. (Built-in light/dark DO define their own semantic values via the
   existing `[data-theme="dark"]` block, which stays.)
4. `data-theme` attribute still set (for any CSS that keys off it), but the runtime property
   overrides win for aesthetics.

**CLAUDE.md "keep raw CSS colors in `tokens.css` only":** respected — the _source_ of colors remains
`tokens.css` (defaults) + user preferences (overrides applied at runtime via JS). No raw hex literals
appear in component CSS; custom theme colors live in the preference doc, applied as CSS variables.
This is the same mechanism as today's `data-theme`, extended.

## 7. Security & invariants

- **Owner-scoped themes.** A user's custom themes are their own (RLS); no cross-user theme sharing in
  phase-1. Admin can't set a user's theme (admin = config power only).
- **No content/security impact.** Themes are presentation; a malicious theme doc can at worst make
  the UI ugly/low-contrast (the AA warning mitigates). Tokens are applied as CSS variables — no
  HTML/JS injection surface (values are validated as hex/rgb strings before application; non-color
  values rejected).
- **Semantic-token integrity is structural.** The server only stores/persists aesthetic tokens for
  custom themes; semantic tokens are never in a custom-theme doc, so a hostile/buggy theme can't
  recolor errors even if the client tried — the runtime simply doesn't apply semantic overrides from
  custom themes.
- **No new context fields.** Standard preferences reads.

## 8. Acceptance criteria (from #477)

- [ ] A user can create, name, save, and select at least one custom theme.
- [ ] The editor offers an in-browser color picker (HEX/RGB) for each aesthetic token slot.
- [ ] A user can paste a Coolors-style color array → staging palette → manually assign colors to
      slots (no auto-assignment).
- [ ] The accent slot is one hue; its hover/active/soft/ink ramp is auto-generated and shown.
- [ ] Semantic tokens (red/amber/steel) are locked — not editable, shown read-only with a tooltip.
- [ ] Selecting a custom theme applies it consistently anywhere light/dark apply today (live preview + real app).
- [ ] Built-in light and dark remain available, unchanged, as peer themes.
- [ ] AA-contrast failure shows an inline warning but does not block save.
- [ ] Invalid color input (non-hex/rgb) is rejected with a clear error.
- [ ] Themes persist per-user (preferences), survive reload.

## 9. Rollout / blast radius

- `apps/web/src/shell/theme-storage.ts` — generalize from `"light"|"dark"` to a theme-id string;
  active-theme token loading.
- `apps/web/src/shell/app-shell.tsx` — theme selection from a list (not just a toggle); apply
  aesthetic-token overrides at runtime.
- `apps/web/src/styles/tokens.css` — document/comment the aesthetic vs semantic split (no value
  changes; the split is conceptual/editor-enforced, the file already has both).
- New `packages/settings/src/themes-routes.ts` (or in routes.ts) — the four `/api/me/themes*` routes.
- `packages/settings/src/manifest.ts` — register routes + the contributed Appearance surface.
- `packages/shared/src/*-api.ts` — theme DTOs + schemas (tokens doc shape, built-in constants).
- `apps/web/src/settings/` — Appearance settings surface: theme list + editor (picker, paste
  palette, slot assignment, live preview, AA check). Depends on #487 connector.
- Accent-ramp generation: a small pure util (`apps/web/src/theme/accent-ramp.ts`) deriving
  hover/active/soft/ink from a hue.

No DB migration (uses `app.preferences`). No new permissions.

## 10. Out of scope

- **Sharing/exporting themes** between users — phase-1 is per-user.
- **Auto-assignment** of pasted colors to slots (manual assignment per the locked decision).
- **Semantic-token editing** — explicitly locked.
- **Per-component theming** (theme overrides for one module) — whole-app themes only.
- **System/light-dark auto-switching** (`prefers-color-scheme`) — manual selection for now; could add
  a "follow system" pseudo-theme later.
- **Font/typography customization** — colors only.
- **Built-in theme editing** — built-ins are read-only; duplicate-to-custom to fork.
