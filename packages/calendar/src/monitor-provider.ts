import { createHash } from "node:crypto";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type {
  ProactiveMonitorInput,
  ProactiveMonitorProvider,
  ProactiveMonitorResult,
  ProactiveMonitorSignal
} from "@jarv1s/module-sdk";

import { CalendarRepository } from "./repository.js";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Events starting within this window are considered "soon". */
const SOON_HOURS = 24;

export const calendarMonitorProvider: ProactiveMonitorProvider = {
  source: "calendar",
  moduleId: "calendar",

  async collectSignals(
    scopedDb: unknown,
    input: ProactiveMonitorInput
  ): Promise<ProactiveMonitorResult> {
    assertDataContextDb(scopedDb as DataContextDb);
    const db = scopedDb as DataContextDb;
    const repo = new CalendarRepository();
    const now = new Date(input.now);
    const soonCutoff = new Date(now.getTime() + SOON_HOURS * 60 * 60 * 1000);

    const allEvents = await repo.listVisible(db);
    const upcoming = allEvents.filter((e) => {
      const starts = new Date(e.starts_at as unknown as string);
      return starts >= now && starts <= soonCutoff;
    });

    const signals: ProactiveMonitorSignal[] = [];

    // Dense schedule: 3+ events in next 24h
    if (upcoming.length >= 3 && signals.length < input.maxSignals) {
      signals.push({
        source: "calendar",
        stableKey: `dense-schedule:${stableHash(input.now.slice(0, 10))}`,
        sourceRefHash: stableHash(`dense:${upcoming.length}:${input.now.slice(0, 10)}`),
        signalType: "dense_schedule",
        title: "Dense schedule ahead",
        summary: `${upcoming.length} events in the next 24 hours`,
        occurredAt: input.now,
        priorityCandidate: {}
      });
    }

    // Individual events soon
    for (const event of upcoming) {
      if (signals.length >= input.maxSignals) break;
      const starts = new Date(event.starts_at as unknown as string);
      const hoursUntil = (starts.getTime() - now.getTime()) / (60 * 60 * 1000);
      const stableKey = `event-soon:${stableHash(event.external_id ?? event.id)}`;
      const signalType = hoursUntil <= 2 ? "prep_needed" : "event_changed_soon";

      signals.push({
        source: "calendar",
        stableKey,
        sourceRefHash: stableHash(event.external_id ?? event.id),
        signalType,
        title: event.title,
        summary:
          hoursUntil <= 2
            ? `Upcoming in ${Math.round(hoursUntil * 60)} min${event.location ? ` — ${event.location}` : ""}`
            : `Starts ${starts.toLocaleString()}${event.location ? ` — ${event.location}` : ""}`,
        targetAt: starts.toISOString(),
        occurredAt: event.updated_at
          ? new Date(event.updated_at as unknown as string).toISOString()
          : input.now,
        priorityCandidate: {
          startsAt: starts.toISOString()
        }
      });
    }

    return { signals, nextCursor: { checkedAt: input.now } };
  }
};
