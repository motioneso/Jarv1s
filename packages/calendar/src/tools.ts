import { assertDataContextDb } from "@jarv1s/db";
import type { ToolContext, ToolExecute, ToolResult, ToolServices } from "@jarv1s/module-sdk";

import type { CalendarWriteService } from "./calendar-write-service.js";
import { resolveWindow, type FocusBlockInput, type PartOfDay } from "./focus-time.js";
import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./routes.js";

const repository = new CalendarRepository();

// Configured default timezone for part-of-day band resolution + the card preview. This is
// the single source of truth for "morning/afternoon/evening" — the impl does NOT make a
// Google calendarList.get call to discover the primary-calendar tz (out of scope this slice;
// see Codex HIGH #4 / spec Open risk #1). resolveWindow maps the band to a concrete UTC
// instant using THIS tz; the inserted event carries explicit UTC start/end (RFC3339 with a
// 'Z' offset), so the instant is unambiguous regardless of the user's calendar tz. A future
// slice may fetch the real calendar tz; this slice accepts the configured default and the
// card text is only the REQUESTED-window preview.
const DEFAULT_TIMEZONE = process.env.JARVIS_DEFAULT_TZ ?? "America/New_York";

export const calendarListVisibleEventsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const events = await repository.listVisible(scopedDb);
  return { data: { events: events.map(serializeCalendarEvent) } };
};

function narrowCalendarWrite(services: ToolServices | undefined): CalendarWriteService {
  const svc = (services ?? {}).calendarWrite as CalendarWriteService | undefined;
  if (!svc || typeof svc.proposeAndInsert !== "function") {
    throw new Error("calendarWrite service is not available");
  }
  return svc;
}

function readInput(input: Record<string, unknown>): FocusBlockInput {
  return {
    date: typeof input.date === "string" ? input.date : undefined,
    partOfDay: input.partOfDay as PartOfDay | undefined,
    start: typeof input.start === "string" ? input.start : undefined,
    durationMinutes: typeof input.durationMinutes === "number" ? input.durationMinutes : undefined,
    title: typeof input.title === "string" ? input.title : undefined
  };
}

export const calendarProposeFocusBlockExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  const service = narrowCalendarWrite(services);
  const resolved = resolveWindow(readInput(input), new Date(), DEFAULT_TIMEZONE);
  const result = await service.proposeAndInsert(scopedDb, ctx, {
    start: resolved.start,
    end: resolved.end,
    durationMinutes: resolved.durationMinutes, // REQUESTED block length, not the band width
    title: resolved.title
  });
  return { data: { ...result } };
};

export const summarizeProposeFocusBlock = (
  input: Record<string, unknown>,
  _ctx: ToolContext
): string => {
  const resolved = resolveWindow(readInput(input), new Date(), DEFAULT_TIMEZONE);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const startStr = fmt.format(resolved.start);
  const endStr = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(resolved.end);
  return `Block "${resolved.title}" ${startStr}–${endStr} on your primary calendar (or the next clear slot if that window is busy).`;
};
