import { createHash } from "node:crypto";

export interface BriefingFeedbackItem {
  readonly feedbackItemId: string;
  readonly targetKind: "briefing_item";
  readonly surface: "briefing";
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly priorityBand: "critical" | "high" | "normal" | "low" | null;
  readonly metadata: Record<string, unknown>;
}

interface SignalInput {
  readonly type?: unknown;
  readonly summary?: unknown;
  readonly score?: unknown;
  readonly [key: string]: unknown;
}

export function deriveBriefingFeedbackItems(input: {
  readonly calendarSignals?: readonly SignalInput[];
  readonly emailSignals?: readonly SignalInput[];
}): BriefingFeedbackItem[] {
  return [
    ...deriveSignalItems("calendar", "Calendar", input.calendarSignals ?? []),
    ...deriveSignalItems("email", "Email", input.emailSignals ?? [])
  ];
}

function deriveSignalItems(
  sourceKind: string,
  sourceLabel: string,
  signals: readonly SignalInput[]
): BriefingFeedbackItem[] {
  return signals.flatMap((signal) => {
    const signalType = stringValue(signal.type);
    const summary = stringValue(signal.summary);
    if (!signalType || !summary) return [];
    return [
      {
        feedbackItemId: `${sourceKind}:${signalType}:${shortHash([sourceKind, signalType, summary])}`,
        targetKind: "briefing_item" as const,
        surface: "briefing" as const,
        sourceKind,
        sourceLabel,
        priorityBand: priorityBand(signal.score),
        metadata: { signalType }
      }
    ];
  });
}

function shortHash(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.map((part) => part.trim().toLowerCase().replace(/\s+/g, " ")).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function priorityBand(score: unknown): "critical" | "high" | "normal" | "low" | null {
  if (typeof score !== "number") return null;
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "normal";
  return "low";
}
