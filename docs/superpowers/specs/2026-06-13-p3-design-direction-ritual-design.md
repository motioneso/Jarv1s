# Phase 3 — Design Direction: The Chronological Flow / Ritual Model

**Status:** Approved design direction (taste-locked); implementation gated on Ben's mockup sign-off
**Epic:** #48 (Phase 3 · Core Value — Real Briefings), exit criterion #4 ("Design direction (#16)
applied to the briefing UI + a coherent pass on the existing screens")
**Issue:** #16
**Grounded on:** local `main` at `a898533` (run `pnpm audit:preflight` before building; it must exit 0).
**Source of truth:** `docs/brand/visual-language-research.md` (Ben locked Direction 3 — "The
Chronological Flow / Ritual Model" — as the lead on 2026-06-13). `docs/brand/brand-brief.md` is the
supporting brand foundation.

---

## Goal

Turn the locked visual-language research into a concrete, taste-neutral **semantic token layer** and a
**Ritual-direction visual language**, then apply it coherently across the web shell — leading with the
**briefing reading surface** and a **tasks/day view organized by time-bucket chronology** (This
Morning / This Afternoon / This Evening).

This slice is **presentation-only**. It changes CSS, a small set of lightweight React primitives, and
the JSX of existing pages. It introduces **no new API fields, no new DB tables/migrations, no new
pg-boss jobs, and no module-internal coupling**. The briefing reading surface renders the existing
`BriefingRunDto.summaryText` (`packages/shared/src/briefings-api.ts:20-29`) in an editorial
single-column layout; it does **not** add structured-section fields to the DTO — that is the job of the
sibling "real briefings" slice (`docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md`),
which keeps `summary_text` as the carrier and only adds light section headers *inside* that string.

There is a **hard taste gate**. The overnight deliverable is (1) this spec, (2) 2–3 self-contained
static HTML mockups under `docs/brand/mockups/`, and (3) the taste-neutral semantic token scaffolding
(the token CSS file + the file-size split, which restyle nothing on their own). The implementation plan
**stops before applying app-wide CSS** at an explicit `AWAIT BEN'S MOCKUP SIGN-OFF` gate; the
screen-by-screen restyle tasks run only after Ben approves the mockups.

Non-goals are spelled out in "Out of scope / deferred". The direction is taste-locked to
`visual-language-research.md` §"Implications for the Phase 3 design slice" and the HARD STOP list:
**no purple/blue AI-glow gradients, no sparkle/magic-wand icons, no mascots/therapeutic softness, no
chat-first dominance, no horizontal pagination.**

---

## Architecture

**1. Token layer (the spine).** Today the web shell has exactly nine `:root` custom properties in
`apps/web/src/styles.css:16-24` (`--accent`, `--accent-strong`, `--border`, `--danger`, `--ink`,
`--muted`, `--panel`, `--panel-subtle`, `--warning`) plus a hardcoded `color`/`background` pair on
`:root`. `apps/web/src/tasks/tasks.css` already references **five tokens that `:root` never defines**
(`--text-muted`, `--surface-subtle`, `--surface-active`, `--border-subtle`, and `--border` is the only
one that exists) — they resolve **only** through inline `var(--x, #fallback)` fallbacks, and the
priority-color and matrix-color blocks (`tasks.css:60-77,123-134`) hardcode raw hex
(`#dc2626`, `#ea580c`, `#ca8a04`, `#2563eb`, `#6b7280`). This is the exact anti-pattern the slice
fixes: we introduce a **single semantic token file** as the only place hex literals live, define every
token the app references (closing the undefined-token gap), and rewrite components to consume semantic
names. No Tailwind, no CSS-modules migration — the existing plain-CSS + `var()` model is preserved and
formalized.

**2. Three token tiers.** (a) **Primitive ramps** — raw scale values (neutrals, the brand teal/green,
amber, and a circadian "time-of-day" hue set), defined once. (b) **Semantic tokens** — purpose-named
aliases components actually use (`--surface`, `--surface-raised`, `--text`, `--text-muted`,
`--border-default`, `--accent`, `--state-attention`, `--state-recovery`, `--provisional-opacity`, the
time-bucket accents `--bucket-morning` / `--bucket-afternoon` / `--bucket-evening`, etc.). Components
**never** reference primitives or hex directly. (c) **Theme overlays** — the token file is authored
**dark/amber-ready**: a light theme as the default `:root` block plus a `[data-theme="dark"]` (and a
documented `[data-theme="amber"]` evening overlay) that re-point the **semantic** tokens to dark/amber
primitive ramps. We **ship light-first** (no theme toggle in this slice), but the structure means the
circadian "Morning Bright → Evening Amber" spectrum from the research is expressible later by flipping a
data attribute, with **zero component churn**.

**3. Lightweight primitives (4–6, only where the briefing/day surfaces need them).** The day/briefing
surfaces introduce shared layout shapes the current ad-hoc `.panel`/`.task-row` classes don't cover. We
extract a minimal set of presentational React components into `apps/web/src/ui/` — candidates:
`Card`, `Stack`, `SectionHeader`, `Badge`, `TimeBucket` (a labeled chronology section header), and
`ProvisionalRegion` (a wrapper that renders AI/unconfirmed content at the `--provisional-opacity`
governor level). These are pure styling/markup components — no data fetching, no React Query, no API
imports — so they never cross a module boundary. They are introduced **only** where the briefing and
day views need them; existing screens keep their current class-based markup except where the coherent
restyle pass touches them.

**4. File-size discipline.** `apps/web/src/styles.css` is **952 lines** (`check:file-size` fails at
>1000, `package.json` → `scripts/check-file-size.ts`). Adding tokens + briefing/day styles in place
would breach the cap, so the slice **splits styles.css** along existing seams: a new
`apps/web/src/styles/tokens.css` (token tiers + theme overlays), and feature CSS files
(`apps/web/src/briefings/briefings.css`, plus day-view styles co-located with the tasks feature in the
existing `apps/web/src/tasks/tasks.css` pattern). `apps/web/src/main.tsx:7-8` already imports
`styles.css` and `tasks/tasks.css`; new files are added to that import list (tokens first, so cascade
order keeps tokens before consumers). The 1000-line cap is honored for every resulting file.

---

## Components

> Every component below is presentation-only. None imports another module's internals, queries a table,
> touches `fs`, or reaches the API beyond the existing typed client calls the page already makes.

### `apps/web/src/styles/tokens.css` (new — the semantic token layer)
- **What it does:** defines the three token tiers (primitive ramps → semantic tokens → theme overlays)
  as CSS custom properties. The **only** file in the app permitted to contain hex literals. Defines
  **every** token the codebase references today — including the five `tasks.css` currently leaves
  undefined (`--text-muted`, `--surface-subtle`, `--surface-active`, `--border-subtle`, `--border`),
  and the nine `styles.css` `:root` tokens, re-expressed as semantic aliases. Adds the Ritual-specific
  semantic tokens: time-bucket accents (`--bucket-morning`, `--bucket-afternoon`, `--bucket-evening`),
  the governor `--provisional-opacity` (≈ `0.7`, per research §2 "70% opacity for AI-generated drafts"),
  and **anti-shame** state tokens (`--state-recovery`, `--state-attention`) that are amber/muted — never
  the error-red `--danger` — for normal human drift (research §"Implications", brand-brief.md:188
  "dominant red/error styling for normal human drift" is on the Avoid list).
- **How used:** imported first in `apps/web/src/main.tsx` so the cascade resolves tokens before any
  consumer file. Light theme lives in `:root`; `[data-theme="dark"]` and `[data-theme="amber"]`
  overlays re-point semantic tokens only.
- **Depends on:** nothing. It is the root of the styling dependency graph.

### `apps/web/src/styles.css` (modified — base/layout, hex removed)
- **What it does:** retains the structural/layout rules (app frame, sidebar, topbar, forms, buttons)
  but with all hardcoded hex (`#ffffff`, `#172026`, `rgb(...)` literals at lines 1-3, 124, 169, etc.)
  replaced by semantic `var()` references. Net line count drops below 1000 once tokens move out.
- **How used:** imported after `tokens.css` in `main.tsx`.
- **Depends on:** `tokens.css`.

### `apps/web/src/ui/` primitives (new — `Card`, `Stack`, `SectionHeader`, `Badge`, `TimeBucket`, `ProvisionalRegion`)
- **What they do:** small, typed, presentational React components (no hooks beyond layout, no fetching).
  `TimeBucket` renders a chronology section header ("This Morning" / "This Afternoon" / "This Evening")
  with the corresponding `--bucket-*` accent. `ProvisionalRegion` wraps AI/unconfirmed content and
  applies `opacity: var(--provisional-opacity)` plus an accessible "provisional — not yet confirmed"
  affordance (the governor pattern). `Badge` carries a `tone` prop mapping to semantic state tokens
  (`recovery`/`attention`/`neutral`/`accent`) — **never** an error-red tone for drift.
- **How used:** consumed by the briefing reading surface and the tasks/day view. Available to other
  screens in the coherent pass but not forced on them.
- **Depends on:** `tokens.css` (via class names / inline `var()`); React only. **No** `@jarv1s/shared`
  data DTOs, **no** API client imports.

### `apps/web/src/briefings/briefing-reading-view.tsx` + `briefings.css` (new — the editorial reading surface)
- **What it does:** renders a single `BriefingRunDto.summaryText`
  (`packages/shared/src/briefings-api.ts:20-29`) in an **editorial single-column reading layout** — the
  "Living Archive / editorial" supporting mode from the research, applied to the briefing *reading*
  surface (research §4: "Natural fit for the briefing reading surface"). Newsprint off-white surface,
  comfortable measure (max line length), serif-or-hyperlegible heading treatment via tokens, generous
  vertical rhythm. **Presentation-only:** it takes the run object the page already fetches and renders
  `summaryText`. Markdown rendering is a **stretch** (see Out of scope) — the default implementation
  renders the string preserving paragraph/line breaks (`white-space: pre-wrap` or split-on-newline into
  paragraphs), so light section headers the real-briefings slice may embed still read as structured
  prose without a parser.
- **How used:** the `BriefingsPage` (`apps/web/src/briefings/briefings-page.tsx`) currently renders runs
  as a chat-style `RunList` of `.chat-message` cards (`briefings-page.tsx:402-436`). The restyle pass
  replaces the **selected run's** body with `BriefingRunView` in the reading layout, keeping the
  definitions/editor CRUD column intact (the page stays a definitions editor + a reading surface for the
  latest run). No change to `useQuery` keys, the API client, or `BriefingRunDto`.
- **Depends on:** `tokens.css`, the `ui/` primitives, and the existing `BriefingRunDto` type. Nothing
  else.

### Tasks / day view — time-bucket chronology (modified `apps/web/src/tasks/tasks-page.tsx` + `tasks.css`)
- **What it does:** the coherent pass restyles the tasks surface toward the Ritual model. The existing
  page already has a `priority` and a `matrix` view selected via `TaskDefaultView`
  (`tasks-page.tsx:38-98`). This slice is **CSS + JSX presentation only**: it (a) replaces the
  hardcoded priority/matrix hex (`tasks.css:60-134`) with semantic tokens, and (b) **demonstrates** the
  time-bucket chronology (This Morning / This Afternoon / This Evening) in the **mockup** and as the
  visual treatment of grouped sections using `TimeBucket`. **It does not add a new persisted view mode,
  a new `TaskDefaultView` value, or any scheduling/time-bucket *data* field** — bucketing data is out of
  scope and belongs to the task-vertical slices (recurrence/scheduling, epic #48 criterion #3). Where a
  real time-of-day field does not yet exist, the day view groups by a presentation-only derivation from
  existing task fields and is shown primarily in the mockup; the live restyle limits itself to token
  adoption + the visual rhythm of the existing groupings. This keeps the slice honest and module-safe.
- **How used:** restyle pass over `tasks-page.tsx`, `task-list-view`, `task-matrix-view`. No API/DTO
  change.
- **Depends on:** `tokens.css`, `ui/` primitives.

### Coherent restyle pass — settings, chat drawer, notifications, auth, calendar, email
- **What it does:** token adoption + Ritual polish across the remaining surfaces so the app reads as one
  language. Each is **token/class only**, no behavior change:
  - **Settings** (`settings-page.tsx`) — panels, definition lists, provider status rows to tokens.
  - **Chat drawer** (`chat/chat-drawer.tsx`) — the drawer stays a **secondary tool, not the spine**
    (research HARD STOP: no chat-first dominance); restyle chrome to tokens; assistant replies that are
    provisional may use `ProvisionalRegion`.
  - **Notifications** (`notifications-page.tsx`) — calm/periphery treatment; unread state uses
    `--state-attention` (amber/accent), **not** error-red.
  - **Auth** (`auth/auth-screen.tsx`) — token adoption only.
  - **Calendar / Email** (`calendar/calendar-page.tsx`, `email/email-page.tsx`) — **these are
    `ComingSoon` stubs today and are being rebuilt by the sibling connector-sync slice**
    (`docs/superpowers/specs/2026-06-13-p3-connector-sync-engine.md` §8). To avoid scope collision,
    this slice contributes **only the shared token layer + `ui/` primitives** those pages consume; it
    does **not** rebuild or restructure them. The coherence guarantee is that when connector-sync builds
    the real pages, it builds them against this token layer and these primitives.
- **How used:** restyle tasks executed **only after** the mockup sign-off gate.
- **Depends on:** `tokens.css`, `ui/` primitives.

### Mockups — `docs/brand/mockups/*.html` (new — the taste-gate deliverable)
- **What it does:** 2–3 self-contained static HTML files (inline `<style>` using the same token names,
  no build step, openable directly in a browser) demonstrating the Ritual direction + the token
  palette: (1) **briefing reading view** (editorial single-column), (2) **tasks/day view with
  time-buckets** (This Morning / Afternoon / Evening, circadian accents, semi-migration signifier,
  governor 70%-opacity provisional block), and (3) **one form-heavy screen** (settings or auth) to
  prove the language holds on dense forms.
- **How used:** the artifact Ben reviews to sign off the taste gate before any app-wide CSS lands. They
  also serve as the visual reference the restyle tasks implement against.
- **Depends on:** nothing (self-contained); they mirror the `tokens.css` names so sign-off transfers
  directly to the implementation.

---

## Data flow

There is **no new runtime data flow**. The slice changes how already-fetched data is *presented*:

1. **Briefing reading surface:** `BriefingsPage` already calls `listBriefingRuns(activeDefinitionId)`
   via React Query (`briefings-page.tsx:36-40`) and receives `BriefingRunDto[]`. The reading view
   consumes `run.summaryText` / `run.status` / `run.createdAt` from the **existing** DTO and renders
   them. No new query keys, endpoints, or fields.
2. **Tasks/day view:** `TasksPage` already fetches tasks/lists/prefs via React Query
   (`tasks-page.tsx:31-37`). The restyle re-groups/re-skins the already-fetched `TaskDto[]`; no new
   fetch.
3. **Tokens:** resolved purely at CSS cascade time. `main.tsx` import order (`tokens.css` →
   `styles.css` → feature CSS) is the only ordering constraint.
4. **Theme:** light is the default `:root`. A future theme switch would set `data-theme` on the root
   element; this slice does **not** wire a toggle, but authors the overlays so the switch is a one-line
   change later.

No data crosses a network boundary, a pg-boss payload, a module API, or the vault as a result of this
slice.

---

## Error handling

- **No new failure modes.** The slice adds no async calls, so there are no new network/job error paths.
  Existing loading/empty/error states on each page (e.g. `briefings-page.tsx:407-415`,
  `notifications-page.tsx:77-92`) are **preserved**; the restyle re-skins them — loading spinners, empty
  states, and `.form-error` messages keep their semantics, only their tokens change.
- **Anti-shame error/recovery rendering (a deliberate design rule, not a code path):** "error" states
  that represent **normal human drift** (a slipped task, a missed bucket, an at-risk commitment) must
  render with `--state-recovery` / `--state-attention` (amber/muted) and recovery-language copy, **never**
  `--danger` (error-red). `--danger` is reserved for genuine system/validation failures (e.g. a failed
  form submit, an API error). This is enforced by review against the mockups and the brand-brief
  "Recovery Language" Avoid list (`brand-brief.md:184-194`).
- **Token resolution safety:** because `tokens.css` now defines **every** referenced token (closing the
  current undefined-token gap in `tasks.css`), the previous reliance on inline `var(--x, #fallback)`
  fallbacks is removed; a typo'd token name would now surface as an unstyled element in review rather
  than silently resolving to a stray hex fallback. Inline fallbacks are dropped as the components are
  converted, so the token file is the single source of truth.

---

## Security & invariants

This slice touches **only** web presentation (CSS + JSX + static HTML mockups). It nonetheless honors
every relevant Hard Invariant from `CLAUDE.md`:

- **Spec before build.** This document is the approved design spec in `docs/superpowers/specs/`,
  satisfying the "No new feature without a spec" process gate. (Note: this is a presentation slice, not a
  new feature/module, but a spec is authored regardless to satisfy epic #48's "Approved spec before
  build" exit bullet.)
- **Module isolation.** The `ui/` primitives, token CSS, and restyled pages collaborate only through
  presentation. No component imports another module's internals or queries another module's tables. The
  briefing reading surface consumes the **public** `BriefingRunDto` contract from
  `packages/shared/src/briefings-api.ts` — the declared cross-module surface — and nothing else.
- **Secrets never escape.** No new responses, logs, job payloads, exports, or AI prompts are introduced.
  The briefing view renders only `summaryText` (already a user-facing, secret-free field). No connector/
  AI credentials, tokens, or hashes are read or rendered.
- **Metadata-only job payloads.** No pg-boss payloads are created or modified.
- **Provider-agnostic AI.** No provider/model is referenced anywhere in this slice. The chat drawer's
  static `"CLI"` provider indicator (`chat-drawer.tsx:44-46`) is **not** changed to name a model. The
  governor `ProvisionalRegion` pattern surfaces *that* content is AI-provisional without naming any
  provider. The briefing view is provider-agnostic by construction (it renders a stored string).
- **DataContextDb only / AccessContext shape / never edit applied migrations / module SQL placement.**
  Not engaged — this slice authors **no** repository code, **no** migrations, and **no** SQL. (Called
  out explicitly so the builder does not invent any.)
- **Preserve plain Fastify REST + shared TS contracts.** No contract-layer change; `BriefingRunDto` is
  unchanged. No Tailwind/CSS-modules migration (per the locked decision).
- **1000-line file limit.** Enforced by splitting `styles.css` (currently 952 lines) into
  `tokens.css` + base + feature CSS; every resulting file stays under the cap (`pnpm check:file-size`).

---

## Testing strategy

- **Gates (must be green):** `pnpm lint`, `pnpm format:check`, `pnpm check:file-size`, `pnpm typecheck`.
  `check:file-size` is load-bearing here — it is the objective proof the styles.css split succeeded.
- **Visual sign-off (the human gate):** the 2–3 static mockups under `docs/brand/mockups/` are the
  artifact Ben reviews. **No automated test asserts taste**; the gate is human approval, captured as
  `AWAIT BEN'S MOCKUP SIGN-OFF` in the implementation plan.
- **e2e (Playwright, mocked REST — `tests/e2e/`):** the existing briefing e2e infrastructure already
  mocks the briefings API (`tests/e2e/mock-briefings-api.ts`) and there is an `app-shell.spec.ts`
  harness pattern. This slice must **eventually cover the briefing path**: a spec that signs in, opens
  `/briefings`, selects a definition with at least one run, and asserts the run's `summaryText` renders
  in the reading surface (a stable selector / role on the `BriefingRunView`, e.g. an
  `aria-label="Briefing"` region). Per epic #48 ("e2e covers the briefing path"), this e2e is part of
  the slice's definition of done — added with the briefing-reading-view restyle task (post-gate), reusing
  the existing `mock-briefings-api.ts` run fixtures.
- **Regression safety:** because no behavior changes, the existing e2e suites (`tasks.spec.ts`,
  `chat-drawer.spec.ts`, `app-shell.spec.ts`, `connect-google.spec.ts`) must still pass after the
  restyle; any selector they depend on must be preserved (the restyle changes classes/markup, so check
  selectors used by these specs before editing markup).

---

## Acceptance criteria

1. A new `apps/web/src/styles/tokens.css` exists defining three token tiers (primitive ramps → semantic
   tokens → theme overlays) and is the **only** CSS file in `apps/web` containing hex/`rgb()` literals
   (verifiable: `grep -rE '#[0-9a-fA-F]{3,6}|rgb\(' apps/web/src --include='*.css'` returns matches
   **only** in `tokens.css`).
2. Every CSS custom property referenced anywhere in `apps/web/src` is **defined** in `tokens.css`,
   including the five `tasks.css` previously left undefined (`--text-muted`, `--surface-subtle`,
   `--surface-active`, `--border-subtle`, `--border`); inline `var(--x, #fallback)` fallbacks are removed
   from converted files.
3. The token file is authored **dark/amber-ready**: a `:root` light block plus `[data-theme="dark"]`
   and `[data-theme="amber"]` overlays that re-point **semantic** tokens (not primitives) — even though
   the app **ships light-first with no theme toggle** in this slice.
4. `apps/web/src/styles.css` is split so that it **and every resulting CSS file** are under 1000 lines;
   `pnpm check:file-size` passes.
5. Between 4 and 6 lightweight presentational primitives exist under `apps/web/src/ui/` (including a
   time-bucket header and a governor "provisional" wrapper); none imports an API client, a `@jarv1s/shared`
   data DTO for fetching, or another module's internals.
6. The briefing reading surface renders `BriefingRunDto.summaryText` in an **editorial single-column
   reading layout** and makes **no** change to `BriefingRunDto` / `briefings-api.ts` /
   `briefing-run` schemas (verifiable: `git diff` shows `packages/shared/src/briefings-api.ts`
   unchanged).
7. 2–3 self-contained static HTML mockups exist under `docs/brand/mockups/` covering (a) the briefing
   reading view, (b) the tasks/day view with This Morning / This Afternoon / This Evening time-buckets,
   and (c) one form-heavy screen — each demonstrating the Ritual direction and the token palette, openable
   directly in a browser with no build step.
8. AI/provisional content uses a governor treatment at `--provisional-opacity` (≈ 0.7); normal-human-drift
   recovery/at-risk states use `--state-recovery`/`--state-attention` (amber/muted) and **never**
   `--danger` (error-red). Demonstrated in the mockups.
9. The HARD STOP list is honored across spec, tokens, and mockups: **no** purple/blue AI-glow gradients,
   **no** sparkle/magic-wand icons, **no** mascots/therapeutic softness, **no** chat-first dominance,
   **no** horizontal pagination.
10. The implementation plan contains an explicit `AWAIT BEN'S MOCKUP SIGN-OFF` gate **before** the
    screen-by-screen app-wide restyle tasks; the overnight deliverable is the spec + mockups + the
    taste-neutral token scaffolding (tokens.css + the file split) only.
11. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm check:file-size` pass on the
    pre-gate deliverable (token scaffolding + split + primitives + mockups), since none of those restyle
    a screen.
12. (Post-gate) A Playwright e2e spec covers the briefing reading path — sign in, open `/briefings`,
    select a definition with a run, assert `summaryText` renders in the reading surface — reusing
    `tests/e2e/mock-briefings-api.ts`; existing e2e suites still pass.

---

## Out of scope / deferred

- **Markdown rendering of `summaryText` (stretch).** The default reading view renders the string with
  paragraph/line-break preservation (no parser). Adding a markdown renderer requires a new web dependency
  (none exists today — `apps/web/package.json` has no markdown library) and a sanitization decision; that
  is a follow-up, not a blocker for sign-off.
- **Any change to `BriefingRunDto` / briefing API / structured briefing sections.** Owned by the sibling
  "real briefings" slice (`2026-06-13-phase3-real-briefings-design.md`), which keeps `summary_text` as
  the carrier. This slice stays CSS/JSX to preserve module isolation.
- **Rebuilding the Calendar / Email pages.** They are `ComingSoon` stubs being rebuilt by the
  connector-sync slice (`2026-06-13-p3-connector-sync-engine.md` §8). This slice only supplies the token
  layer + primitives those pages will consume.
- **A theme toggle / circadian auto-switching UI.** Tokens are authored dark/amber-ready, but the app
  ships light-first with no switcher. Wiring `data-theme` (manual or time-driven) is a follow-up.
- **New task data: time-of-day buckets, scheduling, recurrence.** The time-bucket *layout* is
  demonstrated, but persisted bucket/scheduling data belongs to epic #48 criterion #3 (task verticals).
  No new `TaskDefaultView` value or persisted field is added here.
- **Motion / animation language, logo/mark, public naming.** Open brand questions
  (`brand-brief.md:282-289`); not in this slice.
- **The "semi-migration signifier" as live task behavior.** Shown in the mockup as a visual signifier;
  the live, stateful migration mechanic (a moved-and-accounted-for task) is task-vertical work, not this
  presentation slice.

---

## Open risks

1. **Taste subjectivity (primary risk).** The direction is locked, but the *execution* (exact palette
   values, type pairing, density) is a judgment call. Mitigation: the mockups are the gate; nothing
   app-wide ships until Ben signs off, and the restyle implements against the approved mockups.
2. **Sibling-slice collision.** Three Phase-3 slices touch overlapping surfaces (this one, real-briefings,
   connector-sync). Mitigation: hard boundaries above — this slice is CSS/JSX-only, makes **no** DTO/API
   change, does **not** rebuild calendar/email, and renders only the existing `summaryText`. The token
   layer is the shared contract the other slices build against; if they land first, this slice rebases
   onto their markup (selectors verified before editing).
3. **styles.css split regressions.** Splitting a 952-line stylesheet risks dropped/duplicated rules or
   cascade-order bugs. Mitigation: split along the existing seams (`tasks.css` already proves the pattern),
   keep `tokens.css` imported first in `main.tsx`, and rely on `check:file-size` + the existing e2e suites
   (which exercise real rendered screens) to catch breakage.
4. **Selector breakage for existing e2e.** The restyle changes classes/markup; specs in `tests/e2e/`
   key off selectors. Mitigation: enumerate the selectors the existing specs depend on before editing
   markup, and preserve them (or update specs in the same task).
5. **Light-first now, dark/amber later.** Authoring dark/amber overlays without shipping them risks the
   overlays rotting (untested theme). Mitigation: keep overlays minimal (semantic re-points only) and
   document them as the explicit forward seam; a future theme-toggle slice owns validating them.
6. **Markdown stretch creep.** Pressure to "just add markdown" could pull a new dependency + sanitization
   risk into a presentation slice. Mitigation: explicitly deferred; the default renderer is parser-free.
