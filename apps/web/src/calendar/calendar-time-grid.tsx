import { useEffect, useRef } from "react";
import { GitCommitHorizontal } from "lucide-react";

import {
  DOW_SHORT,
  fmtHour,
  fmtTime,
  isToday,
  nowMin,
  packDay,
  type CalendarViewEvent
} from "./calendar-model.js";

export interface DayData {
  readonly date: Date;
  readonly events: CalendarViewEvent[];
}

interface EventBlockProps {
  readonly e: CalendarViewEvent;
  readonly hourH: number;
  readonly dense: boolean;
  readonly onPick: (e: CalendarViewEvent) => void;
}

function EventBlock({ e, hourH, dense, onPick }: EventBlockProps) {
  const ppm = hourH / 60;
  const top = e.startMin * ppm;
  const height = Math.max((e.endMin - e.startMin) * ppm, 22);
  const cols = e._cols || 1;
  const col = e._col || 0;
  const w = 100 / cols;
  const left = col * w;
  const isBlock = e.kind === "block";
  const showTime = height >= 34;
  const showWhere = height >= 58 && !dense && e.where;
  const cls = "cal-ev" + (isBlock ? " cal-ev--block cal-ev--ghost" : " cal-ev--hard");

  return (
    <button
      type="button"
      className={cls}
      onClick={() => onPick(e)}
      style={
        {
          top,
          height,
          left: `calc(${left}% + 2px)`,
          width: `calc(${w}% - 4px)`,
          "--ev": isBlock ? "var(--accent)" : "var(--steel)"
        } as React.CSSProperties
      }
    >
      <span className="cal-ev__bar" />
      <span className="cal-ev__body">
        <span className="cal-ev__title">
          {isBlock ? (
            <span className="cal-ev__hold">
              <GitCommitHorizontal size={11} />
            </span>
          ) : null}
          {e.title}
        </span>
        {showTime ? <span className="cal-ev__meta">{fmtTime(e.startMin)}</span> : null}
        {showWhere ? <span className="cal-ev__where">{e.where}</span> : null}
      </span>
    </button>
  );
}

interface TimeGridProps {
  readonly days: DayData[];
  readonly hourH: number;
  readonly onPick: (e: CalendarViewEvent) => void;
}

export function CalendarTimeGrid({ days, hourH, onPick }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * hourH - 6;
    }
  }, [hourH]);

  const tmpl = `60px repeat(${days.length}, minmax(0, 1fr))`;
  const anyAllDay = days.some((d) => d.events.some((e) => e.allDay));
  const todayNowMin = nowMin();

  return (
    <div className="cal-tg" style={{ "--cal-h": hourH + "px" } as React.CSSProperties}>
      <div className="cal-tg__head" style={{ gridTemplateColumns: tmpl }}>
        <div className="cal-tg__corner" />
        {days.map((d) => (
          <div
            key={d.date.toISOString()}
            className={"cal-tg__dayhd" + (isToday(d.date) ? " is-today" : "")}
          >
            <span className="cal-tg__dow">{DOW_SHORT[d.date.getDay()]}</span>
            <span className="cal-tg__dnum">{d.date.getDate()}</span>
          </div>
        ))}
      </div>

      {anyAllDay ? (
        <div className="cal-tg__allday" style={{ gridTemplateColumns: tmpl }}>
          <div className="cal-tg__allday-lbl">all-day</div>
          {days.map((d) => (
            <div key={d.date.toISOString()} className="cal-tg__allday-cell">
              {d.events
                .filter((e) => e.allDay)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="cal-allchip"
                    style={
                      {
                        "--ev": e.kind === "block" ? "var(--accent)" : "var(--steel)"
                      } as React.CSSProperties
                    }
                    onClick={() => onPick(e)}
                  >
                    <span className="cal-allchip__dot" />
                    {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="cal-tg__scroll" ref={scrollRef}>
        <div className="cal-tg__body" style={{ gridTemplateColumns: tmpl, height: 24 * hourH }}>
          <div className="cal-tg__gutter">
            {Array.from({ length: 24 }, (_, h) =>
              h === 0 ? null : (
                <span key={h} className="cal-tg__hr" style={{ top: h * hourH }}>
                  {fmtHour(h)}
                </span>
              )
            )}
          </div>
          {days.map((d) => {
            const packed = packDay([...d.events]);
            const todayCol = isToday(d.date);
            return (
              <div
                key={d.date.toISOString()}
                className={"cal-tg__col" + (todayCol ? " is-today" : "")}
              >
                {packed.map((e) => (
                  <EventBlock
                    key={e.id}
                    e={e}
                    hourH={hourH}
                    dense={days.length > 3}
                    onPick={onPick}
                  />
                ))}
                {todayCol ? (
                  <div className="cal-now" style={{ top: todayNowMin * (hourH / 60) }}>
                    <span className="cal-now__dot" />
                    <span className="cal-now__line" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
