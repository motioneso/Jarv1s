import type { ProactiveSource } from "@jarv1s/shared";

/** Provider signal types allowed per source in V1. */
const SOURCE_ALLOWLISTS: Record<ProactiveSource, ReadonlySet<string>> = {
  tasks: new Set(["overdue_high_priority", "due_soon_high_priority", "at_risk_focus"]),
  calendar: new Set([
    "event_changed_soon",
    "event_cancelled_soon",
    "prep_needed",
    "dense_schedule"
  ]),
  email: new Set(["needs_reply_soon", "time_sensitive_follow_up", "priority_sender_waiting"]),
  notes: new Set(["decision_changed", "priority_anchor_changed", "open_loop_added"])
};

/** Map provider signal type → #526 PriorityCandidate signalType. */
const SIGNAL_TYPE_MAP: Record<string, string> = {
  overdue_high_priority: "time_sensitive",
  due_soon_high_priority: "time_sensitive",
  at_risk_focus: "time_sensitive",
  event_changed_soon: "time_sensitive",
  event_cancelled_soon: "time_sensitive",
  prep_needed: "prep_needed",
  dense_schedule: "schedule_density_overload",
  needs_reply_soon: "needs_reply",
  time_sensitive_follow_up: "time_sensitive",
  priority_sender_waiting: "needs_reply",
  decision_changed: "planning_impact",
  priority_anchor_changed: "planning_impact",
  open_loop_added: "planning_impact"
};

export function isAllowedSignalType(source: ProactiveSource, signalType: string): boolean {
  return SOURCE_ALLOWLISTS[source]?.has(signalType) ?? false;
}

/** Returns the mapped #526 signalType, or the original if unmapped. */
export function mapSignalType(signalType: string): string {
  return SIGNAL_TYPE_MAP[signalType] ?? signalType;
}
