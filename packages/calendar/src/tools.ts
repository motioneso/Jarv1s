import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./routes.js";

const repository = new CalendarRepository();

export const calendarListVisibleEventsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const events = await repository.listVisible(scopedDb);
  return { data: { events: events.map(serializeCalendarEvent) } };
};
