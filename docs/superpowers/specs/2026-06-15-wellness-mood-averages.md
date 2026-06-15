# Spec — Wellness daily-average mood (today card + chart tooltip) — feedback pass 4

**Status:** approved (owner-directed feedback, 2026-06-15). Refinement of merged wellness work
(#256, #261, #262). Routine tier — frontend-only (wellness web), client-side aggregation; no
schema/API/auth/secret/RLS surface.

## Source — two owner agentation annotations (2026-06-15, `/wellness`)

1. **Mood card (`mqflffbd-epjhx2`)** — on `<WellnessToday> <CheckinToday>` card: _"This still
   shouldn't be 'Today's check in' necessarily. I think it might be good to have a current mood and
   an average mood for the day as well."_
2. **Chart tooltip (`mqflgbzb-cxbwvt`)** — on `<WellnessTrends> <WellnessChart>` chart tip: _"This
   just shows the last check-in for the mood, we should show the avg for the day. Also, this needs to
   hide when the user clicks outside of it."_

## Canonical mood value (use this — do NOT invent a new metric)

Mood is `moodIndex(feelingCore, intensity)` from `@jarv1s/shared`, with `moodBand(v)` for the band
label. Already used by `wellness-history.tsx:195` and `wellness-today.tsx:462`. **Daily average mood
= mean of `moodIndex(ck.feelingCore, ck.intensity ?? 3)` across that day's check-ins**, labeled via
`moodBand`. Reuse these helpers; do not define a parallel mood metric.

## Decisions (locked)

- **D1 — today card shows current + daily-average mood.** In `apps/web/src/wellness/wellness-today.tsx`
  (`CheckinToday`), surface BOTH: **current mood** (latest check-in's `moodIndex`/band — what it
  shows today) AND **average mood for the day** (mean `moodIndex` over today's check-ins, with band).
  Reconsider the "Today's check in" heading so it reads as a mood summary (e.g. "Today's mood" with
  current + average sub-stats). Build a sensible functional default for copy/layout — Ben annotates
  the visual later (functionality pass). If there is only one check-in today, current == average
  (show gracefully); if zero, keep the existing empty/CTA state.
- **D2 — chart tooltip shows the day's average + dismisses on outside-click.** In
  `apps/web/src/wellness/wellness-chart.tsx` (rendered by `<WellnessTrends>`): the tooltip must show
  the **average mood for the hovered/selected day** (not the last check-in's mood). Add
  **outside-click dismissal**: a `pointerdown`/`click` listener (added in a `useEffect`, removed in
  its cleanup) that closes the tooltip when the click target is outside the chart + tooltip.
  **Invariant:** do NOT put side effects inside a `setState` updater (StrictMode double-invokes
  updaters in dev — see project memory); register/teardown the listener in `useEffect`.

## Acceptance criteria

- Today card (`/wellness`) shows current mood AND average-mood-for-the-day; the "Today's check in"
  label is reworked to a mood summary. Degrades cleanly for 0 / 1 check-in days.
- Chart tooltip shows the selected day's **average** mood (verify against a day with ≥2 check-ins),
  and the tooltip **closes when the user clicks/taps outside** it.
- Average uses `moodIndex`/`moodBand` from `@jarv1s/shared` — no new mood metric, no API change.
- `pnpm verify:foundation` green (REAL exit 0). Add/adjust a small unit test for the daily-average
  helper if one is extracted.
- (Cleanup, fold-in from #262 QA) remove now-dead CSS left by the radial change: `.wl-radial`
  (~`wellness-2.css:713`) and the dead `.wl-dial__hub .lbl/.val` selectors — only if touching that
  CSS; do not expand scope hunting for unrelated dead code.

## Out of scope

- Backend aggregation endpoints (compute client-side over already-fetched check-ins).
- New check-in fields, taxonomy, or insights/therapy-notes changes.
- The radial picker itself (landed in #262).
