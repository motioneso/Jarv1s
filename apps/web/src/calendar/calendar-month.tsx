import {
  DOW_SHORT,
  MONTH_NAMES,
  buildMonthCells,
  dayKey,
  fmtTime,
  isToday,
  type CalendarViewEvent
} from "./calendar-model.js";

interface CalendarMonthProps {
  readonly cursor: Date;
  readonly eventsByDay: Map<string, CalendarViewEvent[]>;
  readonly onPickDay: (date: Date) => void;
  readonly onPick: (e: CalendarViewEvent) => void;
}

export function CalendarMonth({ cursor, eventsByDay, onPickDay, onPick }: CalendarMonthProps) {
  const cells = buildMonthCells(cursor);
  const curMonth = cursor.getMonth();
  const rowCount = cells.length / 7;

  return (
    <div className="cal-month">
      <div className="cal-month__head">
        {DOW_SHORT.map((d) => (
          <div key={d} className="cal-month__dow">
            {d}
          </div>
        ))}
      </div>
      <div className="cal-month__grid" style={{ gridTemplateRows: `repeat(${rowCount}, 1fr)` }}>
        {cells.map((date) => {
          const out = date.getMonth() !== curMonth;
          const today = isToday(date);
          const key = dayKey(date);
          const evs = (eventsByDay.get(key) ?? [])
            .slice()
            .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.startMin - b.startMin);
          const shown = evs.slice(0, 3);
          const extra = evs.length - 3;

          return (
            <div
              key={key + "-" + date.getDate()}
              className={"cal-mcell" + (out ? " is-out" : "") + (today ? " is-today" : "")}
            >
              <button type="button" className="cal-mcell__date" onClick={() => onPickDay(date)}>
                <span className="n">{date.getDate()}</span>
                {date.getDate() === 1 ? (
                  <span className="mo">{(MONTH_NAMES[date.getMonth()] ?? "").slice(0, 3)}</span>
                ) : null}
              </button>
              <div className="cal-mcell__evs">
                {shown.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={"cal-mchip" + (e.kind === "block" ? " is-block" : "")}
                    style={
                      {
                        "--ev": e.kind === "block" ? "var(--accent)" : "var(--steel)"
                      } as React.CSSProperties
                    }
                    onClick={() => onPick(e)}
                  >
                    <span className="cal-mchip__dot" />
                    {!e.allDay ? (
                      <span className="cal-mchip__t">{fmtTime(e.startMin).replace(":00", "")}</span>
                    ) : null}
                    <span className="cal-mchip__title">{e.title}</span>
                  </button>
                ))}
                {extra > 0 ? (
                  <button type="button" className="cal-mmore" onClick={() => onPickDay(date)}>
                    {extra} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
