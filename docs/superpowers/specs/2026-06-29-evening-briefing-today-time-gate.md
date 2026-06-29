# Evening briefing Today time gate (#511)

**Status:** draft
**Date:** 2026-06-29
**Owner:** Angela
**Issue:** #511
**Grounded on:** `~/Jarv1s/apps/web/src/today/today-page.tsx:66-551`,
`~/Jarv1s/apps/web/src/briefings/briefing-settings-model.ts:8-28`,
`~/Jarv1s/apps/web/src/settings/settings-module-subviews.tsx:149-178`,
`~/Jarv1s/packages/shared/src/briefings-api.ts:1-94`,
`~/Jarv1s/docs/superpowers/specs/2026-06-25-evening-review-and-interview.md`,
`~/Jarv1s/docs/brand/product-goals-and-ideals.md:170-202`.
Grounded on commit `d894477566cb3dbb88b1cf2efc3926fe3049a1ca`.

---

## 1. Problem

The Today page already knows about evening reviews:

- Settings can enable an evening briefing and set its time.
- The default evening time is `19:00`.
- `TodayPage` fetches the latest evening run and has a `Prep for tomorrow` action.

But the evening review is only a narrow aside card. After the evening review time, the primary Today
surface still reads like a morning/day-execution page: "Start here", "Walking the day", "Today's
agenda", priority stats, and a sidebar widget. The issue screenshot shows the current evening widget
also renders a compressed raw `summaryText` blob, making the most important evening content hard to
read.

This is distinct from:

- #506, which lists real briefing source names in settings.
- #586, which removed source freshness details from the Today evening card.
- #213, which already defines the backend evening review/interview architecture.

This spec only covers the Today page display behavior: when the user reaches their evening briefing
time, Today should become an evening review surface instead of continuing to lead with morning
execution content.

## 2. Decision

Add an explicit Today display mode:

```ts
type TodayMode = "day" | "evening";
```

`TodayMode` is derived from the enabled evening briefing definition and the user's effective local
time. When mode is `"day"`, the current Today layout remains the primary surface. When mode is
`"evening"`, the main column switches to an evening review composition and the existing day-execution
sections move below or become secondary.

The evening review must be primary after the time gate. Do not keep it as only the right-rail widget.

## 3. Time-Gate Rules

Use the evening definition's schedule as the source of truth:

1. If no evening definition exists, or it exists but is disabled, Today remains in `"day"` mode.
2. Read `scheduleMetadata.targetTime` from the evening definition. If absent or malformed, fall back
   to `19:00`.
3. Read `scheduleMetadata.timezone` from the evening definition. If absent or malformed, fall back to
   the user's persisted locale timezone once available to this screen; only then fall back to
   `Intl.DateTimeFormat().resolvedOptions().timeZone`.
4. Convert "now" into that timezone and compare against the local `targetTime`.
5. At or after the target time, switch Today into `"evening"` mode.
6. Before the target time, keep `"day"` mode even if an older evening review run exists.

The gate is user-local/effective-schedule-timezone behavior. A silent UTC fallback is not acceptable
for user-facing evening display.

## 4. Evening Mode UI

When `TodayMode === "evening"`:

### Hero

- Greeting remains time-aware (`Good evening, Ben.`).
- Lede changes from "move today" language to an evening summary:
  - completed count for today
  - open/at-risk count carrying forward
  - tomorrow calendar count if available
- Avoid technical labels such as "scheduled run", "source metadata", or "stale source".

### Primary section

Replace the first main-column card with a full evening review section:

- Kicker: `Evening review`
- Title: `What happened today`
- Show the latest same-day evening run when available.
- Render the review as readable prose, not a single compressed inline blob.
- Keep `BriefingFeedbackMenu` on the run.
- Show `Prep for tomorrow` as the primary action in this section.

If the gate has passed but the run is not available yet:

- Show a calm pending state such as `Your evening review is not ready yet.`
- Keep `Prep for tomorrow` enabled; `startEveningInterview({ briefingRunId: undefined })` already
  supports launching without a run.

### Supporting evening sections

Below the review, show compact sections that match the evening job from the product goals:

- `Accomplished today` — completed tasks for the current local day.
- `Carrying forward` — open at-risk/overdue work and unresolved commitments.
- `Tomorrow` — next-day calendar load and any task due tomorrow when data is available.

These sections should reuse existing task row, calendar row, and drift styling where practical. Do
not add a new data pipeline in this issue.

### Day-mode content

The current `Start here`, `Walking the day`, sports/news, goals, proactive cards, wellness, and agenda
content remains available in day mode. In evening mode, it can remain lower on the page if useful, but
it must not precede the evening review as the primary surface.

## 5. Summary Rendering

Do not use `compactSummary(latestEveningRun.summaryText)` for the primary evening review.

The build should add a small rendering helper for briefing summaries:

- Normalize whitespace and trim empty content.
- Preserve paragraph breaks when the summary contains blank lines.
- Preserve simple bullet lines as separate rows.
- Cap only by layout needs, not by an arbitrary 220-character inline truncation.

The helper should be presentation-only. It must not parse private content into structured data, run AI,
or mutate the briefing run.

## 6. Implementation Slices

### Slice A — Time policy helper

**Files:** `apps/web/src/today/today-page.tsx` or a focused sibling helper under
`apps/web/src/today/`.

- Add a pure helper that derives `TodayMode`.
- Add pure helpers for timezone-local day keys and `HH:MM` comparison if no canonical helper exists
  after the #579 local-timezone sweep lands.
- Keep the helper testable without mounting React.

Acceptance: tests can prove `18:59` stays day mode and `19:00` switches to evening mode for a fixed
timezone.

### Slice B — Evening review main section

**Files:** `apps/web/src/today/today-page.tsx`, optional focused child component.

- Move the existing evening review card logic into a reusable `EveningReviewSection`.
- Render it in the main column when `TodayMode === "evening"`.
- Keep the aside widget out of evening mode to avoid duplicated review content.
- Keep the existing sidebar card in day mode only if it remains useful as a preview/entry point.

Acceptance: after the gate, the first main-column section is the evening review, not `Start here`.

### Slice C — Readable summary helper

**Files:** `apps/web/src/today/` tests and component code.

- Replace `compactSummary()` for the primary evening review.
- Preserve readable paragraphs/bullets.
- Keep the existing compact helper only for genuinely compact contexts, if any remain.

Acceptance: the issue screenshot's class of raw inline summary becomes readable instead of one
truncated paragraph.

### Slice D — Evening support sections

**Files:** `apps/web/src/today/today-page.tsx`, `apps/web/src/today/` child components as needed.

- Add completed-today, carrying-forward, and tomorrow sections using existing task/calendar data.
- Use timezone-local date checks, not ambient browser date checks, once #579's shared helper is
  available.

Acceptance: the evening page helps the user reconcile the day and plan tomorrow without needing to
open Tasks first.

## 7. Definition Of Done

- [ ] Before the evening target time, Today keeps the current day-execution layout.
- [ ] At or after the configured evening target time in the effective user timezone, Today leads with
      the evening review.
- [ ] If an evening run exists for the current local day, its summary renders as readable prose and
      includes feedback controls.
- [ ] If no run exists yet, Today shows a pending evening state and still offers `Prep for tomorrow`.
- [ ] The right rail does not duplicate the main evening review in evening mode.
- [ ] Completed-today, carrying-forward, and tomorrow sections are visible in evening mode when data
      exists, with calm empty states when not.
- [ ] Unit coverage fixes the boundary time (`18:59` vs `19:00`) and same-day run selection in a
      non-UTC timezone.
- [ ] No new backend route, table, migration, or briefing synthesis change is introduced for #511.

## 8. Out Of Scope

- Changing the evening review synthesis prompt or content model (#213 follow-up territory).
- Listing source names or source freshness on Today (#506/#586 territory).
- New notification behavior.
- Background polling changes for briefing runs.
- Persisting evening interview outcomes into the next morning briefing.
- Any AI-generated restructuring of `summaryText` at display time.

## 9. Security And Invariants

- No private content enters job payloads; this is display-only.
- No new access context fields.
- No RLS or repository changes.
- Render briefing text as React text nodes, not `dangerouslySetInnerHTML`.
- Keep paths, docs, and handoff text repo-relative with `~/Jarv1s` in user-facing documentation.
