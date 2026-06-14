import { useQuery } from "@tanstack/react-query";
import type { CalendarEventDto } from "@jarv1s/shared";
import { CalendarDays, Clock, Inbox, LoaderCircle, MapPin } from "lucide-react";
import { useMemo } from "react";

import { listCalendarEvents } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { Card, SectionHeader, Stack } from "../ui/card";
import "../styles/kit-calendar.css";

import "./calendar.css";

interface CalendarDayGroup {
  readonly key: string;
  readonly label: string;
  readonly events: readonly CalendarEventDto[];
}

export function CalendarPage() {
  const calendarQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });

  const dayGroups = useMemo(
    () => groupEventsByDay(calendarQuery.data?.events ?? []),
    [calendarQuery.data?.events]
  );

  const eventCount = calendarQuery.data?.events.length ?? 0;

  return (
    <section className="page-stack" aria-labelledby="calendar-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1 id="calendar-title">Calendar</h1>
        </div>
      </div>

      <section className="calendar-feed" aria-live="polite">
        {calendarQuery.isLoading ? (
          <EmptyState loading title="Loading calendar" />
        ) : calendarQuery.error ? (
          <EmptyState title={calendarQuery.error.message} />
        ) : eventCount === 0 ? (
          <EmptyState title="No upcoming events" />
        ) : (
          dayGroups.map((group) => (
            <Card className="calendar-day" key={group.key}>
              <Stack gap={0.75}>
                <SectionHeader
                  eyebrow="Day"
                  title={group.label}
                  trailing={
                    <span className="calendar-day-count">
                      {group.events.length} {group.events.length === 1 ? "event" : "events"}
                    </span>
                  }
                />
                <Stack gap={0.5}>
                  {group.events.map((event) => (
                    <CalendarEventRow event={event} key={event.id} />
                  ))}
                </Stack>
              </Stack>
            </Card>
          ))
        )}
      </section>
    </section>
  );
}

function CalendarEventRow(props: { readonly event: CalendarEventDto }) {
  const { event } = props;

  return (
    <article className="calendar-event">
      <div className="calendar-event-icon" aria-hidden="true">
        <CalendarDays size={20} />
      </div>
      <div className="calendar-event-main">
        <strong className="calendar-event-title">{event.title}</strong>
        <div className="calendar-event-meta">
          <span className="calendar-event-time">
            <Clock size={14} aria-hidden="true" />
            {formatEventTimeRange(event.startsAt, event.endsAt)}
          </span>
          {event.location ? (
            <span className="calendar-event-location">
              <MapPin size={14} aria-hidden="true" />
              {event.location}
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

function groupEventsByDay(events: readonly CalendarEventDto[]): readonly CalendarDayGroup[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  const groups = new Map<string, CalendarEventDto[]>();
  for (const event of sorted) {
    const key = dayKey(event.startsAt);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  return [...groups.entries()].map(([key, dayEvents]) => ({
    key,
    label: formatDayLabel(dayEvents[0]!.startsAt),
    events: dayEvents
  }));
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
}

function formatEventTimeRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) {
    return "All day";
  }

  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  const startLabel = timeFormat.format(start);
  if (Number.isNaN(end.getTime())) {
    return startLabel;
  }

  return `${startLabel} – ${timeFormat.format(end)}`;
}
