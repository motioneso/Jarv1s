import type { CalendarEventDto, TaskDto } from "@jarv1s/shared";

import { isAtRisk, isDoFirst } from "../tasks/focus";

/**
 * Empty-state "seed" prompts for the chat drawer. These must be *honest*: a seed
 * may only reference something that actually exists. We never hardcode a concrete
 * detail (e.g. "Move my 3:30") unless the underlying data is present — otherwise we
 * fall back to data-independent generics that are always answerable.
 *
 * Derived client-side from the already-cached tasks + calendar queries; no extra
 * round-trip. (LLM-generated suggestions are a possible later enhancement — see #218.)
 */
export function buildChatSeeds(
  tasks: readonly TaskDto[],
  events: readonly CalendarEventDto[]
): string[] {
  const open = tasks.filter((t) => t.parentTaskId === null && t.status === "todo");
  const hasPriorities = open.some(isDoFirst);
  const hasAtRisk = open.some(isAtRisk);
  const nextEvent = nextUpcomingToday(events);

  const seeds: string[] = [];

  // Data-specific (gated on a real upcoming event): names a concrete time, so it
  // only appears when that time genuinely exists on the calendar.
  if (nextEvent) {
    seeds.push(`Move my ${eventTime(nextEvent)} to tomorrow`);
  }

  // Safe generics — always answerable regardless of data.
  if (hasPriorities) {
    seeds.push("What should I focus on today?");
  }
  if (hasAtRisk) {
    seeds.push("What's slipping that I should deal with?");
  }
  seeds.push("What did I tell you I wanted to do this week?");

  // Guarantee at least two starters even on an empty account.
  if (seeds.length < 2) {
    seeds.push("What should I focus on today?");
  }

  return dedupe(seeds).slice(0, 3);
}

function nextUpcomingToday(events: readonly CalendarEventDto[]): CalendarEventDto | null {
  const now = Date.now();
  const upcoming = events
    .filter((e) => isToday(e.startsAt) && new Date(e.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return upcoming[0] ?? null;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const ref = new Date();
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function eventTime(event: CalendarEventDto): string {
  const d = new Date(event.startsAt);
  const hour12 = ((d.getHours() + 11) % 12) + 1;
  const minutes = d.getMinutes();
  const suffix = d.getHours() < 12 ? "am" : "pm";
  return minutes === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
