import { assertDataContextDb } from "@jarv1s/db";
import type { ToolContext, ToolExecute, ToolResult, ToolServices } from "@jarv1s/module-sdk";

import type { CalendarWriteService } from "./calendar-write-service.js";
import { resolveWindow, type FocusBlockInput, type PartOfDay } from "./focus-time.js";
import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./serialize.js";

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
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const startsAfter =
    typeof input.startsAfter === "string" ? new Date(input.startsAfter) : undefined;
  const startsBefore =
    typeof input.startsBefore === "string" ? new Date(input.startsBefore) : undefined;
  const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : undefined;
  const events = await repository.listVisible(scopedDb, { startsAfter, startsBefore, limit });
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

/**
 * Freezes a RELATIVE proposal (no `date`, no `start`) to an absolute calendar date IN PLACE on the
 * shared input object, the first time it is called. resolveWindow derives "tomorrow" from the
 * supplied clock, so the approval card (summarize, at card-creation) and the execution (execute,
 * AFTER the user approves) would otherwise each compute "tomorrow" from their OWN clock — if the
 * card is shown before local midnight and approved after, the inserted day, the card text, and the
 * deterministic Google id all diverge (the user approves day X, the calendar gets day Y; and the
 * idempotency id changes for the same user-visible proposal). Codex HIGH round 4.
 *
 * The gateway passes the SAME input object reference to summarize and then to execute within one
 * confirmAndRun call (gateway.ts confirmAndRun: summaryFor(input) then runHandler(...,input)). So
 * summarize stamping `input.date` here freezes the proposal at card-creation time; execute reads
 * the same frozen `input.date` after the approval gap. Idempotent: if `date`/`start` is already
 * present (explicit input, or a prior freeze), this is a no-op. Only the day is frozen; the live
 * freeBusy slot choice still runs fresh at execute time (that is the point of conflict-checking).
 */
export function freezeRelativeDate(input: Record<string, unknown>, now: Date, tz: string): void {
  if (typeof input.date === "string" || typeof input.start === "string") {
    return; // already absolute (explicit or previously frozen)
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  // "tomorrow" in tz: take today's local yyyy-mm-dd and add one day via a UTC-noon anchor (noon
  // avoids any DST edge flipping the calendar day).
  const todayLocal = fmt.format(now); // yyyy-mm-dd
  const [y, m, d] = todayLocal.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1, 12));
  input.date = tomorrow.toISOString().slice(0, 10);
}

export const calendarProposeFocusBlockExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  const service = narrowCalendarWrite(services);
  // Freeze a relative "tomorrow" if not already frozen by summarize — keeps the executed day in
  // lockstep with the approval card across the midnight boundary (Codex HIGH round 4).
  freezeRelativeDate(input, new Date(), DEFAULT_TIMEZONE);
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
  // Stamp the absolute "tomorrow" onto the shared input at card-creation time so execute (which
  // receives the same input object after the approval gap) inserts exactly the day the card shows,
  // and the deterministic Google id stays stable for this proposal (Codex HIGH round 4).
  freezeRelativeDate(input, new Date(), DEFAULT_TIMEZONE);
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
