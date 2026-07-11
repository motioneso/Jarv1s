# sports-live-score (#963) — relay handoff

Relaying at 70% context, **before any code was written**. All work so far is research/analysis, captured below. Successor's first action is still the plan doc — no code-write gate has been reached yet.

## Task

GitHub issue #963: "Sports card: show live score in the footer match-strip for LIVE games."
Worktree: `feat/sports-live-score-strip` (off `origin/main` `9d4589d1`), same worktree as this doc.
Coordinator: Herdr label `Coordinator` (resolve pane fresh — never reuse a cached `pane_id`), session `58a78927-385c-4b1d-8fa0-94db20255d6f`.

Coordinator ack (2026-07-11, mid-relay) confirmed scope:
- Live score goes into the **footer match-strip** (the dark `.sp-next` bar), REMOVED from the bold body slot.
- Body **reverts to the news lede** for live cards, same as non-live cards.
- **Both surfaces stay in lockstep** (`/sports` FeaturedTeamCard + `/today` TickerTeam) — confirmed, not just my inference.
- Reuse `card.primary` — **no contract/endpoint/schema change**. This keeps the work ROUTINE tier.
- Next steps expected by coordinator: confirm successor driving → write plan doc → ping coordinator for approval (do NOT start coding before that ping is answered).

## Component location (confirmed via repo-wide grep, not under apps/web/src)

`packages/sports/src/web/sports-ticker.tsx` (631 lines) — two near-duplicate card components:

- **`FeaturedTeamCard`** (lines ~265-387) — `/sports` desk-strip card.
- **`TickerTeam`** (lines ~398-492) — `/today` compact card.

Both currently:
- `showNews = card.status === "news" || (card.status === "today" && card.todayGameState !== "final")` — does **not** include `"live"`, so live cards show the score in the bold body slot via `isScore = !showNews && /\d/.test(card.primary)`.
- Footer: `{card.nextMatch && card.status !== "live" ? <...NextGameContent/NextGameBar.../> : null}` — explicitly **hides** the footer strip for live cards today. This is the exact behavior #963 wants reversed.

Shared footer bits:
- `NextGameContent` (lines ~607-630) — shared strip content (venue token `vs`/`@` + `Crest` + date/time), explicitly commented as shared between both surfaces.
- `NextGameBar` (lines ~584-590) wraps it for TickerTeam: `<div className="sp-tk__next sp-next">`.
- FeaturedTeamCard wraps it inline: `<div className="sp-feat__next sp-next">`.
- `LiveDot` imported from `./sports-parts.js` (defined `sports-parts.tsx:49-51`).

## Data reachability — confirmed, NO new endpoint/schema needed

`packages/shared/src/sports-api.ts` — `FollowedTeamCard.primary: string` **already carries the live score text** (e.g. `"MIN 21 – 14 DAL"`) for `status: "live"` cards, already wire-compatible, already sent to the client today (it's what currently renders in the body slot). `resultMatch` is a separate/different field only for finished games — not relevant here. **This satisfies the issue's data constraint; no DESIGN-FORK needed for data.** (Coordinator has now also confirmed this scope directly — see ack above.)

## CSS bug to fix while implementing

Stock `LiveDot`/`.sp-livedot` has `background: var(--accent)` (`sports-1.css:87-93`). The `.sp-next` strip background is *also* `var(--accent)` (`sports-4-grid.css:~240`). Reusing the dot unmodified inside the strip renders an **invisible dot** (same color as background). Fix: scoped override `.sp-next .sp-livedot { background: var(--text-on-accent); }`.

Other planned CSS additions in `packages/sports/src/web/styles/sports-4-grid.css`:
- `.sp-next__live` — live-indicator layout inside the strip (dot + "LIVE" label, mono per design system).
- `.sp-next__score` — score text styling inside the strip (replaces the plain `sp-next__when` slot's normal date/time content when live).

Reference existing classes for style (already read, lines noted): `.sp-next` / `.sp-next__venue` / `.sp-next__when` (`sports-4-grid.css:240-283`), `.sp-feat__flag--live` (`:433-457`), `.sp-feat__score` / `.sp-feat__matchup` (`:538-552`).

## Design shape (worked out, not yet written as a plan doc)

Single shared component, reused by both surfaces (per issue's explicit instruction: "One consistent strip component across both states; live vs upcoming is a variant, not a new component"):

- New `LiveStripContent` (mirrors `NextGameContent`'s shape/pattern) — renders `LiveDot` + "LIVE" + `card.primary` (the score text) inside the same `.sp-next` shell classes.
- In `FeaturedTeamCard` footer: change condition to render `.sp-feat__next.sp-next` whenever `card.nextMatch` OR `card.status === "live"` — content branches `card.status === "live" ? <LiveStripContent card={card}/> : <NextGameContent next={card.nextMatch}/>`.
- In `TickerTeam`: same branch, likely via a small `LiveStripBar` wrapper mirroring `NextGameBar`'s wrapping pattern (`sp-tk__next sp-next`).
- `showNews` gains `|| card.status === "live"` so live cards' body reverts to the news lede (falls back to "No recent news" placeholder when `stories: []`, matching existing pattern already used for `"news"` status).
- `isScore` becomes dead for the live case once `showNews` covers it — verify no other branch depends on `isScore` being true for live cards (re-check the surrounding render logic when actually editing, don't trust this summary blindly).

## Test changes needed

`tests/unit/sports-ticker.test.tsx` (186 lines, already read in full):
- Test at lines 52-66 ("renders a live team block with score and header sub-row, footer hidden") — **must flip**: `expect(html).not.toContain("sp-feat__next")` → `.toContain(...)`. Also add assertions: footer now contains the score text (`"MIN 21 – 14 DAL"`), and body now shows the "No recent news" placeholder (fixture already has `stories: []`) instead of the score.
- `TickerTeam` currently has **zero dedicated test coverage** — add a new test importing `TickerTeam` from `../../packages/sports/src/web/sports-ticker.js`, wrapped in `QueryClientProvider` (`NextGameContent`/`LiveStripContent` call `useUserLocale()` → `useQuery`, will throw without the provider — see existing `render()` helper in this file for the wrapping pattern).
- `tests/unit/sports-page.test.tsx` — checked, its `not.toContain("sp-tk__next")` assertion (lines ~220-242, ~770-803) is on a FeaturedTeamCard-only render (wrong CSS-class family, `sp-tk__` vs `sp-feat__`) — **will keep passing regardless, no edit needed**. Don't re-verify this from scratch, it was already ruled out.

## Files touched by this build (expected)

| File | Change |
|---|---|
| `packages/sports/src/web/sports-ticker.tsx` | `showNews` extension, footer branch in both components, new `LiveStripContent`/`LiveStripBar` |
| `packages/sports/src/web/styles/sports-4-grid.css` | `.sp-next__live`, `.sp-next__score`, `.sp-next .sp-livedot` override |
| `tests/unit/sports-ticker.test.tsx` | flip live-footer assertion, add TickerTeam test |

No changes expected to `packages/shared/src/sports-api.ts` (no schema/contract change) or `today-widget.tsx` / `sports-page.tsx` (wiring already correct, confirmed via grep, not read in full).

## Still pending — successor's actual next steps

1. Confirm you're driving (you're reading this because you are).
2. **`superpowers:writing-plans`** → write `docs/superpowers/plans/2026-07-11-sports-live-score-strip.md` using the shape above as the content (Goal / Architecture / Tech Stack / Global Constraints / File Map table / TDD task list — mirror `docs/superpowers/plans/2026-07-11-js-05-monitoring.md`'s structure).
3. **`herdr-pane-message`** the coordinator (resolve pane fresh by label `Coordinator`, confirm exactly one match, use the session id to double check — do not trust a pane number from this doc) with the plan path. **STOP and wait for approval — do not write code first.**
4. After approval: TDD build (`superpowers:test-driven-development`), one task at a time, green commits, `git add <explicit path>` only (never `-A`/`.` — shared tree).
5. Manual visual check in browser, both light + dark themes (UI-change requirement, not just typecheck/tests).
6. Pre-push trio + rebase before pushing: `pnpm format:check && pnpm lint && pnpm typecheck` then `git fetch origin main && git rebase origin/main`.
7. **`coordinated-wrap-up`**: full local gate, push, open PR containing "Closes #963", report to coordinator. Do not merge/move board/close issue yourself.
8. Relay again at the next 70% warning or compaction summary — don't wait for felt degradation.

## Bans (still in force)

Work only in this worktree/branch. `git add` by explicit path only. Never touch `docs/coordination/`. Never merge. Caveman/terse style to the coordinator (commit messages/PR bodies stay conventional).
