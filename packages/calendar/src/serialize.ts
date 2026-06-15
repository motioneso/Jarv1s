import type { CalendarEvent } from "@jarv1s/db";
import type { CalendarEventDto } from "@jarv1s/shared";

const JFB_PATTERN = /^jfb[0-9a-v]{32}$/;

export function serializeCalendarEvent(event: CalendarEvent): CalendarEventDto {
  const md: Record<string, unknown> =
    event.external_metadata != null && typeof event.external_metadata === "object"
      ? (event.external_metadata as Record<string, unknown>)
      : {};

  const isJarvisBlock = JFB_PATTERN.test(event.external_id);
  const allDay = md.allDay === true;
  const attendeeCount =
    typeof md.attendeeCount === "number" && Number.isFinite(md.attendeeCount)
      ? md.attendeeCount
      : 0;
  const status = typeof md.status === "string" ? md.status : null;

  return {
    id: event.id,
    connectorAccountId: event.connector_account_id,
    ownerUserId: event.owner_user_id,
    title: event.title,
    startsAt: toIsoString(event.starts_at),
    endsAt: toIsoString(event.ends_at),
    location: event.location,
    summary: event.summary,
    bodyExcerpt: event.body_excerpt,
    externalId: event.external_id,
    isJarvisBlock,
    allDay,
    attendeeCount,
    status,
    createdAt: toIsoString(event.created_at),
    updatedAt: toIsoString(event.updated_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
