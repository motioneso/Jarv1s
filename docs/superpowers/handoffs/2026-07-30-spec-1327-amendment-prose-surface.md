# Handoff — amend the #1327 spec: give the briefing prose a real surface

**Role:** spec author, amendment pass only. Model: Codex `gpt-5.6-sol` at `high` reasoning.
**You amend one existing spec file and stop. You do not write feature code.**
**Coordinator:** label `Coordinator`, Claude session `43e5f5e2-0deb-4ab5-9237-436e8795b611`.
Re-resolve the pane fresh via `herdr pane list` before messaging — never trust a written pane number.

**Worktree:** `~/Jarv1s/.claude/worktrees/spec-1327` (you are in it), branch
`spec/1327-briefing-action-rows`, currently at `74ef0978` — the spec you (a previous session)
already delivered. Read it first: `docs/superpowers/specs/2026-07-29-1327-briefing-action-rows.md`.

## Why this amendment exists

Ben read the spec, approved of its shape, and then asked: *"where is the prose in the briefing
today? I've never noticed it."*

The coordinator verified the answer on this branch. **The briefing prose is effectively invisible
in the product today.** All four findings are confirmed against the current tree:

1. **Morning briefing prose has zero render sites.** `summaryText` is composed
   (`packages/briefings/src/compose.ts:457`), persisted as `summary_text`
   (`packages/briefings/src/repository.ts:289`), and served
   (`packages/briefings/src/routes.ts:590`). A repo-wide grep for `summaryText` across
   `apps/web/src` and `packages/chat/src` returns **exactly one** hit. It is not the morning one.
2. **The day/morning Today view never reads a briefing run's prose at all.** The "Start here" card
   (`apps/web/src/today/today-page.tsx:332`) is composed client-side from tasks and events. The
   morning briefing run is fetched but its narrative is discarded.
3. **The single render site is `apps/web/src/today/evening-mode.tsx:148`**, and it is truncated to
   220 characters by `compactSummary()` (`evening-mode.tsx:280-284`).
4. **That one site is the `compact` variant, which renders in *day* mode**
   (`today-page.tsx:540`). The `primary` evening card — the "What happened today" section a user
   actually reads in the evening (`today-page.tsx:303`) — renders a heading, a staleness banner and
   a feedback menu, and **no prose whatsoever** (`evening-mode.tsx:138-156`).

No non-web delivery channel was found in `packages/briefings/src` either.

**Ben's ruling: fold the fix into #1327.** His words: "Yea let's add that in 1327 too."

## What this changes about the spec you wrote

Your §7 ("structured payload beside prose", including "No contradiction or duplication") was
written to protect a narrative that is not currently on screen. With this amendment that section
becomes load-bearing rather than theoretical — **re-read it and check it still holds when the prose
is genuinely visible next to the rows.** If it needs tightening, tighten it.

Everything else in the spec stands. **Do not re-open Ben's locked rulings** (§1), do not re-tier the
build, do not restructure sections that this amendment does not touch.

## What the amendment must add

1. **A surface for the morning briefing prose.** The morning run's `summaryText` must render on the
   Today page in day/morning mode. Say exactly where in the existing composition it sits relative to
   "Start here", the suggested-from-email section and the calendar card, and why.
2. **Prose on the `primary` evening card.** "What happened today" must show the recap it is named
   after.
3. **A ruling on truncation, stated explicitly.** `compactSummary()`'s 220-character cut is
   defensible on the small day-mode tile and indefensible on a primary card. Decide per surface and
   write the decision down; do not leave the builder to infer it.
4. **The empty, loading and stale states**, using existing authored patterns — the same requirement
   the issue already makes for the rows (issue requirement 10). `BriefingStaleBanner` already exists
   on the evening path; say whether the morning surface gets it too.
5. **A new dependency-ordered build task in §9, flagged user-facing**, plus matching entries in §11
   exit criteria and the live-path UAT. Order it so the prose surface exists *before* or alongside
   the row UI task — a builder must never ship rows onto a page whose narrative is still missing.

## Constraints

- **This is additive, not a redesign.** No new briefing composition logic, no new API field, no
  migration. The data already exists and is already served; this is a render gap.
- **Design system:** extend existing `jds-brief__*` and `jds-*` primitives. No new raw colours
  outside `apps/web/src/styles/tokens.css`. No mono, no serif. Empty/loading states use authored
  patterns.
- **Re-verify every file:line you cite**, including the four above, before you build on it. The
  coordinator's citations are from 2026-07-30 on this branch, but check them yourself.
- Keep the spec's existing header, status (`draft — awaiting Ben approval`) and risk tier.
  Update the "Grounded on" line to the commit you actually ground on.

## Deliverable

Amend `docs/superpowers/specs/2026-07-29-1327-briefing-action-rows.md` in place. Commit
(`docs(specs): surface the briefing prose in the #1327 spec (#1327)`) and push the branch. Do
**not** open a PR. Do **not** write code outside `docs/superpowers/specs/`. Do **not** touch
`docs/coordination/` — coordinator-only.

Then report to the `Coordinator` pane with the commit sha and a **five-line maximum** summary: what
you added, the truncation ruling you made, and anything you want Ben to rule on.

## Escalation

A genuine product fork the finding does not settle — tag it `[DESIGN-FORK]` and stop. Do not guess.
Message via `herdr pane run <coordinator-pane> "<msg>"` after resolving the pane by label.
