# Calendar Design Port — Relay Handoff

**Date:** 2026-06-15  
**Branch:** `calendar-design-port`  
**Worktree:** `~/Jarv1s/.claude/worktrees/calendar-design-port`  
**Spec:** `docs/superpowers/specs/2026-06-15-p3-calendar-design-port.md`  
**Plan:** `docs/superpowers/plans/2026-06-15-calendar-design-port.md`  
**GitHub issue:** #257 (Part of epic #48)  
**Coordinator label:** `Calendar-Coordinator` (session `ce5f47e1-1678-4b3a-bf47-91c74db1020c`)  
**Relay threshold:** ~80–100k tokens OR compaction summary

---

## DONE (all green, committed)

| Commit    | Task                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c142a92` | T1: Updated `packages/shared/src/calendar-api.ts` — drop `externalMetadata`, add `isJarvisBlock/allDay/attendeeCount/status`                                          |
| `6c8b9e4` | T2: Created `packages/calendar/src/serialize.ts` (egress allowlist, exact `/^jfb[0-9a-v]{32}$/` regex, type-narrowing); updated `routes.ts` + `tools.ts` + `index.ts` |
| `9d7a8db` | T3: Removed `createCachedEventForTest` from repo; added `insertCalendarEventForTest` helper to test + 6 new egress integration tests; all 18 tests pass               |
| `8303ea8` | T4: Updated both e2e mock factories (`tests/e2e/mock-api.ts`, `tests/e2e/mock-calendar-email-api.ts`) — typecheck fully green                                         |
| `579bd55` | T5: Created `apps/web/src/calendar/calendar-model.ts` (date helpers, DTO→view, packDay)                                                                               |
| `764f5c5` | T6: Created `apps/web/src/calendar/calendar-time-grid.tsx` (Day/Week time grid, EventBlock, now-line)                                                                 |
| `1b5d52d` | T7: Created `apps/web/src/calendar/calendar-month.tsx` (5/6-week month grid)                                                                                          |

---

## REMAINING

### T8: Create `apps/web/src/calendar/calendar-peek.tsx`

Right-flyout detail peek panel. Lucide icons: `CalendarCheck`, `GitCommitHorizontal`, `X`, `Clock`, `MapPin`, `Users`, `Sparkles`.

```tsx
import {
  CalendarCheck,
  Clock,
  GitCommitHorizontal,
  MapPin,
  Sparkles,
  Users,
  X
} from "lucide-react";
import { fmtDateLabel, fmtDur, fmtTime, type CalendarViewEvent } from "./calendar-model.js";

interface CalendarPeekProps {
  readonly event: CalendarViewEvent | null;
  readonly onClose: () => void;
}

export function CalendarPeek({ event, onClose }: CalendarPeekProps) {
  if (!event) return null;
  const isBlock = event.kind === "block";
  const evColor = isBlock ? "var(--accent)" : "var(--steel)";

  return (
    <>
      <div className="cal-peek-scrim" onClick={onClose} />
      <aside className="cal-peek" role="dialog" aria-label="Event details">
        <div className="cal-peek__head">
          {isBlock ? (
            <span className="cal-peek__kind cal-peek__kind--block">
              <GitCommitHorizontal size={13} />
              Jarvis is holding this
            </span>
          ) : (
            <span className="cal-peek__kind">
              <CalendarCheck size={13} />
              On your calendar
            </span>
          )}
          <button type="button" className="cal-peek__x" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="cal-peek__titlewrap">
          <span className="cal-peek__mark" style={{ "--ev": evColor } as React.CSSProperties}>
            {isBlock ? <GitCommitHorizontal size={18} /> : <CalendarCheck size={18} />}
          </span>
          <h3 className="cal-peek__title">{event.title}</h3>
        </div>
        <div className="cal-peek__rows">
          <div className="cal-peek__row">
            <span className="ic">
              <Clock size={15} />
            </span>
            <div>
              <div className="cal-peek__rowmain">
                {event.allDay ? "All day" : fmtTime(event.startMin) + " – " + fmtTime(event.endMin)}
                {!event.allDay ? (
                  <span className="cal-peek__dur"> · {fmtDur(event.endMin - event.startMin)}</span>
                ) : null}
              </div>
              <div className="cal-peek__rowsub">{fmtDateLabel(event.date)}</div>
            </div>
          </div>
          {event.where ? (
            <div className="cal-peek__row">
              <span className="ic">
                <MapPin size={15} />
              </span>
              <div className="cal-peek__rowmain">{event.where}</div>
            </div>
          ) : null}
          {event.attendeeCount > 0 ? (
            <div className="cal-peek__row">
              <span className="ic">
                <Users size={15} />
              </span>
              <div className="cal-peek__rowmain">
                {event.attendeeCount} {event.attendeeCount === 1 ? "person" : "people"}
              </div>
            </div>
          ) : null}
          <div className="cal-peek__row">
            <span className="ic" style={{ paddingTop: 2 }}>
              <span className="cal-peek__catdot" style={{ background: evColor }} />
            </span>
            <div className="cal-peek__rowmain">{isBlock ? "Jarvis focus block" : "Committed"}</div>
          </div>
        </div>
        {isBlock ? (
          <div className="cal-peek__held">
            <Sparkles size={14} />
            <span>
              Jarvis can move or shorten this block when your day changes. Hard events always come
              first.
            </span>
          </div>
        ) : null}
      </aside>
    </>
  );
}
```

### T9: Replace `apps/web/src/calendar/calendar-page.tsx` + clear `calendar.css`

Full replacement — Day/Week/Month switching, toolbar (Today btn + prev/next nav + range label), legend, persisted state. Wire to existing `listCalendarEvents()` / `queryKeys.calendar.list`.

Key patterns from codebase:

- Buttons: `jds-btn jds-btn--secondary jds-btn--sm` (Today), `jds-iconbtn jds-iconbtn--sm` (ChevronLeft/Right)
- Segmented control: `<div className="segmented-control"><button className="active">...</button></div>`
- `HOUR_H = 58` (Comfortable density, fixed for this slice)

```tsx
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Inbox, LoaderCircle } from "lucide-react";
import { listCalendarEvents } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";
import "../styles/kit-calendar.css";
import {
  buildWeekDays,
  dtoToViewEvent,
  groupEventsByDay,
  isToday,
  loadPersistedCursor,
  loadPersistedView,
  loadPersistedWorkWeek,
  navigateCursor,
  rangeLabel,
  DOW_SHORT,
  type CalendarView,
  type CalendarViewEvent
} from "./calendar-model.js";
import { CalendarTimeGrid, type DayData } from "./calendar-time-grid.js";
import { CalendarMonth } from "./calendar-month.js";
import { CalendarPeek } from "./calendar-peek.js";

const HOUR_H = 58;

export function CalendarPage() {
  const [view, setView] = useState<CalendarView>(loadPersistedView);
  const [cursor, setCursor] = useState<Date>(loadPersistedCursor);
  const [workWeek, setWorkWeek] = useState<boolean>(loadPersistedWorkWeek);
  const [peek, setPeek] = useState<CalendarViewEvent | null>(null);

  useEffect(() => {
    localStorage.setItem("jarvis.cal.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("jarvis.cal.cursor", cursor.toISOString());
  }, [cursor]);
  useEffect(() => {
    localStorage.setItem("jarvis.cal.workweek", workWeek ? "1" : "0");
  }, [workWeek]);

  const calendarQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });

  const allViewEvents = useMemo(
    () =>
      (calendarQuery.data?.events ?? [])
        .map(dtoToViewEvent)
        .filter((e): e is CalendarViewEvent => e !== null),
    [calendarQuery.data]
  );

  const eventsByDay = useMemo(() => groupEventsByDay(allViewEvents), [allViewEvents]);

  const weekDays = useMemo(
    () => (view === "week" ? buildWeekDays(cursor, workWeek) : []),
    [view, cursor, workWeek]
  );

  const dayObjs: DayData[] = useMemo(() => {
    const activeDays = view === "day" ? [cursor] : view === "week" ? weekDays : [];
    return activeDays.map((d) => ({
      date: d,
      events: eventsByDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? []
    }));
  }, [view, cursor, weekDays, eventsByDay]);

  const label = rangeLabel(cursor, view, view === "week" ? weekDays : [cursor]);

  const heldToday = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    return (eventsByDay.get(key) ?? []).filter((e) => e.kind === "block").length;
  }, [eventsByDay]);

  function go(dir: -1 | 1) {
    setCursor((c) => navigateCursor(c, view, dir));
  }
  function pickDay(date: Date) {
    setCursor(date);
    setView("day");
  }

  if (calendarQuery.isLoading)
    return (
      <div className="empty-state">
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <p>Loading calendar</p>
      </div>
    );
  if (calendarQuery.error)
    return (
      <div className="empty-state">
        <Inbox size={22} aria-hidden="true" />
        <p>{calendarQuery.error.message}</p>
      </div>
    );

  return (
    <div className="cal-wrap" style={{ "--cal-h": HOUR_H + "px" } as React.CSSProperties}>
      <div className="cal-toolbar">
        <div className="cal-toolbar__left">
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => setCursor(new Date())}
          >
            Today
          </button>
          <div className="cal-nav">
            <button
              type="button"
              className="jds-iconbtn jds-iconbtn--sm"
              aria-label="Previous"
              onClick={() => go(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="jds-iconbtn jds-iconbtn--sm"
              aria-label="Next"
              onClick={() => go(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <h2 className="cal-range">
            {view === "day" ? (
              <>
                <span className="cal-range__dow">{DOW_SHORT[cursor.getDay()]}</span>
                {label.replace(/^\S+,?\s*/, "")}
              </>
            ) : (
              label
            )}
          </h2>
        </div>
        <div className="cal-toolbar__right">
          {view === "week" ? (
            <div className="segmented-control" aria-label="Week type">
              <button
                type="button"
                className={workWeek ? "active" : ""}
                onClick={() => setWorkWeek(true)}
              >
                Work week
              </button>
              <button
                type="button"
                className={!workWeek ? "active" : ""}
                onClick={() => setWorkWeek(false)}
              >
                Full week
              </button>
            </div>
          ) : null}
          <div className="segmented-control" aria-label="View">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {view !== "month" ? (
        <div className="cal-legend">
          <span className="cal-legend__item">
            <span className="cal-legend__sw cal-legend__sw--hard" />
            Committed
          </span>
          <span className="cal-legend__item">
            <span className="cal-legend__sw cal-legend__sw--hold" />
            Jarvis holding
          </span>
          {view === "day" && isToday(cursor) && heldToday > 0 ? (
            <span className="cal-legend__note">
              Jarvis is holding {heldToday} block{heldToday === 1 ? "" : "s"} around what matters
              today.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="cal-body">
        {view === "month" ? (
          <CalendarMonth
            cursor={cursor}
            eventsByDay={eventsByDay}
            onPickDay={pickDay}
            onPick={setPeek}
          />
        ) : (
          <CalendarTimeGrid days={dayObjs} hourH={HOUR_H} onPick={setPeek} />
        )}
      </div>
      <CalendarPeek event={peek} onClose={() => setPeek(null)} />
    </div>
  );
}
```

Also clear `apps/web/src/calendar/calendar.css` (old feed styles dead):

```css
/* Calendar page — layout handled by kit-calendar.css (cal-* classes). */
```

### T10: Full gate

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test:calendar-email
pnpm check:file-size
pnpm verify:foundation
pnpm audit:release-hardening
git fetch origin main && git rebase origin/main
```

Then invoke `coordinated-wrap-up` to open PR and report to coordinator.

---

## Critical context for successor

- **No migration** this slice (high-water mark `0087`). Do NOT add one.
- **stage only your own paths** — no `git add -A` (shared tree).
- **Never touch `docs/coordination/`** — coordinator only.
- **Pre-push trio + rebase** before every push.
- **Coordinator label:** `Calendar-Coordinator` (Herdr session `ce5f47e1-1678-4b3a-bf47-91c74db1020c`). Escalate done/blocker/[SECURITY] to it.
- **Relay** at ~80–100k tokens or compaction summary.
- All backend security work is done. T8/T9/T10 are pure frontend + gate.
- Typecheck currently clean (0 errors). Keep it that way.
