import { useQuery } from "@tanstack/react-query";
import type { CalendarEventDto } from "@jarv1s/shared";
import { CalendarDays, Clock, Inbox, LoaderCircle, MapPin } from "lucide-react";
import { useMemo, useState } from "react";

import { listCalendarEvents } from "../api/client";
import { queryKeys } from "../api/query-keys";

const calendarFilters = ["upcoming", "past", "all"] as const;

type CalendarFilter = (typeof calendarFilters)[number];

export function CalendarPage() {
  const [filter, setFilter] = useState<CalendarFilter>("upcoming");
  const eventsQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });
  const events = useMemo(() => {
    const now = Date.now();

    return (eventsQuery.data?.events ?? []).filter((event) => {
      if (filter === "all") {
        return true;
      }

      const ended = new Date(event.endsAt).getTime() < now;

      return filter === "past" ? ended : !ended;
    });
  }, [eventsQuery.data?.events, filter]);
  const counts = useMemo(
    () => readCalendarCounts(eventsQuery.data?.events ?? []),
    [eventsQuery.data?.events]
  );

  return (
    <section className="page-stack" aria-labelledby="calendar-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1 id="calendar-title">Calendar</h1>
        </div>
      </div>

      <section className="task-toolbar single" aria-label="Calendar filters">
        <div className="segmented-control wide" aria-label="Event filter">
          {calendarFilters.map((status) => (
            <button
              className={filter === status ? "active" : ""}
              key={status}
              type="button"
              onClick={() => setFilter(status)}
            >
              {status[0]?.toUpperCase()}
              {status.slice(1)}
              <span>{counts[status]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="task-list" aria-live="polite">
        {eventsQuery.isLoading ? (
          <EmptyState loading title="Loading events" />
        ) : eventsQuery.error ? (
          <EmptyState title={eventsQuery.error.message} />
        ) : events.length === 0 ? (
          <EmptyState title="No events" />
        ) : (
          events.map((event) => <CalendarEventRow event={event} key={event.id} />)
        )}
      </section>
    </section>
  );
}

function CalendarEventRow(props: { readonly event: CalendarEventDto }) {
  return (
    <article className="task-row">
      <div className="task-status-icon" aria-hidden="true">
        <CalendarDays size={22} />
      </div>
      <div className="task-row-main">
        <strong>{props.event.title}</strong>
        {props.event.summary ? <p>{props.event.summary}</p> : null}
        {props.event.bodyExcerpt ? <p>{props.event.bodyExcerpt}</p> : null}
        <div className="task-meta">
          <span>
            <Clock size={13} aria-hidden="true" />
            {formatEventRange(props.event.startsAt, props.event.endsAt)}
          </span>
          {props.event.location ? (
            <span>
              <MapPin size={13} aria-hidden="true" />
              {props.event.location}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function EmptyState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <div className="empty-state">
      {props.loading ? (
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      ) : (
        <Inbox size={22} aria-hidden="true" />
      )}
      <p>{props.title}</p>
    </div>
  );
}

function readCalendarCounts(events: readonly CalendarEventDto[]): Record<CalendarFilter, number> {
  const now = Date.now();
  const past = events.filter((event) => new Date(event.endsAt).getTime() < now).length;

  return {
    upcoming: events.length - past,
    past,
    all: events.length
  };
}

function formatEventRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium"
  }).format(start);
  const startTime = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short"
  }).format(start);
  const endTime = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short"
  }).format(end);

  return `${date}, ${startTime} - ${endTime}`;
}
