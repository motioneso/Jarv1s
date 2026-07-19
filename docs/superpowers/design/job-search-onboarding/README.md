# Handoff: Job Search — first-run onboarding + module

## Overview

Two connected surfaces for the **Job Search module** of _Jarvis_ (a private, self-hosted personal AI assistant, visual language = **Park Press**):

1. **Onboarding (first-run)** — a Jarvis-led _conversation_ that stands the module up. The user hits it the first time they open Job Search. Jarvis starts with the resume, then narrows the search through a few quick chat questions. A live "Building your profile" panel fills in as answers are captured. Ends with monitoring on and a CTA into the module.
2. **Job Search module** (already designed) — the steady-state module: Matches, Overview, Profile, Monitors tabs.

This handoff focuses on the **onboarding**; the module screens are referenced as the destination and share the same kit.

## About the design files

The bundled files are **design references authored in HTML/React-in-Babel** — prototypes showing intended look and behavior, **not** production code to copy verbatim. The task is to **recreate these designs in the target codebase's environment** (the real app is React + `lucide-react`) using its established components and patterns. The prototypes deliberately reuse the app's actual structure/vocabulary; mirror that.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, radii, motion, and interactions are all intentional and should be matched. All values come from the Park Press design tokens (see Design Tokens) — implement against those tokens/CSS variables, not hardcoded hex where a token exists.

---

## Screens / Views

### A. Onboarding shell (host context)

The onboarding is **not** full-screen. It renders **inside the app content area** — the standard app frame is present and unchanged:

- **Left:** the app `NavRail` (full forest field, cream text, gold active marker). "Job Search" is the active item.
- **Top:** the app `topbar` — title "Job Search", mono sub-eyebrow "SETTING UP · FIRST RUN".
- **Content area (`.content`, flex, `padding: 22px 34px 24px`)** holds the onboarding, which fills the region and manages its own internal scroll.

In the real app this is the first-run state of the Job Search route: if the module is not yet configured, render `<JobsOnboarding/>` in the content slot instead of the module tabs. On completion, route to the module.

### B. Onboarding layout (`.ob2`)

CSS grid, two columns, fills content height:

- `grid-template-columns: 1fr 320px; gap: 30px;`
- **Left column (`.ob2-chat`)** — flex column, `min-height:0`:
  - `.ob2-head` — eyebrow "FIRST-RUN SETUP" (gold mono) + display H1 "LET'S SET UP YOUR JOB SEARCH" (30px, weight 800, uppercase, letter-spacing −0.025em). `padding-bottom:16px; border-bottom: 3px solid var(--ink)` (the signature heavy ink rule).
  - `.ob2-log` — `flex:1; min-height:0; overflow-y:auto`. The scrolling conversation. Auto-scrolls to bottom on each new message (`scrollTop = scrollHeight`).
  - `.ob2-composer` — pinned below the log. `border-top: 1px solid var(--line)`. A text input (sunken field) + a 44×44 forest send button (`ArrowUp` icon, radius 8).
- **Right column — `ProfileAside`** (see below), sticky to top.

### C. Conversation elements (inside `.ob2-log`)

Rendered as a vertical list, `gap: 16px`. Each row is left-aligned (Jarvis) or right-aligned (user).

- **Jarvis avatar** — 34px gold circle (`--gold` bg, `--ink` fg) containing the **Strata mark** (three stacked bars, middle bar gold; it's the product's actual brand mark). Shown to the left of every Jarvis row.
- **Jarvis bubble** — `background: var(--surface)`, `border: 1px solid var(--line)`, `border-radius: 4px 12px 12px 12px` (squared top-left tail), padding `12px 16px`, font 14.5/1.55, `text-wrap: pretty`, max-width 82%.
- **User bubble** — `background: var(--accent)`, `color: var(--accent-ink)`, `border-radius: 12px 4px 12px 12px` (squared top-right tail), right-aligned, same padding/size. No avatar.
- **Typing indicator** — a Jarvis bubble with 3 dots (`--ink-3`, 6px) animating `obtype` (staggered 0.15s; translateY −3px, opacity 0.3→1). Shown while Jarvis "thinks" between turns (~620ms).
- **Inline controls** — the _current_ question renders as an interactive control occupying a Jarvis row (indented under the avatar). Types below.
- **Resume critique card** — a **governor-pattern** card: `border: 1px dashed color-mix(in srgb, var(--gold) 55%, transparent)`, `background: color-mix(in srgb, var(--gold) 4%, var(--surface))`, radius 10. Mono eyebrow "READ YOUR RESUME · DRAFT" (gold). A summary paragraph + two columns: "STRENGTHS I'LL CITE" (accent bullet dots) and "I'D SOURCE BEFORE CITING" (amber bullet dots).

### D. Inline control types

- **`resume`** — a dashed dropzone button (full width, dashed `--line-strong` border, radius 10, surface bg): upload glyph + "Drop your resume, or browse" (display 16/800) + mono "PDF · DOCX · up to 5 MB". Click = simulate upload.
- **`confirm`** — a primary Button + a quiet Button (e.g. "Looks right — use it" / "Let's refine it").
- **`single`** — a row of pill chips (`ChipToggle`); clicking one immediately submits. Optional trailing `AddInput` for a custom value (comp floor).
- **`multi`** — pill chips with multi-select (checkmark when on), some seeded pre-selected, an optional inferred chip (dashed gold border, "inferred" mono tag), an `AddInput` to add more, then a primary "Continue"-style CTA + optional skip ("None of these"). `min` selection can gate the CTA.
- **`sources`** — a stack of board rows each with an RSS glyph, name + query, and a `Switch`; below, a "Daily run" mono label + time chips (6:00/7:00/8:00 AM, single-select); then a primary CTA "Watch these N boards" (disabled if 0 enabled).
- **`summary`** (final) — a surface card: status dot + mono "MONITORING ON · FIRST RUN {time}", then primary "Go to Job Search" (routes to module) + quiet "Start over" (resets flow).

**ChipToggle** — pill, `padding: 8px 14px`, radius 999, font 13.5/500. Off: `background: var(--surface)`, `border: 1px solid var(--line-strong)`, ink text. On: `background: var(--accent)`, `color: var(--accent-ink)`, check icon. Inferred (off): dashed gold border, `--gold-hover` text, "inferred" tag.

**AddInput** — a dashed-border rounded text input (sunken field) + a 30px round "+" button; Enter or click adds the trimmed value.

### E. ProfileAside ("Building your profile")

Sticky surface card (`border 1px --line`, radius 8, padding `20px 20px 22px`). Header: mono "BUILDING YOUR PROFILE" + a `{setCount}/8` counter (gold). A 26px gold strap under it. Then 8 rows, each a hairline-separated line:

- 22px round status chip on the left: filled `--accent` + white check when captured; else `--oat-lo` + the field's line icon.
- Mono field label (8.5px) + value (13/500 ink) or muted "Not yet".

Rows, in order: **Resume, Titles, Comp floor, Work mode, Locations, Dealbreakers, Sources, Daily run.** Icons (lucide): FileText, Target, DollarSign, Globe, MapPin, Ban, Rss, Clock.

---

## Interactions & behavior (the conversation script)

State machine keyed by `phase`. On answering a step: append a user bubble, patch the profile, show typing (~620ms), then append Jarvis's next message(s) and reveal the next control.

1. **boot → resume** (on mount): Jarvis says two intro lines, reveals `resume` dropzone.
2. **resume**: on upload → user bubble "📄 ben-ledger-resume.pdf"; typing ~1150ms → set Resume = "Draft — 18/21 claims verifiable"; append **critique card**; reveal `confirm` (Looks right / Let's refine).
3. **resume-confirm**: either answer → Resume = "Approved · rev 7c22a1"; Jarvis asks titles → `multi` seeded [Staff Product Designer ✓, Principal Designer ✓, Design Engineer (inferred)], min 1, add, CTA "Track these titles".
4. **titles** → Comp question → `single` [$175k, $195k, $215k] + custom input.
5. **comp** → Work mode → `single` [Remote-first, Hybrid ok, On-site ok].
6. **workmode** → Locations → `multi` seeded [Remote — US ✓, San Francisco, CA], min 1, add, CTA "Search these".
7. **locations** → Dealbreakers → `multi` seeded [On-site 5 days/week ✓, Below comp floor ✓, No equity], add, CTA "Set dealbreakers", skip "None of these".
8. **dealbreakers** → Sources → `sources` (boards: greenhouse✓/lever✓/ashby✓/workday, times, run 7:00 AM).
9. **sources** → **done**: Sources = enabled board names, Daily run = "{time} daily"; Jarvis says two closing lines; reveal `summary`.

**Composer:** free-text input is functional on the comp step (typing an amount submits it); on other steps it posts the message and Jarvis gently redirects to the chips ("Tap the options above…"). _(Optional enhancement: make every step accept typed answers.)_

**Motion:** typing dots `obtype` 1.1s staggered. Transitions on chips/switches use the token durations (`--dur-fast` 120ms). No bounces.

**Voice (critical — see the DS content rules):** first person ("I'll read it", "I never apply on your behalf"), sentence case, calm/competent/lightly dry, anti-shame, no emoji, no hype. Copy in the prototype is final — reuse it.

## State management

Single component (`JobsOnboarding`) holding:

- `log` — array of `{id, role, node}` messages.
- `typing` — bool.
- `ctrl` — the current active control descriptor (or null).
- `phase` — string state-machine cursor.
- `done` — bool.
- `profile` — `{ resume, titles, comp, workMode, locations, dealbreakers, sources, runTime }` (strings; empty = "Not yet").

In production, `profile` maps to the real search-profile + monitor config the module reads. On `done`, persist it and flip the route from onboarding to the module. Resume upload/critique should call the real resume-ingest/critique service (the prototype simulates with timeouts).

## Design tokens (Park Press — use the CSS variables, don't hardcode)

- **Paper/ink:** `--oat #ece4d1` (ground, never white), `--oat-hi #f2ecdd` (surface), `--oat-lo #e3d9c1` (sunken), `--ink #292621`, `--ink-2`, `--ink-3`.
- **Hairlines:** `--line #d6cbb2`, `--line-strong #b9ab8c`.
- **Accents:** `--forest #294b39` (primary, = `--accent`), `--gold #c2872b` (constant co-accent), `--gold-hover #a9741f`. `--accent-ink` = text on accent. Themes swap **only** `--accent` (forest/sage/canyon/teal/dusk).
- **Semantic:** `--amber #aa6d18` (caution/drift, NOT gold), `--amber-field`, `--red` (destructive only), `--steel` (info).
- **Radii:** chips/bars 2px, buttons/inputs 4px, cards 6–8px, drawers/modals 10px, 999px avatars/dots. (Chat bubbles use the 4/12 asymmetric radii above.)
- **Spacing:** 4px scale (4·8·12·16·24·32·48·64).
- **Type:** display = Neue Haas Grotesk Display (800, BIG, uppercase, tracking −0.02em); body/UI = Neue Haas Grotesk Text (~14–15px); mono = IBM Plex Mono for eyebrows/labels/timestamps (uppercase, letter-spacing 0.14–0.2em). `--font-display / --font-text / --font-mono`.
- **Governor pattern:** AI-generated/unconfirmed content = `--governor-opacity` (~0.7) behind a **dashed gold** keyline; full opacity once the human confirms.
- **Motion:** `--dur-fast 120ms`, `--dur-base 200ms`, `--dur-slow 320ms`, ease `cubic-bezier(0.2,0,0,1)`.
- **Texture:** `.pp-tooth` riso paper-grain overlay on the app frame.

## Assets

- **Icons:** [Lucide](https://lucide.dev) — real app uses `lucide-react`. Glyphs used: Upload, FileText, Check, Minus, Plus, X, ArrowRight, ArrowLeft, ArrowUp, MessageSquare, Rss, ShieldCheck, RotateCcw, Play, Target, DollarSign, Globe, MapPin, Ban, Clock, Briefcase, House, SquareCheck, CalendarDays, Landmark, UserRound.
- **Brand mark:** the **Strata mark** (three stacked bars, middle gold) — inline SVG, lifted from the app's `brand-mark.tsx`. Reuse the app's real component.
- **Fonts:** Neue Haas Grotesk Display + Text (self-hosted OTFs in the DS); IBM Plex Mono (Google Fonts). Use the app's existing font setup.
- No raster imagery.

## Files (in this bundle)

> Source files are provided with a `.txt` suffix (e.g. `JobsOnboarding.jsx.txt`) so this project's design-system compiler does not mistake the copies for live components — rename back to `.jsx` when importing into your codebase.

- `index.html` — the onboarding shell (design reference): app frame (NavRail + topbar + content) hosting `<JobsOnboarding/>`, plus the `.ob2*` layout CSS and `obtype` keyframes. Reference for how it embeds in the app content area.
- `JobsOnboarding.jsx.txt` — the full conversation component: atoms (Strata, Avatar, Row, Bubble, Typing), controls (Control, MultiControl, SourcesControl, ChipToggle, AddInput), ProfileAside, the phase state machine (`handle`), CritiqueCard, Summary, composer. **This is the primary reference.**
- `kit.jsx.txt` — shared Job Search presentational helpers (Eyebrow, Strap, SectionHead, FitBadge, Meta, Confidence, monoLabel) used across onboarding + module.
- `icon.js` — the `Ic` lucide helper used by the prototypes (map to `lucide-react` in production).
- **Module (destination) for reference:** `module/index.html` + `JobsMatches.jsx.txt`, `JobsOverview.jsx.txt`, `JobsProfile.jsx.txt`, `JobsMonitors.jsx.txt` — the steady-state Job Search tabs the onboarding leads into. Same kit and tokens.
- Design-system primitives referenced (`Button`, `Badge`, `Switch`, `NavRail`, etc.) live in the Park Press design system — use the real components in the app.

## Implementation notes

- Recreate against the app's **real** `NavRail`, `Button`, `Badge`, `Switch`, and brand mark — don't reimplement them.
- Keep the onboarding as a **route state** of Job Search, not a separate page: first-run → onboarding; configured → module tabs.
- Wire the resume step and the final config to the real services; the prototype's timeouts are placeholders.
- Match the copy and the voice rules exactly.
