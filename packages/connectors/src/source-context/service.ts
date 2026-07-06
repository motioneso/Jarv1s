import type { CalendarSourceContextDeps } from "./calendar.js";
import type { EmailSourceContextDeps } from "./email.js";
import { listCalendarContext } from "./calendar.js";
import { listEmailContext } from "./email.js";
import type { SourceContextService } from "./types.js";

export interface SourceContextServiceDeps
  extends EmailSourceContextDeps, CalendarSourceContextDeps {}

export function buildSourceContextService(deps: SourceContextServiceDeps): SourceContextService {
  return {
    listEmailContext: (scopedDb, input) => listEmailContext(scopedDb, deps, input),
    listCalendarContext: (scopedDb, input) => listCalendarContext(scopedDb, deps, input)
  };
}
