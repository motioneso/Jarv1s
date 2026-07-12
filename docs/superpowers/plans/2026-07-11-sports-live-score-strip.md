# Sports Live-Score Strip (#963) Implementation Plan

> **For agentic workers:** Coordinated-build mode — the plan author executes this inline,
> task-by-task, TDD, after Coordinator approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a followed team's game is live, the card's footer strip (normally "next game")
shows the current live score + a LIVE indicator, and the card body reverts to the news lede —
on both `/sports` (FeaturedTeamCard) and `/today` (TickerTeam).

**Architecture:** All changes live in `packages/sports/src/web/sports-ticker.tsx` (both card
components) plus a small CSS addition to the shared `.sp-next` block. A new shared
`LiveNowContent` footer-content component keeps the two surfaces in lockstep, mirroring how
`NextGameContent` is already shared. **No data/contract change:** for a live game the server
already sets `card.primary = scoreLine(game)` (`packages/sports/src/sports-service.ts:691-693`),
e.g. `"MIN 21 – 14 DAL"` — the strip just relocates where that text renders. If any step turns
out to need a new endpoint or a `packages/shared/*-api.ts` change, STOP and escalate
`[DESIGN-FORK]` to the Coordinator.

**Tech Stack:** React 19 function components, `renderToString` unit tests in the root vitest
suite (`tests/unit/*.test.tsx`), authored `sp-*` CSS in `packages/sports/src/web/styles/`.

## Global Constraints

- Preserve the authored design system: reuse the existing `.sp-next` dark/accent strip exactly
  (`background: var(--accent)` / `color: var(--text-on-accent)`); raw colors only in
  `apps/web/src/styles/tokens.css`; no curved colored left-border accents.
- Non-live cards' strip behavior is UNCHANGED (next-game bar for `nextMatch`, absent otherwise).
- Both surfaces change in lockstep — the file's own comments mandate FeaturedTeamCard and
  TickerTeam not drift.
- `git add` explicit paths only; work only in this worktree on `feat/sports-live-score-strip`.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Design decisions (from verified current state)

1. **Body reverts to lede for live.** Both components gate the body on `showNews`; add
   `card.status === "live"` to that gate. A storyless live card therefore shows the honest
   "No recent news" placeholder — exactly like a non-live news card, per Ben's "exactly like a
   non-live card". The bold body score (`sp-feat__score` / `sp-tk__score` path via
   `card.primary`) no longer renders for live.
2. **Strip carries score + LIVE.** New shared `LiveNowContent` renders inside the same
   per-surface containers the next-game bar uses (`.sp-feat__next.sp-next` /
   `.sp-tk__next.sp-next`). Composition mirrors `NextGameContent`: "Live" token + pulse dot on
   the left (where the `vs`/`@` venue token sits), score floated right via the existing
   `.sp-next__when` margin-left:auto idiom.
3. **Live strip does not depend on `nextMatch`.** The current footer gate is
   `card.nextMatch && card.status !== "live"`. New gate: live → live strip (always, score is
   always present for status "live"); else `nextMatch` → next-game bar; else nothing.
4. **FeaturedTeamCard story cap.** `hasNextBar` (2-story cap when a footer exists, 3 when not)
   becomes "has a footer bar at all": live cards get the footer back, so they drop to the
   2-story cap. (Self-identified in relay research; carried forward.)
5. **Existing live markers stay.** The banner "Live" flag (FeaturedTeamCard) and name-row live
   chip (TickerTeam) are untouched — the design only moves the score. Flagging to Coordinator
   as a note, not a fork: if the double LIVE reads redundant, removing the top markers is a
   one-line follow-up.
6. **`.sp-livedot` needs a `currentColor` override inside the strip** — its background is
   `var(--accent)`, invisible on the strip's accent ground.
7. **No `aria-live` on the strip score.** The `/sports` hero already announces the live score
   politely; a per-card polite region across a four-up strip would be noisy. Screen readers
   still read the score as static text.

## Current state (verified 2026-07-11 on this branch, no drift)

- `packages/sports/src/web/sports-ticker.tsx:269-277` — FeaturedTeamCard `showNews` /
  `hasNextBar` / `storyCap`.
- `sports-ticker.tsx:372-383` — FeaturedTeamCard footer gate (`card.nextMatch && card.status !== "live"`).
- `sports-ticker.tsx:404-405, 489` — TickerTeam `showNews` and footer gate.
- `sports-ticker.tsx:607-631` — shared `NextGameContent` (composition template for `LiveNowContent`).
- `packages/sports/src/web/styles/sports-4-grid.css:240-277` — shared `.sp-next` block.
- `tests/unit/sports-ticker.test.tsx:52-66` — existing test asserts live card has NO
  `sp-feat__next`; must be updated to the new design.
- `tests/unit/sports-page.test.tsx:234-242` — asserts `not.toContain("sp-tk__next")` on a live
  fixture with a stale mrawrk0e comment; the /sports page never renders `sp-tk__*` so it's
  vacuous — update it to assert the new live strip instead (no-stale-concepts rule).
- TickerTeam currently has NO direct render tests — Task 2 adds them.

## File Structure

- Modify: `packages/sports/src/web/sports-ticker.tsx` — `LiveNowContent` (new, shared),
  FeaturedTeamCard body/footer gates (Task 1), TickerTeam body/footer gates (Task 2).
- Modify: `packages/sports/src/web/styles/sports-4-grid.css` — `.sp-next__livetag`,
  `.sp-next__score` in the shared `.sp-next` block (Task 1).
- Modify: `tests/unit/sports-ticker.test.tsx` — update live FeaturedTeamCard test, add live/non-live
  strip tests for both surfaces (Tasks 1 & 2).
- Modify: `tests/unit/sports-page.test.tsx` — replace the vacuous live-footer assertion (Task 1).

---

### Task 1: LiveNowContent + FeaturedTeamCard (/sports strip)

**Files:**

- Modify: `packages/sports/src/web/sports-ticker.tsx:265-386` (FeaturedTeamCard) + new
  `LiveNowContent` next to `NextGameContent` (~line 607)
- Modify: `packages/sports/src/web/styles/sports-4-grid.css` (after `.sp-next__when`, ~line 277)
- Test: `tests/unit/sports-ticker.test.tsx`, `tests/unit/sports-page.test.tsx`

**Interfaces:**

- Consumes: `card.primary: string` (live score text, already on `FollowedTeamCard`), `LiveDot`
  from `./sports-parts.js`.
- Produces: `function LiveNowContent(props: { scoreText: string })` — module-private shared
  footer content, reused verbatim by Task 2. CSS classes `.sp-next__livetag`, `.sp-next__score`.

- [ ] **Step 1: Update + write failing tests**

In `tests/unit/sports-ticker.test.tsx`, REPLACE the first test (lines 52-66) — its
"footer hidden" expectation is the old design — with:

```tsx
it("renders a live team with the score in the footer strip and news in the body (#963)", () => {
  const html = render([
    card({
      stories: [story({ title: "Vikings lead late in Dallas", url: "https://example.com/live" })]
    })
  ]);
  expect(html).toContain("sp-ticker");
  expect(html).toContain("Minnesota Vikings");
  // standing + form stay in the header sub-row (mrawlzb7)
  expect(html).toContain("sp-feat__sub");
  expect(html).toContain("sp-formpip");
  expect(html).toContain("2nd · NFC North");
  // #963: the live score moves into the footer strip (same .sp-next bar as next-game),
  // with a LIVE token; the body slot goes back to the news lede like any non-live card.
  expect(html).toContain("sp-feat__next");
  expect(html).toContain("sp-next__livetag");
  expect(html).toContain("MIN 21 – 14 DAL");
  expect(html).toContain("Vikings lead late in Dallas");
  // the bold body score is gone — no score-styled body element renders
  expect(html).not.toContain("sp-feat__score");
  // live strip shows the score, never the upcoming fixture, even though nextMatch is set
  expect(html).not.toContain("sp-next__venue");
  // the competition/status eyebrow row stays removed (mratgoq4)
  expect(html).not.toContain("sp-feat__comp");
});

it("shows the No-recent-news placeholder on a storyless live card (#963)", () => {
  const html = render([card({ stories: [] })]);
  expect(html).toContain("No recent news");
  expect(html).toContain("sp-next__livetag");
  expect(html).toContain("MIN 21 – 14 DAL");
  expect(html).not.toContain("sp-feat__score");
});

it("caps a live card at two secondary stories — the strip needs its room (#963)", () => {
  // live behaves like any footer-bearing card: lede + 2 links, not lede + 3 (relay-2 note).
  const html = render([
    card({
      stories: [
        story({ title: "Lede story", url: "https://example.com/a" }),
        story({ title: "Second story", url: "https://example.com/b" }),
        story({ title: "Third story", url: "https://example.com/c" }),
        story({ title: "Fourth story", url: "https://example.com/d" })
      ]
    })
  ]);
  expect(html).toContain("Second story");
  expect(html).toContain("Third story");
  expect(html).not.toContain("Fourth story");
});
```

The existing non-live tests ("shows the next-game footer…", "fills the pre-game today
primary…", final/resultMatch tests) stay untouched — they are the "non-live unchanged" coverage.

In `tests/unit/sports-page.test.tsx`, REPLACE lines 239-241 (comment + assertion):

```tsx
// #963: the fixture card is live — the footer strip carries the live score + LIVE token
// (supersedes mrawrk0e's hidden-footer rule); body/next-game specifics live in the
// ticker's own suite.
expect(html).toContain("sp-next__livetag");
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run tests/unit/sports-ticker.test.tsx tests/unit/sports-page.test.tsx`
Expected: the three new/updated sports-ticker tests FAIL (no `sp-feat__next` / `sp-next__livetag`
on live cards yet; body still renders `sp-feat__score`); sports-page live-strip assertion FAILS.

- [ ] **Step 3: Implement**

In `packages/sports/src/web/sports-ticker.tsx`:

(a) Add the shared footer content component directly above `NextGameContent` (~line 607):

```tsx
// Live-score footer content for BOTH surfaces (#963): while a game is in progress, the strip
// that normally carries the next fixture carries the current score instead — same dark
// .sp-next bar, so live and upcoming read as one system across the card bases. Composition
// mirrors NextGameContent: status token on the left (where the venue token sits), score
// floated right in the kickoff slot. scoreText is card.primary — the server already writes
// scoreLine(game) there for a live game, so no new data crosses the contract.
function LiveNowContent(props: { scoreText: string }) {
  return (
    <>
      <span className="sp-next__livetag">
        <LiveDot />
        Live
      </span>
      <span className="sp-next__when sp-next__score">{props.scoreText}</span>
    </>
  );
}
```

(b) In FeaturedTeamCard, extend the body gate and rename the footer-cap flag (lines 269-285):

```tsx
// Body slot rule (#963 supersedes the live half of mrawrk0e): pre-game/idle AND live cards
// lead with news — a live game's score lives in the footer strip now, not the body — while
// a finished game still leads with its result.
const showNews =
  card.status === "news" ||
  card.status === "live" ||
  (card.status === "today" && card.todayGameState !== "final");
const lead = card.stories[0] ?? null;
// The footer bar renders for an upcoming fixture OR a live game (#963). A card with no
// footer at all spends that space on one more headline instead of leaving a gap (Ben
// 2026-07-09 /sports). Footer-bearing cards keep the tighter two-link cap.
const hasFooterBar = card.status === "live" || Boolean(card.nextMatch);
const storyCap = hasFooterBar ? 2 : 3;
```

(`isScore` on line 285 stays as-is: with live now inside `showNews`, it only classifies the
final-without-resultMatch fallback, which is unchanged.)

(c) Replace the footer gate (lines 369-383):

```tsx
{
  /* Footer strip (#963): a live game shows its current score here — the same dark
            .sp-next bar the next fixture uses — so the strip is the one place a live card
            differs from its neighbors. Otherwise the upcoming fixture renders as before;
            no footer when there is neither. */
}
{
  card.status === "live" ? (
    <div className="sp-feat__next sp-next">
      <LiveNowContent scoreText={card.primary} />
    </div>
  ) : card.nextMatch ? (
    <div className="sp-feat__next sp-next">
      <NextGameContent next={card.nextMatch} />
    </div>
  ) : null;
}
```

(Delete the old mrawrk0e/mrbaaq24 comment block above it — its "footer stays hidden while
live" rule is superseded; keep the "Shared dark footer bar with /today" sentence folded into
the new comment if desired.)

(d) In `packages/sports/src/web/styles/sports-4-grid.css`, after `.sp-next__when` (~line 277):

```css
/* Live-score strip (#963): while a game is in progress the footer bar carries the current
   score instead of the next fixture — same .sp-next ground. The LIVE token takes the venue
   token's slot; same 2xs uppercase voice as .sp-tk__live / .sp-feat__flag. */
.sp-next__livetag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}
/* The pulse dot is accent-on-accent inside this bar — repaint it in the bar's text color. */
.sp-next__livetag .sp-livedot {
  background: currentColor;
}
/* Score rides the .sp-next__when right-float slot; tabular figures so a changing score
   doesn't jitter the bar. */
.sp-next__score {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/sports-ticker.test.tsx tests/unit/sports-page.test.tsx`
Expected: PASS (all, including untouched non-live tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/web/sports-ticker.tsx packages/sports/src/web/styles/sports-4-grid.css tests/unit/sports-ticker.test.tsx tests/unit/sports-page.test.tsx
git commit -m "feat(sports): live score in the followed-strip footer on /sports (#963)

While a followed team's game is live, the card's footer strip now shows the
current score with a LIVE indicator instead of disappearing, and the card body
returns to the team's latest news — same as any other card.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TickerTeam (/today widget) in lockstep

**Files:**

- Modify: `packages/sports/src/web/sports-ticker.tsx:398-492` (TickerTeam)
- Test: `tests/unit/sports-ticker.test.tsx` (new `describe("TickerTeam")` block)

**Interfaces:**

- Consumes: `LiveNowContent(props: { scoreText: string })` from Task 1 (same module);
  `TickerTeam` is already exported from `sports-ticker.tsx`.
- Produces: nothing new — behavioral parity with Task 1.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/sports-ticker.test.tsx` (imports: add `TickerTeam` to the existing
`sports-ticker.js` import):

```tsx
// TickerTeam is the /today widget variant of the same card; #963 keeps the two surfaces in
// lockstep, so it gets its own live/non-live strip coverage (it had no direct tests before).
function renderTickerTeam(overrides: Partial<FollowedTeamCard> = {}): string {
  const client = new QueryClient();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(TickerTeam, { card: card(overrides) })
    )
  );
}

describe("TickerTeam", () => {
  it("renders a live team with the score in the footer strip and news in the body (#963)", () => {
    const html = renderTickerTeam({
      stories: [story({ title: "Vikings lead late in Dallas", url: "https://example.com/live" })]
    });
    expect(html).toContain("sp-tk__next");
    expect(html).toContain("sp-next__livetag");
    expect(html).toContain("MIN 21 – 14 DAL");
    expect(html).toContain("Vikings lead late in Dallas");
    // the bold body score is gone; the strip never shows the upcoming fixture while live
    expect(html).not.toContain("sp-tk__score");
    expect(html).not.toContain("sp-next__venue");
  });

  it("shows the No-recent-news placeholder on a storyless live card (#963)", () => {
    const html = renderTickerTeam({ stories: [] });
    expect(html).toContain("No recent news");
    expect(html).toContain("sp-next__livetag");
    expect(html).toContain("MIN 21 – 14 DAL");
  });

  it("keeps the next-game footer for a non-live card (#963 non-regression)", () => {
    const html = renderTickerTeam({ status: "news", primary: "", stories: [story()] });
    expect(html).toContain("sp-tk__next");
    expect(html).toContain("sp-next__venue");
    expect(html).toContain("vs Green Bay Packers");
    expect(html).not.toContain("sp-next__livetag");
  });
});
```

- [ ] **Step 2: Run tests to verify the live ones fail**

Run: `pnpm vitest run tests/unit/sports-ticker.test.tsx`
Expected: the two live TickerTeam tests FAIL (body renders `sp-tk__score` with the score,
footer absent); the non-live test PASSES (current behavior — it's the pinned non-regression).

- [ ] **Step 3: Implement**

In TickerTeam:

(a) Extend the body gate (lines 400-405) — replace the comment + `showNews`:

```tsx
// Body slot rule (#963 supersedes the live half of mrawrk0e): pre-game today AND live cards
// lead with news — the footer already carries the fixture (pre-game) or the live score
// (in progress), so the primary text would duplicate it. Only the matchup/score text was
// redundant; news fills the slot so every card shares one anatomy (top-area 2026-07-07).
const showNews =
  card.status === "news" ||
  card.status === "live" ||
  (card.status === "today" && card.todayGameState !== "final");
```

(b) Replace the footer gate (line 489) and its comment's live sentence:

```tsx
{
  /* Footer strip (#963): a live game shows its current score in the same inverted bar the
          next fixture uses (supersedes mrawrk0e's hidden-footer rule); otherwise the next-game
          bar renders as before. Today games read "Today · 6:45 PM" (mrawhf6q). */
}
{
  card.status === "live" ? (
    <div className="sp-tk__next sp-next">
      <LiveNowContent scoreText={card.primary} />
    </div>
  ) : card.nextMatch ? (
    <NextGameBar next={card.nextMatch} />
  ) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/sports-ticker.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/web/sports-ticker.tsx tests/unit/sports-ticker.test.tsx
git commit -m "feat(sports): live score in the followed-card footer on /today (#963)

The /today followed-team cards get the same treatment as the /sports strip:
while a game is live, the footer bar shows the current score with a LIVE
indicator and the card body shows the team's latest news.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Wrap-up (after both tasks)

- Visual check both themes via the dev server (live card needs a mocked/live fixture; at minimum
  confirm non-live cards render unchanged and CSS parses).
- Pre-push trio + rebase: `pnpm format:check && pnpm lint && pnpm typecheck` then
  `git fetch origin main && git rebase origin/main`.
- Full local gate per repo standard, then `coordinated-wrap-up` (push, PR "Closes #963",
  report to Coordinator; no merge/board/close).

## Exit Criteria coverage

| Requirement (Ben's confirmed design)                                     | Task                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Live: strip shows current score + LIVE indicator, authored strip styling | 1 (FeaturedTeamCard), 2 (TickerTeam)                      |
| Live: bold body score removed, body = news lede like non-live            | 1, 2 (tests assert no `sp-feat__score`/`sp-tk__score`)    |
| Non-live strip unchanged                                                 | existing sports-ticker tests + Task 2 non-regression test |
| Both surfaces in lockstep                                                | shared `LiveNowContent`; per-surface tests                |
| No schema/contract change                                                | none made; `[DESIGN-FORK]` escape hatch documented        |
