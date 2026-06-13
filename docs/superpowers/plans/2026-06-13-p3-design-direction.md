# Phase 3 — Design Direction (Ritual Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the locked "Chronological Flow / Ritual" visual-language research into a taste-neutral semantic CSS token layer plus a small set of presentational React primitives, prove the direction with 2–3 static HTML mockups, then — only after Ben signs off on the mockups — apply the token layer and Ritual visual language coherently across the web shell, leading with the briefing reading surface and a time-bucket day view.

**Architecture:** This is a **presentation-only** slice (CSS + JSX + static HTML). It introduces no API fields, no DB tables/migrations, no pg-boss jobs, and no module-internal coupling. A new `apps/web/src/styles/tokens.css` becomes the single source of truth for all color/hex; `apps/web/src/styles.css` (currently 952 lines) is split so it and every resulting CSS file stay under the 1000-line `check:file-size` cap. A handful of pure presentational primitives live in `apps/web/src/ui/`. The briefing reading surface renders the existing `BriefingRunDto.summaryText` in an editorial single-column layout — it does **not** change `BriefingRunDto` or `briefings-api.ts`. There is a **hard human gate** (`AWAIT BEN'S MOCKUP SIGN-OFF`) between the pre-gate deliverable (spec + mockups + token scaffolding + primitives) and the app-wide restyle tasks.

**Tech Stack:** Plain CSS custom properties (no Tailwind, no CSS-modules), React 19 + TypeScript (`apps/web`), lucide-react icons, `@tanstack/react-query` (already wired; not changed), Playwright e2e (`tests/e2e/`, mocked REST). Verification gate: `pnpm lint` / `pnpm format:check` / `pnpm check:file-size` / `pnpm typecheck` / `pnpm verify:foundation`; visual proof via `pnpm test:e2e`.

**Grounded on:** spec `docs/superpowers/specs/2026-06-13-p3-design-direction-ritual-design.md`; repo `main` at `0bc4a92`. Run `pnpm audit:preflight` before starting; it must exit 0.

---

## Critical context for the executor (read before Task 1)

1. **There is NO web component-test runner.** `apps/web` has no Vitest / jsdom / React Testing Library. The only automated test that renders the web UI is **Playwright e2e** (`tests/e2e/`, run with `pnpm test:e2e`), which builds and serves the real Vite app and mocks REST. So:
   - For React primitives and CSS, the "failing test → pass" loop is expressed as **(a) a Playwright e2e assertion** that renders the real app through a consuming page, **and/or (b) a gate command** (`pnpm typecheck`, `pnpm check:file-size`, `grep` acceptance checks from the spec) that fails before the change and passes after. Each task states exactly which mechanism is its test.
   - **Do NOT add jsdom / Vitest / RTL to `apps/web`.** That is out of scope and would pull a new toolchain into a presentation slice.
2. **`pnpm test:e2e` is NOT part of `pnpm verify:foundation`.** The foundation gate is lint + format:check + check:file-size + typecheck + test:unit + db:migrate + test:integration. e2e is run separately and explicitly in the post-gate tasks. Both must be green at the end.
3. **`check:file-size` ignores `docs/`** (`scripts/check-file-size.ts:6-15`). So the static HTML mockups under `docs/brand/mockups/` are exempt from the 1000-line cap. **But `prettier` does NOT ignore `docs/brand/`** (`.prettierignore` only excludes `docs/audit/` and `docs/audits/`), so every mockup HTML file **must be prettier-formatted** or `pnpm format:check` fails. Always run `pnpm format` (or `npx prettier --write <file>`) on new mockup/CSS/TSX files before committing.
4. **`styles.css` is 952 lines.** Adding tokens + feature styles in place would breach the cap. The split moves tokens OUT to `tokens.css` and feature rules out to feature CSS files; `styles.css` shrinks. Verify with `wc -l` and `pnpm check:file-size` after every split task.
5. **`main.tsx` import order is load-bearing.** `tokens.css` must be imported **first** so the cascade resolves tokens before any consumer. Current imports are `./styles.css` then `./tasks/tasks.css` (`apps/web/src/main.tsx:7-8`).
6. **Never weaken a Hard Invariant** (`CLAUDE.md` → "Hard Invariants"). This slice authors no repository/migration/SQL code, changes no DTO, creates no pg-boss payload, references no AI provider/model, and renders only the already-user-facing `summaryText`. If a task seems to require any of those, STOP — it is out of scope.
7. **Coordination.** This is a shared working tree. Stage only the explicit paths each task names (`git add <paths>`). Never `git add -A` / `git add .`.
8. **HARD STOP list (taste-locked, enforced in every mockup/token/CSS task):** no purple/blue AI-glow gradients, no sparkle/magic-wand icons, no mascots/therapeutic softness, no chat-first dominance, no horizontal pagination. Normal-human-drift states use amber/muted (`--state-recovery` / `--state-attention`), **never** error-red (`--danger`).

---

## File Structure

### New files

| Path                                               | Responsibility                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/styles/tokens.css`                   | The semantic token layer: primitive ramps → semantic tokens → theme overlays (`:root` light + `[data-theme="dark"]` + `[data-theme="amber"]`). The **only** CSS file in `apps/web` allowed to contain hex/`rgb()` literals. Defines every token the app references. |
| `apps/web/src/ui/card.tsx`                         | Presentational `Card` + `Stack` layout primitives.                                                                                                                                                                                                                  |
| `apps/web/src/ui/section-header.tsx`               | Presentational `SectionHeader` (eyebrow + heading) primitive.                                                                                                                                                                                                       |
| `apps/web/src/ui/badge.tsx`                        | Presentational `Badge` with `tone` prop mapping to semantic state tokens (`neutral`/`accent`/`recovery`/`attention`) — never an error-red drift tone.                                                                                                               |
| `apps/web/src/ui/time-bucket.tsx`                  | `TimeBucket` chronology section header ("This Morning/Afternoon/Evening") with the matching `--bucket-*` accent.                                                                                                                                                    |
| `apps/web/src/ui/provisional-region.tsx`           | `ProvisionalRegion` governor wrapper: renders AI/unconfirmed content at `--provisional-opacity` with an accessible "provisional — not yet confirmed" affordance.                                                                                                    |
| `apps/web/src/ui/index.ts`                         | Barrel re-export of the `ui/` primitives.                                                                                                                                                                                                                           |
| `apps/web/src/ui/ui.css`                           | Styling for the `ui/` primitives (token-driven; no hex).                                                                                                                                                                                                            |
| `apps/web/src/briefings/briefing-reading-view.tsx` | Editorial single-column reading surface that renders one `BriefingRunDto.summaryText`.                                                                                                                                                                              |
| `apps/web/src/briefings/briefings.css`             | Styles for the briefing reading surface (newsprint off-white, comfortable measure, vertical rhythm) — token-driven.                                                                                                                                                 |
| `docs/brand/mockups/briefing-reading.html`         | Static mockup: editorial briefing reading view.                                                                                                                                                                                                                     |
| `docs/brand/mockups/day-view.html`                 | Static mockup: tasks/day view with This Morning / Afternoon / Evening buckets, circadian accents, semi-migration signifier, 70%-opacity governor block.                                                                                                             |
| `docs/brand/mockups/settings-form.html`            | Static mockup: one form-heavy screen proving the language holds on dense forms.                                                                                                                                                                                     |
| `docs/brand/mockups/_tokens.css`                   | Shared token CSS for the mockups (mirrors `tokens.css` names) so each mockup `@import`s it; keeps the three HTML files DRY and the names identical to the app.                                                                                                      |
| `tests/e2e/briefings.spec.ts`                      | Post-gate Playwright spec: sign in, open `/briefings`, select a definition with a run, assert `summaryText` renders in the reading surface.                                                                                                                         |

### Modified files

| Path                                                | Change                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/main.tsx:7-8`                         | Import `./styles/tokens.css` first, then `./styles.css`, `./ui/ui.css`, `./tasks/tasks.css`, `./briefings/briefings.css`.                                                                       |
| `apps/web/src/styles.css`                           | Remove the `:root` hex token block and inline hex/`rgb()` literals, replacing them with semantic `var()` references; net line count drops below 1000.                                           |
| `apps/web/src/tasks/tasks.css`                      | Replace hardcoded priority/matrix hex and inline `var(--x, #fallback)` fallbacks with semantic tokens; add time-bucket section styling.                                                         |
| `apps/web/src/briefings/briefings-page.tsx:402-436` | Replace the selected run's `.chat-message` body rendering with `BriefingRunView` (the editorial reading surface); keep the definitions/editor column intact and the React Query keys unchanged. |
| `apps/web/src/tasks/tasks-page.tsx`                 | Token/visual-rhythm restyle only (no new persisted view, no new `TaskDefaultView`, no time-bucket data field).                                                                                  |
| `apps/web/src/settings/settings-page.tsx`           | Token adoption only (panels, definition lists, provider status rows).                                                                                                                           |
| `apps/web/src/chat/chat-drawer.tsx`                 | Token adoption for chrome; stays a secondary tool (no chat-first dominance); provisional replies may use `ProvisionalRegion`.                                                                   |
| `apps/web/src/notifications/notifications-page.tsx` | Token adoption; unread uses `--state-attention` (amber/accent), never error-red.                                                                                                                |
| `apps/web/src/auth/auth-screen.tsx`                 | Token adoption only.                                                                                                                                                                            |

> Calendar/Email pages are `ComingSoon` stubs owned by the connector-sync slice; this slice does **not** rebuild them. It only ships the token layer + primitives they will consume.

---

## Pre-gate phase (overnight deliverable — token scaffolding + primitives + mockups)

> Tasks 1–9 are the **pre-gate** deliverable. They restyle **nothing app-wide**: they create the token file, split `styles.css` so every file stays under the cap (a pure mechanical move with no visual change), add the primitives, and produce the mockups. After Task 9, STOP at the `AWAIT BEN'S MOCKUP SIGN-OFF` gate. Tasks 10+ run only after Ben approves the mockups.

---

### Task 1: Create the semantic token file (three tiers, dark/amber-ready)

**Files:**

- Create: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/main.tsx:7-8`

This task adds the token file and imports it first. It does **not** yet remove hex from `styles.css` (Task 3 does that), so visually nothing changes yet — tokens are defined and available.

- [ ] **Step 1: Write the failing test (an acceptance grep that must pass after the change)**

The spec's acceptance check #2 requires every token referenced in the app to be defined in `tokens.css`. Write a throwaway verification command and confirm it currently FAILS (the file does not exist yet):

Run:

```bash
test -f apps/web/src/styles/tokens.css && echo "EXISTS" || echo "MISSING"
```

Expected: `MISSING`

- [ ] **Step 2: Create `apps/web/src/styles/tokens.css` with the complete token layer**

Create the file with EXACTLY this content (primitive ramps → semantic tokens → theme overlays). This file is the ONLY place hex literals are allowed.

```css
/*
 * Jarv1s semantic token layer (Phase 3 — Ritual Model).
 * The ONLY CSS file in apps/web permitted to contain hex / rgb() literals.
 *
 * Tier 1: primitive ramps (raw values, never used by components directly).
 * Tier 2: semantic tokens (purpose-named; components use ONLY these).
 * Tier 3: theme overlays ([data-theme] re-point semantic tokens, not primitives).
 *
 * Ships light-first: no theme toggle in this slice. The dark/amber overlays are
 * authored so a future slice can switch by setting data-theme on <html>.
 */

:root {
  /* ---- Tier 1: primitive ramps ---- */
  /* Neutral (newsprint -> ink) */
  --ramp-neutral-0: #ffffff;
  --ramp-neutral-50: #f7f8fa;
  --ramp-neutral-75: #f1efe9; /* newsprint off-white for editorial surfaces */
  --ramp-neutral-100: #eef3f2;
  --ramp-neutral-150: #edf0f2;
  --ramp-neutral-200: #d9dee3;
  --ramp-neutral-500: #5d6874;
  --ramp-neutral-700: #2b343c;
  --ramp-neutral-900: #172026;

  /* Brand teal/green (accent) */
  --ramp-teal-500: #0f766e;
  --ramp-teal-600: #0b5f59;
  --ramp-teal-050: #f4faf8;

  /* Amber (warning / recovery / circadian evening) */
  --ramp-amber-500: #b45309;
  --ramp-amber-300: #d9920a;
  --ramp-amber-100: #fdf3e3;

  /* Danger (RESERVED for genuine system/validation failures only) */
  --ramp-danger-500: #be123c;

  /* Circadian time-of-day hues (Morning Bright -> Evening Amber) */
  --ramp-morning: #2f9e8f; /* bright teal-green */
  --ramp-afternoon: #c98a1a; /* warm midday gold */
  --ramp-evening: #b4632a; /* campfire amber-orange */

  /* ---- Tier 2: semantic tokens (components use ONLY these) ---- */
  /* Surfaces */
  --surface: var(--ramp-neutral-0);
  --surface-raised: var(--ramp-neutral-0);
  --surface-subtle: var(--ramp-neutral-100);
  --surface-active: var(--ramp-teal-050);
  --surface-app: var(--ramp-neutral-50);
  --surface-editorial: var(--ramp-neutral-75);

  /* Text */
  --text: var(--ramp-neutral-900);
  --text-muted: var(--ramp-neutral-500);
  --text-on-accent: var(--ramp-neutral-0);

  /* Borders */
  --border-default: var(--ramp-neutral-200);
  --border-subtle: var(--ramp-neutral-150);

  /* Accent */
  --accent: var(--ramp-teal-500);
  --accent-strong: var(--ramp-teal-600);
  --accent-soft: var(--ramp-teal-050);

  /* State — anti-shame: drift uses amber/muted, NEVER danger */
  --state-attention: var(--ramp-amber-300);
  --state-attention-surface: var(--ramp-amber-100);
  --state-recovery: var(--ramp-amber-500);
  --warning: var(--ramp-amber-500);

  /* Danger reserved for true system/validation failure */
  --danger: var(--ramp-danger-500);

  /* Governor: provisional / AI-draft opacity (research §2: 70%) */
  --provisional-opacity: 0.7;

  /* Time-bucket accents (chronology) */
  --bucket-morning: var(--ramp-morning);
  --bucket-afternoon: var(--ramp-afternoon);
  --bucket-evening: var(--ramp-evening);

  /* Legacy aliases kept so existing class rules resolve during the migration.
     styles.css currently references --ink, --muted, --panel, --panel-subtle, --border. */
  --ink: var(--text);
  --muted: var(--text-muted);
  --panel: var(--surface);
  --panel-subtle: var(--surface-subtle);
  --border: var(--border-default);

  /* Focus ring (teal at 28% — single source so consumers stop hardcoding rgb) */
  --focus-ring: rgb(15 118 110 / 0.28);
  /* Elevation shadows */
  --shadow-panel: 0 14px 36px rgb(23 32 38 / 0.08);
  --shadow-drawer: -8px 0 24px rgb(15 23 42 / 0.12);
  --scrim: rgb(23 32 38 / 0.36);

  /* App chrome base (was the bare color/background pair on :root in styles.css) */
  color: var(--text);
  background: var(--surface-app);
}

/* ---- Tier 3: theme overlays (re-point SEMANTIC tokens only) ---- */
/* Dark: not shipped/toggled in this slice; authored as the forward seam. */
[data-theme="dark"] {
  --surface: #11181d;
  --surface-raised: #161f25;
  --surface-subtle: #1b252c;
  --surface-active: #14302c;
  --surface-app: #0c1216;
  --surface-editorial: #161b1f;

  --text: #e7edf0;
  --text-muted: #9aa7b1;
  --text-on-accent: #ffffff;

  --border-default: #2b343c;
  --border-subtle: #222b32;

  --accent: #2f9e8f;
  --accent-strong: #46b3a4;
  --accent-soft: #14302c;

  --state-attention: #e0a83a;
  --state-attention-surface: #2c2415;
  --state-recovery: #d9920a;
  --warning: #d9920a;
  --danger: #f0668a;

  --focus-ring: rgb(70 179 164 / 0.4);
  --shadow-panel: 0 14px 36px rgb(0 0 0 / 0.4);
  --shadow-drawer: -8px 0 24px rgb(0 0 0 / 0.45);
  --scrim: rgb(0 0 0 / 0.55);
}

/* Amber: evening "campfire" overlay (circadian Evening Amber). Forward seam only. */
[data-theme="amber"] {
  --surface: #1c1408;
  --surface-raised: #241a0c;
  --surface-subtle: #2a1f0f;
  --surface-active: #34260f;
  --surface-app: #160f06;
  --surface-editorial: #221a0d;

  --text: #f3e4cb;
  --text-muted: #c8af86;
  --text-on-accent: #1c1408;

  --border-default: #4a3a1d;
  --border-subtle: #3a2d16;

  --accent: #d9920a;
  --accent-strong: #efa628;
  --accent-soft: #34260f;

  --state-attention: #efa628;
  --state-attention-surface: #34260f;
  --state-recovery: #d9920a;
  --warning: #d9920a;
  --danger: #e0668a;

  --focus-ring: rgb(217 146 10 / 0.4);
  --shadow-panel: 0 14px 36px rgb(0 0 0 / 0.4);
  --shadow-drawer: -8px 0 24px rgb(0 0 0 / 0.45);
  --scrim: rgb(0 0 0 / 0.5);
}
```

- [ ] **Step 3: Wire the import order in `main.tsx`**

Replace lines 7-8 of `apps/web/src/main.tsx`:

```tsx
import { App } from "./app";
import { registerServiceWorker } from "./pwa/register-service-worker";
import "./styles/tokens.css";
import "./styles.css";
import "./tasks/tasks.css";
```

(tokens.css FIRST so the cascade resolves tokens before any consumer.)

- [ ] **Step 4: Run the gate + acceptance checks (verify PASS)**

```bash
test -f apps/web/src/styles/tokens.css && echo "EXISTS"
pnpm format apps/web/src/styles/tokens.css apps/web/src/main.tsx
pnpm format:check
pnpm typecheck
pnpm check:file-size
```

Expected: `EXISTS`; format:check passes; typecheck passes; `No checked files exceed 1000 lines.` (styles.css is still 952 — under the cap — until the split; this confirms adding the new file did not breach anything.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/tokens.css apps/web/src/main.tsx
git commit -m "feat(web): add semantic token layer (tokens.css, dark/amber-ready)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Verify every referenced token is now defined (close the undefined-token gap)

**Files:**

- Test (acceptance check, no file change): `apps/web/src/styles/tokens.css`, `apps/web/src/tasks/tasks.css`

The spec (acceptance #2) calls out five tokens `tasks.css` references that `:root` never defined: `--text-muted`, `--surface-subtle`, `--surface-active`, `--border-subtle`, `--border`. Task 1 defined all five. This task is the verification that the gap is closed before any component is converted.

- [ ] **Step 1: Write the failing test (collect referenced vs defined tokens)**

Run this to list every custom property _referenced_ via `var(` in `apps/web/src` but **not** defined in `tokens.css`:

```bash
comm -23 \
  <(grep -rhoE 'var\(--[a-z0-9-]+' apps/web/src --include='*.css' --include='*.tsx' | sed 's/var(//' | sort -u) \
  <(grep -oE '^\s*--[a-z0-9-]+' apps/web/src/styles/tokens.css | tr -d ' ' | sort -u)
```

- [ ] **Step 2: Run it and confirm the five-token gap is now CLOSED**

Expected output: the five spec-named tokens (`--text-muted`, `--surface-subtle`, `--surface-active`, `--border-subtle`, `--border`) must NOT appear. If any token still appears, add it to the Tier-2 block of `tokens.css` (as a semantic alias of the appropriate primitive) and re-run until the only remaining entries (if any) are tokens defined by Tasks 4–6 not yet written — note those and move on. The five spec tokens MUST be absent.

- [ ] **Step 3: If any spec-named token is missing, add it to `tokens.css`**

(Only if Step 2 surfaced one of the five.) Add the missing semantic alias under Tier 2, e.g.:

```css
--surface-subtle: var(--ramp-neutral-100);
```

- [ ] **Step 4: Re-run the check (verify PASS) and format**

```bash
comm -23 \
  <(grep -rhoE 'var\(--[a-z0-9-]+' apps/web/src --include='*.css' --include='*.tsx' | sed 's/var(//' | sort -u) \
  <(grep -oE '^\s*--[a-z0-9-]+' apps/web/src/styles/tokens.css | tr -d ' ' | sort -u)
pnpm format apps/web/src/styles/tokens.css
pnpm format:check
```

Expected: none of the five spec tokens appears; format:check passes.

- [ ] **Step 5: Commit (only if `tokens.css` changed; otherwise skip)**

```bash
git add apps/web/src/styles/tokens.css
git commit -m "fix(web): define previously-undefined tokens referenced by tasks.css

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Remove hex from styles.css (token adoption + split-readiness)

**Files:**

- Modify: `apps/web/src/styles.css` (replace every hex/`rgb()` literal with a semantic `var()`)

This converts the base/layout stylesheet to tokens. It is a mechanical 1:1 swap — no visual change (the tokens resolve to the same values the hex had). After this, `tokens.css` is the only file in `apps/web` containing hex.

- [ ] **Step 1: Write the failing test (the spec's hex-isolation acceptance check)**

Spec acceptance #1: `grep` for hex/`rgb()` in `apps/web/src` CSS must match **only** `tokens.css`. Run it now and confirm it currently FAILS (styles.css still has hex):

```bash
grep -rlE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'
```

Expected (before): lists `apps/web/src/styles.css` (and `apps/web/src/tasks/tasks.css`) in addition to `tokens.css`.

- [ ] **Step 2: Replace hex/rgb in `styles.css` with semantic tokens**

Edit `apps/web/src/styles.css` and make these exact replacements:

1. Delete the `:root { ... }` block entirely (lines 1-25) — `color`, `background`, the font stack, and the nine `--*` tokens. The font stack must NOT be lost; re-add it as a body rule. Replace the whole `:root { ... }` block with:

```css
:root {
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
  font-synthesis: none;
  line-height: 1.5;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
```

(`color`, `background`, and all `--*` tokens now come from `tokens.css`'s `:root`, which is imported first; both `:root` blocks merge in the cascade.)

2. `.auth-panel, .panel { ... box-shadow: 0 14px 36px rgb(23 32 38 / 0.08); }` → `box-shadow: var(--shadow-panel);`
3. `input, select, textarea { ... background: #ffffff; }` → `background: var(--surface);`
4. `input:focus, ... { outline: 3px solid rgb(15 118 110 / 0.28); }` → `outline: 3px solid var(--focus-ring);`
5. `.primary-button { ... color: #ffffff; }` → `color: var(--text-on-accent);`
6. `.secondary-button, .ghost-button, .icon-button { background: #ffffff; ... }` → `background: var(--surface);`
7. `.notification-badge { ... border: 2px solid #ffffff; ... background: var(--danger); color: #ffffff; }` → `border: 2px solid var(--surface);` and `color: var(--text-on-accent);` (the badge is a true unread count, not human drift — `--danger` stays here intentionally; if the coherent pass later reclassifies it, Task 14 handles it).
8. `.segmented-control { ... background: #eef1f4; }` → `background: var(--surface-subtle);`
9. `.segmented-control button.active { background: #ffffff; ... box-shadow: 0 1px 3px rgb(23 32 38 / 0.12); }` → `background: var(--surface);` and `box-shadow: 0 1px 3px rgb(23 32 38 / 0.12);` → add a token `--shadow-control: 0 1px 3px rgb(23 32 38 / 0.12);` to `tokens.css` Tier 2 and use `box-shadow: var(--shadow-control);`
10. `.sidebar { ... background: #ffffff; }` → `background: var(--surface);`
11. `.brand-mark { ... color: #ffffff; }` → `color: var(--text-on-accent);`
12. `.topbar { ... background: rgb(247 248 250 / 0.92); }` → add token `--surface-topbar: rgb(247 248 250 / 0.92);` to `tokens.css` and use `background: var(--surface-topbar);`
13. `.definition-list div, .compact-row { ... border-bottom: 1px solid #edf0f2; }` → `border-bottom: 1px solid var(--border-subtle);`
14. `.task-row { ... background: #ffffff; }` → `background: var(--surface);`
15. `.task-row.done { background: #f4faf8; }` → `background: var(--accent-soft);`
16. `.ai-config-row, .connector-account-row { ... background: #ffffff; }` → `background: var(--surface);`
17. `.capability-result { ... background: #ffffff; }` → `background: var(--surface);`
18. `.chat-thread-button { ... background: #ffffff; ... }` → `background: var(--surface);`
19. `.chat-thread-button.active { border-color: rgb(15 118 110 / 0.55); background: #f4faf8; }` → add token `--border-accent: rgb(15 118 110 / 0.55);` to `tokens.css`; use `border-color: var(--border-accent);` and `background: var(--accent-soft);`
20. `.chat-message { ... background: #ffffff; }` → `background: var(--surface);`
21. `.chat-message.assistant { background: #f7fcfb; }` → `background: var(--accent-soft);`
22. `.notification-row.unread { border-color: rgb(15 118 110 / 0.45); background: #f7fcfb; }` → add token `--border-attention: rgb(15 118 110 / 0.45);` and use `border-color: var(--border-attention);` and `background: var(--accent-soft);`
23. `.task-meta span { ... background: #edf0f2; ... }` → `background: var(--border-subtle);`
24. `.empty-state { ... background: #ffffff; ... }` → `background: var(--surface);`
25. `.loading-mark { ... border: 4px solid #d9dee3; ... }` → `border: 4px solid var(--border-default);`
26. `.chat-drawer { ... background: var(--surface, #ffffff); ... box-shadow: -8px 0 24px rgb(15 23 42 / 0.12); }` → `background: var(--surface);` and `box-shadow: var(--shadow-drawer);`
27. `.provider-indicator { ... background: #edf0f2; ... }` → `background: var(--border-subtle);`
28. `.sidebar-scrim { ... background: rgb(23 32 38 / 0.36); }` → `background: var(--scrim);`

For each of the four "add a token" steps (9, 12, 19, 22) add these to the Tier-2 block of `tokens.css`:

```css
--shadow-control: 0 1px 3px rgb(23 32 38 / 0.12);
--surface-topbar: rgb(247 248 250 / 0.92);
--border-accent: rgb(15 118 110 / 0.55);
--border-attention: rgb(15 118 110 / 0.45);
```

And add their dark/amber overlay re-points (keep simple): in `[data-theme="dark"]` and `[data-theme="amber"]` add `--surface-topbar: var(--surface-app);` `--border-accent: var(--accent);` `--border-attention: var(--accent);` `--shadow-control: 0 1px 3px rgb(0 0 0 / 0.4);`

- [ ] **Step 3: Run the hex-isolation check (verify PASS)**

```bash
grep -rlE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'
```

Expected (after): lists `apps/web/src/styles/tokens.css` AND `apps/web/src/tasks/tasks.css` only (tasks.css is fixed in Task 13). `apps/web/src/styles.css` must NOT appear.

- [ ] **Step 4: Run the gate**

```bash
pnpm format apps/web/src/styles.css apps/web/src/styles/tokens.css
pnpm format:check
pnpm typecheck
pnpm check:file-size
```

Expected: all pass. (styles.css is now slightly smaller; still the next task does the line-count split.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/src/styles/tokens.css
git commit -m "refactor(web): replace styles.css hex literals with semantic tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add the `Card` + `Stack` primitives

**Files:**

- Create: `apps/web/src/ui/card.tsx`
- Create: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/main.tsx` (add `import "./ui/ui.css";`)

- [ ] **Step 1: Write the failing test (typecheck-driven)**

The primitive's "test" is that it compiles and exports the expected typed API. Create the index barrel first so the import target exists, then confirm `pnpm typecheck` FAILS because `./card` does not exist:

Create `apps/web/src/ui/index.ts`:

```ts
export { Card, Stack } from "./card";
```

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: FAIL — `Cannot find module './card'`.

- [ ] **Step 2: Write the `Card` + `Stack` implementation**

Create `apps/web/src/ui/card.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Presentational layout primitives. No data fetching, no React Query, no API
 * imports — pure styling/markup so they never cross a module boundary.
 */
export function Card(props: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "section" | "article" | "div" | "aside";
  readonly ariaLabel?: string;
}) {
  const Tag = props.as ?? "section";
  return (
    <Tag className={`ui-card ${props.className ?? ""}`.trim()} aria-label={props.ariaLabel}>
      {props.children}
    </Tag>
  );
}

export function Stack(props: {
  readonly children: ReactNode;
  readonly gap?: "sm" | "md" | "lg";
  readonly className?: string;
}) {
  const gap = props.gap ?? "md";
  return (
    <div className={`ui-stack ui-stack-${gap} ${props.className ?? ""}`.trim()}>
      {props.children}
    </div>
  );
}
```

- [ ] **Step 3: Add the styles**

Create `apps/web/src/ui/ui.css`:

```css
/* ui/ primitive styles. Token-driven; no hex literals (tokens.css owns those). */

.ui-card {
  display: grid;
  gap: 1rem;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-panel);
  padding: 1rem;
}

.ui-stack {
  display: grid;
}
.ui-stack-sm {
  gap: 0.5rem;
}
.ui-stack-md {
  gap: 1rem;
}
.ui-stack-lg {
  gap: 1.5rem;
}
```

Add the import to `apps/web/src/main.tsx` (after `./styles.css`, before `./tasks/tasks.css`):

```tsx
import "./styles/tokens.css";
import "./styles.css";
import "./ui/ui.css";
import "./tasks/tasks.css";
```

- [ ] **Step 4: Run typecheck + gate (verify PASS)**

```bash
pnpm format apps/web/src/ui/card.tsx apps/web/src/ui/ui.css apps/web/src/ui/index.ts apps/web/src/main.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm check:file-size
pnpm format:check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/card.tsx apps/web/src/ui/ui.css apps/web/src/ui/index.ts apps/web/src/main.tsx
git commit -m "feat(web): add Card + Stack ui primitives

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Add the `SectionHeader` + `Badge` primitives

**Files:**

- Create: `apps/web/src/ui/section-header.tsx`
- Create: `apps/web/src/ui/badge.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/ui/ui.css`

- [ ] **Step 1: Write the failing test (typecheck-driven)**

Extend the barrel so the imports exist, then confirm typecheck FAILS:

Edit `apps/web/src/ui/index.ts`:

```ts
export { Card, Stack } from "./card";
export { SectionHeader } from "./section-header";
export { Badge, type BadgeTone } from "./badge";
```

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: FAIL — `Cannot find module './section-header'` / `'./badge'`.

- [ ] **Step 2: Implement `SectionHeader`**

Create `apps/web/src/ui/section-header.tsx`:

```tsx
import type { ReactNode } from "react";

/** Eyebrow + heading pair, the standard page/section header treatment. */
export function SectionHeader(props: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly id?: string;
  readonly level?: 1 | 2;
  readonly actions?: ReactNode;
}) {
  const Heading = props.level === 2 ? "h2" : "h1";
  return (
    <div className="ui-section-header">
      <div>
        {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
        <Heading id={props.id} className="ui-section-title">
          {props.title}
        </Heading>
      </div>
      {props.actions ? <div className="ui-section-actions">{props.actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 3: Implement `Badge` (tone maps to semantic state tokens — never error-red for drift)**

Create `apps/web/src/ui/badge.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * tone maps to semantic state tokens. There is deliberately NO "danger"/error
 * tone: normal human drift must read as recovery/attention (amber/muted), never
 * error-red. Genuine system/validation failures use the .form-error class, not
 * this badge.
 */
export type BadgeTone = "neutral" | "accent" | "recovery" | "attention";

export function Badge(props: {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  readonly ariaLabel?: string;
}) {
  const tone = props.tone ?? "neutral";
  return (
    <span className={`ui-badge ui-badge-${tone}`} aria-label={props.ariaLabel}>
      {props.children}
    </span>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-section-header {
  min-height: 3rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.ui-section-title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
}
.ui-section-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 750;
}
.ui-badge-neutral {
  background: var(--surface-subtle);
  color: var(--text-muted);
}
.ui-badge-accent {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.ui-badge-recovery {
  background: var(--state-attention-surface);
  color: var(--state-recovery);
}
.ui-badge-attention {
  background: var(--state-attention-surface);
  color: var(--state-attention);
}
```

- [ ] **Step 5: Run typecheck + gate (verify PASS), then commit**

```bash
pnpm format apps/web/src/ui/section-header.tsx apps/web/src/ui/badge.tsx apps/web/src/ui/index.ts apps/web/src/ui/ui.css
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm check:file-size
pnpm format:check
git add apps/web/src/ui/section-header.tsx apps/web/src/ui/badge.tsx apps/web/src/ui/index.ts apps/web/src/ui/ui.css
git commit -m "feat(web): add SectionHeader + Badge ui primitives (anti-shame tones)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all gate commands pass before committing.

---

### Task 6: Add the `TimeBucket` + `ProvisionalRegion` primitives

**Files:**

- Create: `apps/web/src/ui/time-bucket.tsx`
- Create: `apps/web/src/ui/provisional-region.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/ui/ui.css`

- [ ] **Step 1: Write the failing test (typecheck-driven)**

Edit `apps/web/src/ui/index.ts`:

```ts
export { Card, Stack } from "./card";
export { SectionHeader } from "./section-header";
export { Badge, type BadgeTone } from "./badge";
export { TimeBucket, type BucketName } from "./time-bucket";
export { ProvisionalRegion } from "./provisional-region";
```

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: FAIL — `Cannot find module './time-bucket'` / `'./provisional-region'`.

- [ ] **Step 2: Implement `TimeBucket`**

Create `apps/web/src/ui/time-bucket.tsx`:

```tsx
import type { ReactNode } from "react";

export type BucketName = "morning" | "afternoon" | "evening";

const BUCKET_LABELS: Record<BucketName, string> = {
  morning: "This Morning",
  afternoon: "This Afternoon",
  evening: "This Evening"
};

/**
 * Chronology section header for the Ritual day view. Renders the bucket label
 * with the matching circadian --bucket-* accent. count is an optional glanceable
 * tally shown in the periphery.
 */
export function TimeBucket(props: {
  readonly bucket: BucketName;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  const label = BUCKET_LABELS[props.bucket];
  return (
    <section className="ui-time-bucket" aria-label={label}>
      <header className={`ui-time-bucket-header bucket-${props.bucket}`}>
        <span className="ui-time-bucket-label">{label}</span>
        {typeof props.count === "number" ? (
          <span className="ui-time-bucket-count">{props.count}</span>
        ) : null}
      </header>
      <div className="ui-time-bucket-body">{props.children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Implement `ProvisionalRegion` (the governor)**

Create `apps/web/src/ui/provisional-region.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Governor wrapper: renders AI / unconfirmed content at --provisional-opacity
 * (~0.7) with an accessible "provisional — not yet confirmed" affordance. This is
 * the "human-in-the-loop" signifier from the research; it names NO provider/model.
 */
export function ProvisionalRegion(props: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  const label = props.label ?? "Provisional — not yet confirmed";
  return (
    <div className="ui-provisional" role="group" aria-label={label}>
      <p className="ui-provisional-tag">{label}</p>
      <div className="ui-provisional-body">{props.children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `apps/web/src/ui/ui.css`:

```css
.ui-time-bucket {
  display: grid;
  gap: 0.75rem;
}
.ui-time-bucket-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.25rem 0;
  border-bottom: 2px solid var(--border-default);
}
.ui-time-bucket-header.bucket-morning {
  border-bottom-color: var(--bucket-morning);
  color: var(--bucket-morning);
}
.ui-time-bucket-header.bucket-afternoon {
  border-bottom-color: var(--bucket-afternoon);
  color: var(--bucket-afternoon);
}
.ui-time-bucket-header.bucket-evening {
  border-bottom-color: var(--bucket-evening);
  color: var(--bucket-evening);
}
.ui-time-bucket-count {
  color: var(--text-muted);
  font-weight: 600;
}

.ui-provisional {
  display: grid;
  gap: 0.35rem;
  border: 1px dashed var(--border-default);
  border-radius: 8px;
  padding: 0.75rem;
}
.ui-provisional-tag {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ui-provisional-body {
  opacity: var(--provisional-opacity);
}
```

- [ ] **Step 5: Run typecheck + gate (verify PASS), then commit**

```bash
pnpm format apps/web/src/ui/time-bucket.tsx apps/web/src/ui/provisional-region.tsx apps/web/src/ui/index.ts apps/web/src/ui/ui.css
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm check:file-size
pnpm format:check
git add apps/web/src/ui/time-bucket.tsx apps/web/src/ui/provisional-region.tsx apps/web/src/ui/index.ts apps/web/src/ui/ui.css
git commit -m "feat(web): add TimeBucket + ProvisionalRegion ui primitives (governor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all gate commands pass. This completes the 6 primitives (acceptance #5: 4–6 primitives, none importing an API client / fetch DTO / module internal — verify with `grep -rE "api/client|useQuery|@jarv1s/shared" apps/web/src/ui` returns nothing).

---

### Task 7: Mockup token stylesheet + briefing reading mockup

**Files:**

- Create: `docs/brand/mockups/_tokens.css`
- Create: `docs/brand/mockups/briefing-reading.html`

> Reminder: `docs/` is exempt from `check:file-size` but NOT from prettier. Run `pnpm format` on every mockup file before committing.

- [ ] **Step 1: Write the failing test (file-existence acceptance check)**

Spec acceptance #7 requires 2–3 self-contained mockups. Confirm none exist yet:

```bash
ls docs/brand/mockups/ 2>/dev/null || echo "MISSING"
```

Expected: `MISSING` (directory does not exist).

- [ ] **Step 2: Create the shared mockup token stylesheet**

Create `docs/brand/mockups/_tokens.css` — mirror the Tier-2 semantic names from `apps/web/src/styles/tokens.css` so sign-off transfers directly:

```css
/* Mockup token mirror — names match apps/web/src/styles/tokens.css Tier 2. */
:root {
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-subtle: #eef3f2;
  --surface-active: #f4faf8;
  --surface-app: #f7f8fa;
  --surface-editorial: #f1efe9;
  --text: #172026;
  --text-muted: #5d6874;
  --text-on-accent: #ffffff;
  --border-default: #d9dee3;
  --border-subtle: #edf0f2;
  --accent: #0f766e;
  --accent-strong: #0b5f59;
  --accent-soft: #f4faf8;
  --state-attention: #d9920a;
  --state-attention-surface: #fdf3e3;
  --state-recovery: #b45309;
  --warning: #b45309;
  --danger: #be123c;
  --provisional-opacity: 0.7;
  --bucket-morning: #2f9e8f;
  --bucket-afternoon: #c98a1a;
  --bucket-evening: #b4632a;
  --shadow-panel: 0 14px 36px rgb(23 32 38 / 0.08);
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}
```

- [ ] **Step 3: Create the briefing-reading mockup**

Create `docs/brand/mockups/briefing-reading.html` — an editorial single-column reading surface. NO purple/blue gradients, NO sparkle icons, NO horizontal pagination. Use a serif heading, newsprint surface, comfortable measure:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jarv1s — Briefing Reading (Ritual mockup)</title>
    <link rel="stylesheet" href="./_tokens.css" />
    <style>
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: var(--text);
        background: var(--surface-app);
      }
      .reading {
        max-width: 42rem;
        margin: 0 auto;
        padding: 3rem 1.5rem;
        background: var(--surface-editorial);
        min-height: 100vh;
      }
      .eyebrow {
        margin: 0 0 0.25rem;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .reading h1 {
        font-family: var(--font-serif);
        font-size: 2rem;
        line-height: 1.15;
        margin: 0 0 0.5rem;
      }
      .meta {
        color: var(--text-muted);
        font-size: 0.85rem;
        margin-bottom: 2rem;
      }
      .reading h2 {
        font-family: var(--font-serif);
        font-size: 1.25rem;
        margin: 2rem 0 0.5rem;
      }
      .reading p {
        font-size: 1.05rem;
        line-height: 1.7;
        margin: 0 0 1.1rem;
      }
      .provisional {
        opacity: var(--provisional-opacity);
        border-left: 3px solid var(--border-default);
        padding-left: 1rem;
      }
      .provisional-tag {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--text-muted);
        font-weight: 750;
      }
    </style>
  </head>
  <body>
    <article class="reading">
      <p class="eyebrow">Daily briefing</p>
      <h1>Friday, ready when you are</h1>
      <p class="meta">Generated 7:02 AM · 3 sources</p>

      <h2>What matters today</h2>
      <p>
        Three commitments need attention. The tax filing is due today; everything else can wait
        until the afternoon block. Nothing has slipped that you haven't already accounted for.
      </p>

      <h2>On your calendar</h2>
      <p>
        A 10:00 design review and a 2:30 one-on-one. The morning is otherwise open for deep work — a
        good window for the filing.
      </p>

      <h2>Worth a glance</h2>
      <p class="provisional">
        <span class="provisional-tag">Provisional — not yet confirmed</span><br />
        I noticed the contractor invoice from Tuesday is still unpaid. Want me to draft a reminder?
        I have not sent anything.
      </p>
    </article>
  </body>
</html>
```

- [ ] **Step 4: Format and verify (verify PASS)**

```bash
pnpm format docs/brand/mockups/_tokens.css docs/brand/mockups/briefing-reading.html
pnpm format:check
ls docs/brand/mockups/
```

Expected: format:check passes; the directory lists `_tokens.css` and `briefing-reading.html`. Open the HTML in a browser to eyeball it (self-contained, no build step).

- [ ] **Step 5: Commit**

```bash
git add docs/brand/mockups/_tokens.css docs/brand/mockups/briefing-reading.html
git commit -m "docs(brand): add briefing reading-view mockup (Ritual editorial)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Day-view mockup (time-buckets + circadian accents + governor + semi-migration)

**Files:**

- Create: `docs/brand/mockups/day-view.html`

- [ ] **Step 1: Write the failing test (file-existence check)**

```bash
test -f docs/brand/mockups/day-view.html && echo "EXISTS" || echo "MISSING"
```

Expected: `MISSING`.

- [ ] **Step 2: Create the day-view mockup**

Create `docs/brand/mockups/day-view.html`. It MUST show: This Morning / This Afternoon / This Evening buckets with circadian accents, a semi-migration signifier (a moved-arrow next to an unchecked box), an at-risk task rendered with the amber recovery tone (NOT error-red), and a 70%-opacity provisional governor block. NO chat-first dominance, NO sparkle icons, NO horizontal pagination:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jarv1s — Day View (Ritual mockup)</title>
    <link rel="stylesheet" href="./_tokens.css" />
    <style>
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: var(--text);
        background: var(--surface-app);
      }
      .day {
        max-width: 44rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem;
        display: grid;
        gap: 2rem;
      }
      .eyebrow {
        margin: 0 0 0.25rem;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      h1 {
        margin: 0 0 1.5rem;
        font-size: 1.6rem;
      }
      .bucket-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 0.8rem;
        font-weight: 700;
        padding-bottom: 0.4rem;
        border-bottom: 2px solid var(--border-default);
        margin-bottom: 0.75rem;
      }
      .bucket-morning .bucket-header {
        border-bottom-color: var(--bucket-morning);
        color: var(--bucket-morning);
      }
      .bucket-afternoon .bucket-header {
        border-bottom-color: var(--bucket-afternoon);
        color: var(--bucket-afternoon);
      }
      .bucket-evening .bucket-header {
        border-bottom-color: var(--bucket-evening);
        color: var(--bucket-evening);
      }
      .count {
        color: var(--text-muted);
        font-weight: 600;
      }
      .task {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.5rem 0;
        border-bottom: 1px solid var(--border-subtle);
      }
      .box {
        width: 1.1rem;
        height: 1.1rem;
        border: 2px solid var(--border-default);
        border-radius: 4px;
        flex: 0 0 auto;
      }
      .migrated {
        color: var(--text-muted);
        font-weight: 700;
      }
      .at-risk {
        margin-left: auto;
        font-size: 0.72rem;
        font-weight: 750;
        border-radius: 999px;
        padding: 0.1rem 0.5rem;
        background: var(--state-attention-surface);
        color: var(--state-recovery);
      }
      .provisional {
        border: 1px dashed var(--border-default);
        border-radius: 8px;
        padding: 0.75rem;
      }
      .provisional-tag {
        margin: 0 0 0.35rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--text-muted);
        font-weight: 750;
      }
      .provisional-body {
        opacity: var(--provisional-opacity);
      }
    </style>
  </head>
  <body>
    <main class="day">
      <div>
        <p class="eyebrow">Today</p>
        <h1>Friday</h1>
      </div>

      <section class="bucket-morning">
        <div class="bucket-header"><span>This Morning</span><span class="count">2</span></div>
        <div class="task">
          <span class="box"></span><span>File taxes</span><span class="at-risk">Due today</span>
        </div>
        <div class="task"><span class="box"></span><span>Deep work block</span></div>
      </section>

      <section class="bucket-afternoon">
        <div class="bucket-header"><span>This Afternoon</span><span class="count">2</span></div>
        <div class="task"><span class="box"></span><span>Design review notes</span></div>
        <div class="task">
          <span class="box"></span><span class="migrated">→</span><span>Renew passport</span>
          <span class="at-risk">Moved from Wed</span>
        </div>
      </section>

      <section class="bucket-evening">
        <div class="bucket-header"><span>This Evening</span><span class="count">1</span></div>
        <div class="task">
          <span class="box"></span><span>Shutdown ritual: close open loops</span>
        </div>
      </section>

      <section class="provisional">
        <p class="provisional-tag">Provisional — not yet confirmed</p>
        <div class="provisional-body">
          I can move "Renew passport" to the morning block tomorrow — it keeps slipping. Confirm and
          I'll reschedule it.
        </div>
      </section>
    </main>
  </body>
</html>
```

- [ ] **Step 3: Format and verify (verify PASS)**

```bash
pnpm format docs/brand/mockups/day-view.html
pnpm format:check
```

Expected: format:check passes. Open in a browser to confirm the buckets, circadian accents, semi-migration arrow, amber at-risk pill (NOT red), and 70%-opacity governor block render.

- [ ] **Step 4: Commit**

```bash
git add docs/brand/mockups/day-view.html
git commit -m "docs(brand): add day-view mockup (time-buckets, governor, anti-shame)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Form-heavy mockup (settings) — proves the language on dense forms

**Files:**

- Create: `docs/brand/mockups/settings-form.html`

- [ ] **Step 1: Write the failing test (file-existence check)**

```bash
test -f docs/brand/mockups/settings-form.html && echo "EXISTS" || echo "MISSING"
```

Expected: `MISSING`.

- [ ] **Step 2: Create the settings mockup**

Create `docs/brand/mockups/settings-form.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jarv1s — Settings (Ritual mockup)</title>
    <link rel="stylesheet" href="./_tokens.css" />
    <style>
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: var(--text);
        background: var(--surface-app);
      }
      .page {
        max-width: 48rem;
        margin: 0 auto;
        padding: 2.5rem 1.5rem;
        display: grid;
        gap: 1.5rem;
      }
      .eyebrow {
        margin: 0 0 0.25rem;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .panel {
        border: 1px solid var(--border-default);
        border-radius: 8px;
        background: var(--surface-raised);
        box-shadow: var(--shadow-panel);
        padding: 1.25rem;
        display: grid;
        gap: 1rem;
      }
      .panel h2 {
        margin: 0;
        font-size: 1rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.875rem;
      }
      label {
        display: grid;
        gap: 0.35rem;
        color: var(--text-muted);
        font-size: 0.84rem;
        font-weight: 650;
      }
      input,
      select {
        min-height: 2.5rem;
        border: 1px solid var(--border-default);
        border-radius: 8px;
        background: var(--surface);
        color: var(--text);
        padding: 0.6rem 0.7rem;
      }
      .row {
        display: grid;
        grid-template-columns: 0.55fr 1fr;
        align-items: center;
        gap: 0.75rem;
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 0.45rem;
      }
      .row dt {
        color: var(--text-muted);
        font-weight: 700;
        margin: 0;
      }
      .status-good {
        color: var(--accent);
        font-weight: 700;
      }
      .btn {
        min-height: 2.5rem;
        border-radius: 8px;
        border: 1px solid transparent;
        background: var(--accent);
        color: var(--text-on-accent);
        font-weight: 750;
        padding: 0.55rem 0.85rem;
        justify-self: start;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>Account</h1>
      </div>

      <section class="panel">
        <h2>Profile</h2>
        <div class="grid">
          <label>Display name<input value="Ben" /></label>
          <label>Email<input value="ben@example.test" /></label>
          <label
            >Time zone<select>
              <option>America/New_York</option>
            </select></label
          >
          <label
            >Default view<select>
              <option>Day (chronological)</option>
            </select></label
          >
        </div>
        <button class="btn" type="button">Save changes</button>
      </section>

      <section class="panel">
        <h2>AI capability router</h2>
        <dl style="margin: 0; display: grid; gap: 0.55rem">
          <div class="row">
            <dt>Reasoning</dt>
            <dd class="status-good">Configured</dd>
          </div>
          <div class="row">
            <dt>Summarization</dt>
            <dd class="status-good">Configured</dd>
          </div>
          <div class="row">
            <dt>Embeddings</dt>
            <dd class="status-good">Local</dd>
          </div>
        </dl>
      </section>
    </main>
  </body>
</html>
```

- [ ] **Step 3: Format and verify (verify PASS)**

```bash
pnpm format docs/brand/mockups/settings-form.html
pnpm format:check
```

Expected: format:check passes.

- [ ] **Step 4: Commit**

```bash
git add docs/brand/mockups/settings-form.html
git commit -m "docs(brand): add form-heavy settings mockup (Ritual on dense forms)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9b: Pre-gate verification (full foundation gate on the scaffolding)

**Files:** none (verification only)

- [ ] **Step 1: Run the foundation gate**

The pre-gate deliverable (tokens + split-in-progress + primitives + mockups) restyles no screen, so the gate must be green.

```bash
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm typecheck
```

Expected: all pass. Confirm acceptance checks #1 (hex only in tokens.css — note tasks.css is still pending Task 13, which runs post-gate; that is acceptable here because tasks.css restyle is post-gate, but record it), #5 (primitives present + no API imports), #7 (three mockups present).

- [ ] **Step 2: Run the primitive-isolation acceptance check**

```bash
grep -rE "api/client|useQuery|useMutation|@jarv1s/shared" apps/web/src/ui && echo "VIOLATION" || echo "CLEAN"
```

Expected: `CLEAN` (no `ui/` primitive imports an API client, React Query, or a shared DTO).

- [ ] **Step 3: No commit (verification task).** Proceed to the gate below.

---

## 🛑 AWAIT BEN'S MOCKUP SIGN-OFF

> **HARD HUMAN GATE — DO NOT PROCEED PAST THIS LINE in an autonomous run.**
>
> Everything above (Tasks 1–9b) is the overnight deliverable: this spec, the three static
> mockups under `docs/brand/mockups/`, and the taste-neutral token scaffolding (`tokens.css`
>
> - `styles.css` hex removal + the `ui/` primitives). **NONE of it restyles a live screen.**
>
> **STOP HERE.** Surface the three mockups to Ben:
>
> - `docs/brand/mockups/briefing-reading.html`
> - `docs/brand/mockups/day-view.html`
> - `docs/brand/mockups/settings-form.html`
>
> The screen-by-screen app-wide restyle tasks (10–17) and the briefing reading surface (Task 11)
> run **only after Ben approves the mockups.** If Ben requests changes, revise the mockups
> (and, if the palette changes, `tokens.css` + `_tokens.css`) and re-present — do not start the
> restyle until sign-off is explicit. An autonomous overnight worker MUST halt here and report
> the deliverable; it must NOT auto-advance to Task 10.

---

## Post-gate phase (app-wide restyle — ONLY after sign-off)

> Before editing any page's markup, enumerate the e2e selectors that page's spec depends on and
> preserve them (spec risk #4). Existing specs: `tests/e2e/tasks.spec.ts` keys on the "Priority"/
> "Matrix" buttons + `region` name `"Critical priority"`; `tests/e2e/chat-drawer.spec.ts` keys on
> the `complementary` named "Live chat", `getByLabel("Message")`, "Send"/"New chat" buttons;
> `tests/e2e/app-shell.spec.ts` keys on `.module-nav` links + the "Account" heading.

---

### Task 10: Split styles.css line-count — confirm under cap after restyle headroom

**Files:**

- Modify: `apps/web/src/styles.css` (if still ≥ 1000 after restyle additions, move the `@media` blocks or a cohesive section out to a new `apps/web/src/styles/layout.css`)

The hex removal in Task 3 already trims `styles.css`. This task guarantees the cap holds before the restyle tasks add rules.

- [ ] **Step 1: Write the failing test (line-count check)**

```bash
wc -l apps/web/src/styles.css
pnpm check:file-size
```

Expected: `styles.css` is well under 1000 (≈ 940 after Task 3). If `check:file-size` passes, this task is a no-op confirmation — record it and skip to Step 4. Only if a later task pushes a file over the cap do Steps 2–3 apply.

- [ ] **Step 2: (Conditional) Extract the responsive `@media` blocks to `apps/web/src/styles/layout.css`**

If any CSS file would exceed 1000 lines, create `apps/web/src/styles/layout.css`, move the two `@media (max-width: ...)` blocks (`styles.css:857-952`) verbatim into it, and import it after `styles.css` in `main.tsx`:

```tsx
import "./styles/tokens.css";
import "./styles.css";
import "./styles/layout.css";
import "./ui/ui.css";
import "./tasks/tasks.css";
```

- [ ] **Step 3: (Conditional) Verify both files are under the cap**

```bash
wc -l apps/web/src/styles.css apps/web/src/styles/layout.css
pnpm check:file-size
```

Expected: both under 1000; `No checked files exceed 1000 lines.`

- [ ] **Step 4: Commit (only if a file changed)**

```bash
git add apps/web/src/styles.css apps/web/src/main.tsx
# add apps/web/src/styles/layout.css only if created
git commit -m "refactor(web): keep styles under the 1000-line cap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Briefing reading surface (editorial single-column)

**Files:**

- Create: `apps/web/src/briefings/briefing-reading-view.tsx`
- Create: `apps/web/src/briefings/briefings.css`
- Modify: `apps/web/src/briefings/briefings-page.tsx:402-436`
- Modify: `apps/web/src/main.tsx` (add `import "./briefings/briefings.css";`)
- Test: `tests/e2e/briefings.spec.ts` (Task 12 writes the e2e; this task's render is exercised there)

- [ ] **Step 1: Write the failing test (typecheck-driven — the page imports a not-yet-existing component)**

In `apps/web/src/briefings/briefings-page.tsx`, add the import at the top (with the other relative imports):

```tsx
import { BriefingRunView } from "./briefing-reading-view";
```

Run:

```bash
pnpm --filter @jarv1s/web typecheck
```

Expected: FAIL — `Cannot find module './briefing-reading-view'`.

- [ ] **Step 2: Implement the reading surface**

Create `apps/web/src/briefings/briefing-reading-view.tsx`. It renders one `BriefingRunDto.summaryText` as paragraphs (split on blank lines; preserve single line breaks), with a stable `aria-label="Briefing"` region for the e2e. It does NOT change `BriefingRunDto`:

```tsx
import { Newspaper } from "lucide-react";

import type { BriefingRunDto } from "@jarv1s/shared";

/**
 * Editorial single-column reading surface for one briefing run. Presentation-only:
 * it renders the existing BriefingRunDto.summaryText. Markdown parsing is out of
 * scope; we split on blank lines into paragraphs and preserve single line breaks,
 * so light section headers embedded in summary_text still read as structured prose.
 */
export function BriefingRunView(props: { readonly run: BriefingRunDto }) {
  const paragraphs = props.run.summaryText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return (
    <article className="briefing-reading" aria-label="Briefing">
      <header className="briefing-reading-head">
        <Newspaper size={18} aria-hidden="true" />
        <p className="briefing-reading-meta">
          {props.run.status} · {formatBriefingDate(props.run.createdAt)}
        </p>
      </header>
      <div className="briefing-reading-body">
        {paragraphs.length === 0 ? (
          <p className="muted-text">This briefing has no content yet.</p>
        ) : (
          paragraphs.map((block, index) => (
            <p key={index} className="briefing-reading-paragraph">
              {renderWithBreaks(block)}
            </p>
          ))
        )}
      </div>
    </article>
  );
}

function renderWithBreaks(block: string) {
  const lines = block.split("\n");
  return lines.map((line, index) => (
    <span key={index}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function formatBriefingDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
```

- [ ] **Step 3: Add the editorial styles**

Create `apps/web/src/briefings/briefings.css`:

```css
/* Briefing editorial reading surface (Ritual — Living Archive mode). Token-driven. */

.briefing-reading {
  max-width: 42rem;
  margin: 0 auto;
  display: grid;
  gap: 1.25rem;
  background: var(--surface-editorial);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 2rem 1.75rem;
}
.briefing-reading-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent);
}
.briefing-reading-meta {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}
.briefing-reading-body {
  display: grid;
  gap: 1.1rem;
}
.briefing-reading-paragraph {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
```

Add the import to `apps/web/src/main.tsx` (after `./tasks/tasks.css`):

```tsx
import "./tasks/tasks.css";
import "./briefings/briefings.css";
```

- [ ] **Step 4: Wire the reading surface into the page (replace the selected run body)**

In `apps/web/src/briefings/briefings-page.tsx`, change the `RunList` so the **most recent** run renders via `BriefingRunView` while keeping older runs as the compact list and preserving the existing loading/empty/error states. Replace the `RunList` function body (lines 402-436) with:

```tsx
function RunList(props: {
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly runs: readonly BriefingRunDto[];
}) {
  if (props.isLoading) {
    return <div className="empty-state">Loading runs</div>;
  }
  if (props.error) {
    return <div className="empty-state">{props.error.message}</div>;
  }
  if (props.runs.length === 0) {
    return <div className="empty-state">No runs</div>;
  }

  const [latest, ...older] = props.runs;

  return (
    <div className="briefing-runs" aria-live="polite">
      <BriefingRunView run={latest} />
      {older.length > 0 ? (
        <div className="chat-messages">
          {older.map((run) => (
            <article className="chat-message assistant" key={run.id}>
              <div className="chat-message-icon" aria-hidden="true">
                <Newspaper size={18} />
              </div>
              <div>
                <div className="task-meta">
                  <span>{run.status}</span>
                  <span>{run.runKind}</span>
                  <span>{formatDate(run.createdAt)}</span>
                </div>
                <p>{run.summaryText}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

(The `Newspaper` import and `formatDate` helper already exist in this file; do not re-import or redefine them. `BriefingRunDto` is already imported.)

- [ ] **Step 5: Run typecheck + gate (verify PASS), then commit**

```bash
pnpm format apps/web/src/briefings/briefing-reading-view.tsx apps/web/src/briefings/briefings.css apps/web/src/briefings/briefings-page.tsx apps/web/src/main.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm check:file-size
pnpm format:check
git add apps/web/src/briefings/briefing-reading-view.tsx apps/web/src/briefings/briefings.css apps/web/src/briefings/briefings-page.tsx apps/web/src/main.tsx
git commit -m "feat(web): render latest briefing run in editorial reading surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all gate commands pass. Verify `git diff --stat origin/main -- packages/shared/src/briefings-api.ts` shows NO change (acceptance #6).

---

### Task 12: e2e — briefing reading path

**Files:**

- Create: `tests/e2e/briefings.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/briefings.spec.ts`, reusing the existing briefing mock helpers (`tests/e2e/mock-briefings-api.ts`, re-exported from `mock-api.ts`):

```ts
import { expect, test } from "@playwright/test";

import {
  createMockBriefingDefinition,
  createMockBriefingRun,
  createMockConnectorProviders,
  mockApi
} from "./mock-api.js";

test("renders the latest briefing run in the editorial reading surface", async ({ page }) => {
  const definition = createMockBriefingDefinition("brief-1", "Morning briefing");
  const run = createMockBriefingRun(
    "run-1",
    "brief-1",
    "What matters today\n\nThree commitments need attention. The tax filing is due today."
  );

  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    briefingDefinitions: [definition],
    briefingRuns: { "brief-1": [run] }
  });

  await page.goto("/briefings");

  // The definition auto-selects (first definition); its run renders in the
  // editorial reading surface, identified by the stable aria-label.
  const reading = page.getByRole("article", { name: "Briefing" });
  await expect(reading).toBeVisible();
  await expect(reading.getByText("Three commitments need attention.")).toBeVisible();
});
```

- [ ] **Step 2: Run it and confirm it FAILS first, then PASSES**

```bash
pnpm test:e2e tests/e2e/briefings.spec.ts
```

Expected: PASS (Task 11 implemented the surface). If it FAILS on the selector, confirm `BriefingRunView` renders `aria-label="Briefing"` on an `<article>` and that the definition auto-selects via the page's `useEffect`. (To see the genuine red→green, you may transiently revert the `RunList` change and re-run to observe FAIL, then restore — optional.)

- [ ] **Step 3: Run the full e2e suite to confirm no regression**

```bash
pnpm test:e2e
```

Expected: all specs pass (`tasks.spec.ts`, `chat-drawer.spec.ts`, `app-shell.spec.ts`, `connect-google.spec.ts`, `briefings.spec.ts`). If a pre-existing spec broke, a markup/selector you changed in Task 11 is the cause — restore the selector.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/briefings.spec.ts
git commit -m "test(e2e): cover the briefing reading path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Tasks/day view restyle (tokens + time-bucket rhythm)

**Files:**

- Modify: `apps/web/src/tasks/tasks.css`
- Modify: `apps/web/src/tasks/tasks-page.tsx` (token/visual rhythm only; no new view, no new data)

- [ ] **Step 1: Write the failing test (hex-isolation acceptance check for tasks.css)**

```bash
grep -lE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src/tasks/tasks.css && echo "HAS HEX" || echo "CLEAN"
```

Expected (before): `HAS HEX` (priority/matrix hex + inline fallbacks).

- [ ] **Step 2: Replace hex and inline fallbacks in `tasks.css` with semantic tokens**

In `apps/web/src/tasks/tasks.css` make these exact replacements:

- All `var(--text-muted, #6b7280)` and `var(--text-muted, #9ca3af)` → `var(--text-muted)`
- All `var(--border, #e5e7eb)` → `var(--border-default)`
- All `var(--border-subtle, #f3f4f6)` → `var(--border-subtle)`
- All `var(--surface-active, #eef2ff)` → `var(--surface-active)`
- All `var(--surface-subtle, #f3f4f6)` → `var(--surface-subtle)`
- Priority header colors (`tasks.css:60-77`):
  - `.priority-5 { border-bottom-color: #dc2626; }` → `border-bottom-color: var(--danger);` (priority 5 = Critical, a genuine urgency signal, not human drift)
  - `.priority-4 { border-bottom-color: #ea580c; }` → `border-bottom-color: var(--state-recovery);`
  - `.priority-3 { border-bottom-color: #ca8a04; }` → `border-bottom-color: var(--state-attention);`
  - `.priority-2 { border-bottom-color: #2563eb; }` → `border-bottom-color: var(--bucket-morning);`
  - `.priority-1 { border-bottom-color: #6b7280; }` → `border-bottom-color: var(--text-muted);`
  - `.priority-none { border-bottom-color: #d1d5db; }` → `border-bottom-color: var(--border-default);`
- Matrix cell borders (`tasks.css:123-134`):
  - `.matrix-do { border-top: 3px solid #dc2626; }` → `var(--danger)`
  - `.matrix-schedule { border-top: 3px solid #2563eb; }` → `var(--bucket-morning)`
  - `.matrix-delegate { border-top: 3px solid #ca8a04; }` → `var(--state-attention)`
  - `.matrix-eliminate { border-top: 3px solid #9ca3af; }` → `var(--text-muted)`

- [ ] **Step 3: Apply the Ritual visual rhythm in `tasks-page.tsx` (no behavior change)**

The live page keeps its existing `priority`/`matrix` views and `TaskDefaultView` (no new persisted view, no time-bucket data — spec §"Tasks / day view"). The only JSX change is replacing the bespoke `page-heading` block with the shared `SectionHeader` primitive to enforce coherence. Edit `apps/web/src/tasks/tasks-page.tsx`:

Add the import:

```tsx
import { SectionHeader } from "../ui";
```

Replace the `<div className="page-heading"> ... </div>` block (the eyebrow + h1; lines 74-78) — keep the `segmented-control` view toggle exactly as is, and keep `id="tasks-title"` so `aria-labelledby` still resolves:

```tsx
<SectionHeader
  eyebrow="Tasks"
  title="Tasks"
  id="tasks-title"
  actions={
    <div className="segmented-control" role="group" aria-label="View">
      <button
        aria-pressed={view === "priority"}
        className={view === "priority" ? "active" : ""}
        disabled={viewMutation.isPending}
        onClick={() => viewMutation.mutate("priority")}
        type="button"
      >
        <ListIcon size={16} aria-hidden="true" /> Priority
      </button>
      <button
        aria-pressed={view === "matrix"}
        className={view === "matrix" ? "active" : ""}
        disabled={viewMutation.isPending}
        onClick={() => viewMutation.mutate("matrix")}
        type="button"
      >
        <LayoutGrid size={16} aria-hidden="true" /> Matrix
      </button>
    </div>
  }
/>
```

(The `section` still has `aria-labelledby="tasks-title"`; `SectionHeader` renders the `h1 id="tasks-title"`. The "Priority"/"Matrix"/"View" selectors that `tasks.spec.ts` depends on are preserved verbatim.)

- [ ] **Step 4: Verify hex-isolation + run e2e (verify PASS)**

```bash
grep -lE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src/tasks/tasks.css && echo "HAS HEX" || echo "CLEAN"
pnpm format apps/web/src/tasks/tasks.css apps/web/src/tasks/tasks-page.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm format:check
pnpm test:e2e tests/e2e/tasks.spec.ts
```

Expected: `CLEAN`; typecheck/lint/format pass; tasks e2e passes (Priority grouping + Matrix toggle still work). Confirm the global hex check now passes app-wide:

```bash
grep -rlE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'
```

Expected: ONLY `apps/web/src/styles/tokens.css` (acceptance #1 fully satisfied).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tasks/tasks.css apps/web/src/tasks/tasks-page.tsx
git commit -m "refactor(web): tasks view to semantic tokens + SectionHeader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Notifications restyle (anti-shame attention, not error-red)

**Files:**

- Modify: `apps/web/src/notifications/notifications-page.tsx` (token/class adoption only)

> Read the file first. The unread treatment must use `--state-attention` (amber/accent), never `--danger`. If the existing markup already uses the `.notification-row.unread` class (styled via `styles.css`, already token-converted in Task 3), this task may be a class/copy-only confirmation.

- [ ] **Step 1: Write the failing test (grep for any error-red on drift states)**

```bash
grep -nE 'danger|#dc2626|#be123c|error-red' apps/web/src/notifications/notifications-page.tsx
```

Expected: list any `--danger`/red usage applied to unread/at-risk (drift) state. If none exists (true error states like failed actions may legitimately keep `.form-error`), this task is a confirmation — record it and skip to Step 4.

- [ ] **Step 2: (Conditional) Re-point any drift-state styling to attention tokens**

If Step 1 found a drift state styled with `--danger`, change that rule (in `notifications-page.tsx` inline class or its CSS) to use `--state-attention` / `--state-attention-surface`. Do NOT touch genuine failure messaging (`.form-error`).

- [ ] **Step 3: (Conditional) Confirm unread uses attention, not danger**

```bash
grep -nE 'unread' apps/web/src/notifications/notifications-page.tsx
```

Verify unread maps to `.notification-row.unread` (token-driven attention) — already converted in Task 3 to `--accent-soft`/`--border-attention`.

- [ ] **Step 4: Run the gate (verify PASS), then commit (only if a file changed)**

```bash
pnpm format apps/web/src/notifications/notifications-page.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm format:check
git add apps/web/src/notifications/notifications-page.tsx
git commit -m "refactor(web): notifications use attention tokens for drift (anti-shame)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all pass. (If no change was needed, skip the commit and note the confirmation.)

---

### Task 15: Settings + Auth restyle (token adoption)

**Files:**

- Modify: `apps/web/src/settings/settings-page.tsx`
- Modify: `apps/web/src/auth/auth-screen.tsx`

> These pages already use the shared classes (`.panel`, `.definition-list`, `.auth-panel`, `.primary-button`) that Task 3 token-converted, so they inherit the new language automatically. This task only swaps the page header to the shared `SectionHeader` for coherence and confirms no inline hex/style leaks remain. Read each file first; preserve selectors the e2e (`app-shell.spec.ts` keys on the "Account" heading and admin section headings) depends on.

- [ ] **Step 1: Write the failing test (grep for inline hex/style leaks)**

```bash
grep -nE 'style=\{\{|#[0-9a-fA-F]{3,6}' apps/web/src/settings/settings-page.tsx apps/web/src/auth/auth-screen.tsx
```

Expected: list any inline hex or `style={{...}}` color leaks. If none, these pages are already token-coherent — this task confirms it (Step 4 only).

- [ ] **Step 2: (Conditional) Replace any inline hex/style color with a token class**

If Step 1 found an inline color, move it to a token-driven class (reuse existing classes; do not introduce hex). Do NOT change the "Account" `h1` text or admin section heading text — `app-shell.spec.ts` keys on them.

- [ ] **Step 3: (Conditional) Adopt `SectionHeader` for the settings page heading**

Only if the settings page uses the bespoke `page-heading` eyebrow+h1 pattern, swap it for `import { SectionHeader } from "../ui";` and `<SectionHeader eyebrow="Settings" title="Account" level={1} />`, preserving the exact `"Account"` heading text and level so the e2e `getByRole("heading", { name: "Account", level: 1 })` still matches.

- [ ] **Step 4: Run the gate + e2e (verify PASS), then commit (only if a file changed)**

```bash
pnpm format apps/web/src/settings/settings-page.tsx apps/web/src/auth/auth-screen.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm format:check
pnpm test:e2e tests/e2e/app-shell.spec.ts
git add apps/web/src/settings/settings-page.tsx apps/web/src/auth/auth-screen.tsx
git commit -m "refactor(web): settings + auth header coherence (SectionHeader, tokens)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all pass; app-shell e2e still green. (Skip the commit if no change was needed.)

---

### Task 16: Chat drawer restyle (secondary tool, governor for provisional replies)

**Files:**

- Modify: `apps/web/src/chat/chat-drawer.tsx`

> Hard constraint: chat stays a secondary tool, NOT the spine (HARD STOP: no chat-first dominance). This task is token/chrome only and OPTIONALLY wraps provisional assistant replies in `ProvisionalRegion`. Preserve every selector `chat-drawer.spec.ts` depends on: the `complementary` named "Live chat", `getByLabel("Message")`, "Send"/"New chat" buttons, the "Send a message to start chatting" empty text.

- [ ] **Step 1: Write the failing test — run the existing chat e2e to establish the green baseline**

```bash
pnpm test:e2e tests/e2e/chat-drawer.spec.ts
```

Expected: PASS (baseline before edit). Any edit must keep it green.

- [ ] **Step 2: Apply token-only chrome adjustments (no structural/markup change to selectors)**

The drawer chrome already uses token-converted classes (`.chat-drawer`, `.provider-indicator`, `.chat-message` — all handled in Task 3). The only allowed change here is cosmetic class additions that do not alter the e2e selectors. If no further change is warranted to honor the language, this is a confirmation task — record it and skip to Step 4. Do NOT change the static `"CLI"` provider indicator to name a model (Provider-agnostic invariant).

- [ ] **Step 3: (Optional) Wrap provisional assistant replies in `ProvisionalRegion`**

Only if it does not break the chat e2e (which asserts the assistant reply text is directly visible): leave the reply text directly rendered. Given the e2e asserts `drawer.getByText("Hello from the assistant")`, `ProvisionalRegion` wrapping is SAFE (it renders children inline), but to avoid risk in an autonomous run, DEFER live provisional wrapping to a follow-up and keep replies as-is. Record this deferral.

- [ ] **Step 4: Run the gate + chat e2e (verify PASS), then commit (only if a file changed)**

```bash
pnpm format apps/web/src/chat/chat-drawer.tsx
pnpm --filter @jarv1s/web typecheck
pnpm lint
pnpm format:check
pnpm test:e2e tests/e2e/chat-drawer.spec.ts
git add apps/web/src/chat/chat-drawer.tsx
git commit -m "refactor(web): chat drawer token coherence (stays secondary)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: all pass; chat e2e green. (Skip the commit if no change was needed.)

---

### Task 17: Final coherence sweep — confirm acceptance criteria across the app

**Files:** none (verification only)

- [ ] **Step 1: Hex isolation (acceptance #1)**

```bash
grep -rlE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'
```

Expected: ONLY `apps/web/src/styles/tokens.css`.

- [ ] **Step 2: No undefined-token references (acceptance #2)**

```bash
comm -23 \
  <(grep -rhoE 'var\(--[a-z0-9-]+' apps/web/src --include='*.css' --include='*.tsx' | sed 's/var(//' | sort -u) \
  <(grep -oE '^\s*--[a-z0-9-]+' apps/web/src/styles/tokens.css | tr -d ' ' | sort -u)
```

Expected: empty output (every referenced token is defined in tokens.css).

- [ ] **Step 3: Theme overlays present (acceptance #3)**

```bash
grep -cE '\[data-theme="dark"\]|\[data-theme="amber"\]' apps/web/src/styles/tokens.css
```

Expected: ≥ 2 (both overlays present).

- [ ] **Step 4: Primitive isolation (acceptance #5)**

```bash
grep -rE "api/client|useQuery|useMutation|@jarv1s/shared" apps/web/src/ui && echo "VIOLATION" || echo "CLEAN"
ls apps/web/src/ui/*.tsx | wc -l
```

Expected: `CLEAN`; primitive count is 5 (card, section-header, badge, time-bucket, provisional-region) — within the 4–6 range.

- [ ] **Step 5: BriefingRunDto unchanged (acceptance #6)**

```bash
git diff origin/main --stat -- packages/shared/src/briefings-api.ts
```

Expected: empty (no change to the contract).

- [ ] **Step 6: File-size cap (acceptance #4)**

```bash
pnpm check:file-size
```

Expected: `No checked files exceed 1000 lines.`

- [ ] **Step 7: No commit — proceed to the final gate task.**

---

### Task 18: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full foundation gate**

```bash
pnpm verify:foundation
```

Expected: PASS — lint, format:check, check:file-size, typecheck, test:unit, db:migrate, test:integration all green. (This slice changes no backend code, so test:unit/integration should be unaffected; if they fail, investigate before claiming done.)

- [ ] **Step 2: Run the full e2e suite (not in the foundation gate)**

```bash
pnpm test:e2e
```

Expected: all specs pass — `tasks.spec.ts`, `chat-drawer.spec.ts`, `app-shell.spec.ts`, `connect-google.spec.ts`, `briefings.spec.ts`.

- [ ] **Step 3: Final commit (only if any formatting touched files since the last commit)**

```bash
git status --short
# If only formatting changes remain, stage the specific paths shown and commit:
# git add <explicit paths>
git commit -m "chore(web): final formatting for design-direction slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: clean tree after this step. Do NOT `git add -A`.

---

## Self-Review

### 1. Spec section-by-section coverage

| Spec section / acceptance                                                                        | Covered by                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Goal: token layer + Ritual language across shell, briefing-led + time-bucket day view            | Tasks 1–18 (pre-gate scaffolding 1–9; post-gate restyle 10–17)                                                                          |
| Architecture §1 token layer / undefined-token gap                                                | Tasks 1, 2, 3, 13 (close the 5-token gap; hex only in tokens.css)                                                                       |
| Architecture §2 three tiers + dark/amber overlays                                                | Task 1 (Tier 1/2/3, `[data-theme="dark"]`/`"amber"`)                                                                                    |
| Architecture §3 4–6 primitives in `ui/`                                                          | Tasks 4–6 (Card, Stack, SectionHeader, Badge, TimeBucket, ProvisionalRegion = 6)                                                        |
| Architecture §4 styles.css split under cap                                                       | Tasks 3, 10 (hex removal trims; conditional layout.css extraction)                                                                      |
| Components: tokens.css                                                                           | Task 1                                                                                                                                  |
| Components: styles.css hex removal                                                               | Task 3                                                                                                                                  |
| Components: ui/ primitives                                                                       | Tasks 4–6                                                                                                                               |
| Components: briefing-reading-view + briefings.css                                                | Task 11                                                                                                                                 |
| Components: tasks/day view restyle                                                               | Task 13                                                                                                                                 |
| Components: coherent pass (settings, chat, notifications, auth)                                  | Tasks 14, 15, 16 (calendar/email explicitly NOT rebuilt — only consume tokens)                                                          |
| Components: mockups                                                                              | Tasks 7, 8, 9                                                                                                                           |
| Data flow (no new runtime flow)                                                                  | No task adds a fetch/query key; Task 11 reuses existing query                                                                           |
| Error handling: anti-shame (amber not red)                                                       | Tasks 5 (Badge tones), 13 (priority/matrix), 14 (notifications); Badge has no danger tone                                               |
| Error handling: token resolution safety (drop fallbacks)                                         | Tasks 2, 13 (inline `var(--x,#fallback)` removed)                                                                                       |
| Security & invariants (no DTO/migration/SQL/payload/provider)                                    | No task authors any; Task 11/17 verify `briefings-api.ts` unchanged; Task 16 keeps "CLI" indicator                                      |
| Testing: gates green pre-gate                                                                    | Task 9b                                                                                                                                 |
| Testing: e2e briefing path                                                                       | Task 12                                                                                                                                 |
| Testing: regression (existing e2e pass)                                                          | Tasks 12, 13, 15, 16, 18                                                                                                                |
| Acceptance #1 hex isolation                                                                      | Tasks 3, 13, 17 (grep)                                                                                                                  |
| Acceptance #2 every token defined                                                                | Tasks 2, 17 (comm)                                                                                                                      |
| Acceptance #3 dark/amber overlays                                                                | Tasks 1, 17                                                                                                                             |
| Acceptance #4 file-size cap                                                                      | Tasks 3, 10, 17, 18                                                                                                                     |
| Acceptance #5 4–6 primitives, no API imports                                                     | Tasks 4–6, 9b, 17                                                                                                                       |
| Acceptance #6 editorial reading, no DTO change                                                   | Tasks 11, 17                                                                                                                            |
| Acceptance #7 2–3 mockups                                                                        | Tasks 7, 8, 9                                                                                                                           |
| Acceptance #8 governor 70% + recovery/attention not danger                                       | Tasks 1 (`--provisional-opacity`), 5/6, 7/8 (mockups)                                                                                   |
| Acceptance #9 HARD STOP list                                                                     | Enforced in every mockup/token task (no purple/blue glow, no sparkle, no mascot, no chat-first, no horizontal pagination)               |
| Acceptance #10 AWAIT BEN'S MOCKUP SIGN-OFF before app-wide restyle                               | The explicit 🛑 gate between Task 9b and Task 10                                                                                        |
| Acceptance #11 gates pass on pre-gate deliverable                                                | Task 9b                                                                                                                                 |
| Acceptance #12 post-gate briefing e2e + existing pass                                            | Tasks 12, 18                                                                                                                            |
| Out of scope: markdown / DTO change / calendar-email rebuild / theme toggle / task data / motion | Honored — no task adds a markdown parser, DTO field, calendar/email rebuild, theme switcher, time-bucket data field, or motion language |

### 2. Placeholder scan

No "TBD/TODO/implement later/handle edge cases" placeholders. Every code step contains complete, copy-pasteable content. The "conditional" steps (Tasks 10, 14, 15, 16) are not placeholders — they are guarded confirmations with explicit grep predicates that decide whether a change is needed, and full code for the change-needed branch. Each task names exact paths and exact `git add <paths>` (never `git add -A`).

### 3. Type consistency

- `BriefingRunView` (defined Task 11) is imported in `briefings-page.tsx` (Task 11) and asserted in the e2e (Task 12) via `aria-label="Briefing"` — names match.
- `ui/index.ts` barrel exports grow monotonically across Tasks 4→5→6 (`Card`, `Stack`, `SectionHeader`, `Badge`/`BadgeTone`, `TimeBucket`/`BucketName`, `ProvisionalRegion`) — every export has a matching `.tsx` created in the same task; consumers import `from "../ui"` (Tasks 13, 15).
- Token names are consistent across `tokens.css` (Task 1), `styles.css` (Task 3), `tasks.css` (Task 13), `ui.css` (Tasks 4–6), and `briefings.css` (Task 11): `--surface*`, `--text*`, `--border-default`/`--border-subtle`, `--accent*`, `--state-attention*`/`--state-recovery`, `--provisional-opacity`, `--bucket-morning|afternoon|evening`, plus the four added in Task 3 (`--shadow-control`, `--surface-topbar`, `--border-accent`, `--border-attention`) which Task 1's overlays also re-point.
- `BucketName` values `"morning"|"afternoon"|"evening"` (Task 6) match the `--bucket-*` token names (Task 1) and the mockup bucket classes (Task 8).
- `formatDate`/`Newspaper` are reused in `briefings-page.tsx` (Task 11) without re-import (they already exist in that file) — confirmed against the read of lines 2 and 442-447.

All consistent. No re-review needed.
