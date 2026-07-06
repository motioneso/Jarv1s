# Specification: Sports Module Editorial Redesign

**Date:** 2026-07-05
**Parent Epic:** #726 (Park Press platform reskin)
**Scope:** Visual-only redesign of the sports module frontend. No changes to API contracts, queries, or backend services.

This spec establishes the sports module as the "sports-broadsheet" child of the Park Press platform reskin (#726). It transitions the module from a card-based layout to a dense, hairline-ruled editorial grid, binding strictly to token names and aligning with the overarching shift toward "oat paper, forest/gold, and hairline rules."

**Sequencing:** This redesign is subordinate to #726. If the Park Press token flip is still pending approval, this work must either be sequenced after it, or built using current semantic tokens (`--surface`, `--border-subtle`) which will seamlessly inherit the Park Press values upon the flip.

## 1. Typography & Spacing System

All hardcoded pixels and arbitrary values are banned. The design will bind strictly to existing design system tokens.

- **Typography:** Hierarchy will rely on scale and weight using existing `--font-display`, `--font-sans`, and `--font-mono` tokens. Raw pixel sizes (e.g., `14.5px`, `9.5px`) will be replaced with standard scaling classes or variables.
- **Spacing:** All literal pixel gaps and paddings (e.g., `padding: 15px 16px 14px`) are replaced with the `--space-1` through `--space-11` token scale.

## 2. Structural Layout

We are abandoning floating cards with drop shadows in favor of the #726 "hairline rules + fields" aesthetic.

### 2.1 The Ticker (Followed Teams & Leagues)

The grid of `.sp-fc` cards is replaced by a dense, horizontally scrolling tabular "Ticker" at the top of the page.

- **Content Preservation:** The ticker rows will retain all critical data from the old cards: `team/league name`, `recent form pips` (honoring never-red semantics), `standing`, and `next-match line`.
- **League Follows:** Whole-league follows (fixed in #763) will render as grouped headers or distinct ticker blocks, ensuring they remain a first-class state.
- **Overflow & A11y:** The ticker will be keyboard-navigable (focus management for horizontal scrolling) with visible gradient fades indicating overflow for 12+ teams.

### 2.2 The Editorial Grid

The main body uses a strict multi-column grid, demarcated entirely by 1px `var(--border-subtle)` hairlines instead of container backgrounds.

- **Edge-to-Edge Hero:** The lead story or live match sits directly below the ticker, spanning full-width to anchor the hierarchy.
- **Responsive Behavior:** On mobile (`< 768px`), the multi-column grid collapses into a single-column feed. Hairline column dividers become horizontal row separators to maintain the editorial feel without horizontal crowding.

## 3. States & Accessibility

- **Empty & Loading States:** The `EmptyState`, `DegradedBand`, and `SportsSkeleton` will abandon legacy `var(--surface-2)` containers, adopting the Park Press hairline/field aesthetic while maintaining their authored behavior.
- **Animations:** The pulsing `LiveDot` and skeleton loaders must continue to honor `prefers-reduced-motion`.
- **Accessibility:** Strict adherence to WCAG contrast ratios for hairlines in dark theme. Live scores will include `aria-live` attributes for screen reader announcements.

## 4. File Structure (File-size Gate)

`sports-1.css` is currently at the 1000-line cap (985 lines).

- **Split Plan:** This rewrite will extract the new Ticker and Editorial Grid styles into a new file (`sports-4-grid.css`) to prevent busting the file-size gate, leaving `sports-1.css` for foundational layout and shared tokens.

## 5. Regression Checklist (Must Not Regress)

This is a visual-only refactor. The following functional fixes recently landed on `main` and **must survive** this redesign:

- [ ] **#796 (H2):** `refetchInterval` gated on `hasLiveGame` plus window-focus refetch.
- [ ] **#811 (H4):** Empty state fetches default slate at zero follows.
- [ ] **#763 (H3):** `FollowedLeaguesSection` explicitly handles whole-league follows.
- [ ] **#765 (M1):** `DegradedBand` notice renders when upstream sources fail.
- [ ] **H1:** `today()` logic using `localDay(ESPN_TIMEZONE)` (no UTC bug).
- [ ] **M4:** Use of `competitionLabel` instead of raw keys across all renders.

## 6. Exit Criteria & Verification Plan

1.  **Visual Audit:** The page renders a strict hairline grid and top ticker, with no hardcoded px values for spacing, verified against #726 mockups.
2.  **State Audit:** Loading, Empty, and Degraded states render correctly and match the new aesthetic.
3.  **Responsive Check:** The grid collapses gracefully to a single column on mobile viewports.
4.  **Regression Check:** All items in Section 5 pass functional testing.
