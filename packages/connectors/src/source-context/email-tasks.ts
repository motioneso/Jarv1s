import type { DataContextDb } from "@jarv1s/db";
import {
  DEFAULT_EMAIL_TASK_MODE,
  EMAIL_TASK_CREATION_MODES,
  EMAIL_TASK_MODE_PREF_KEY,
  parseEmailTaskMode,
  type EmailTaskCreationMode
} from "@jarv1s/shared";

import type { EmailContextItem } from "./types.js";

// Canonical mode contract lives in @jarv1s/shared (route schemas need it); re-exported here so
// engine consumers (monitors, tests) get everything from one module.
export {
  DEFAULT_EMAIL_TASK_MODE,
  EMAIL_TASK_CREATION_MODES,
  EMAIL_TASK_MODE_PREF_KEY,
  parseEmailTaskMode
};
export type { EmailTaskCreationMode };

/** Bounded like triage summaries — a task description must never carry a full email body. */
const MAX_DESCRIPTION_CHARS = 600;
const CONFIDENCE_FLOOR = 0.4;
const TIME_SENSITIVE_CONFIDENCE_FLOOR = 0.7;
const AUTO_SAFE_TODO_CONFIDENCE = 0.75;
const AUTO_TODO_CONFIDENCE = 0.6;
const REJECTION_SKIP_THRESHOLD = 3;
const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface EmailTaskCreationPort {
  create(
    scopedDb: DataContextDb,
    input: {
      readonly title: string;
      readonly description: string | null;
      readonly status: "suggested" | "todo";
      readonly dueAt: string | null;
      readonly priority: number | null;
      readonly source: "email";
      readonly sourceRef: string;
      readonly externalKey: string;
    }
  ): Promise<{ readonly id: string }>;
}

/**
 * Deterministic dedupe key for an email-derived task: same account + message + action title
 * always maps to the same key, so re-running the monitor can never duplicate a task
 * (tasks.create dedupes on (source, external_key)).
 */
export function emailTaskExternalKey(
  connectorAccountId: string,
  messageKey: string,
  actionTitle: string
): string {
  const normalized = actionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${connectorAccountId}:${messageKey}:${normalized}`;
}

/**
 * email_messages is unique on (connector_account_id, external_id), never on external_id alone —
 * two different connector accounts can legitimately share the same provider message id. A
 * task's source_ref must therefore carry BOTH, not the bare external id, so triage-feedback
 * lookup (EmailRepository.getByConnectorAccountAndExternalId) resolves the correct account.
 */
export function emailSourceRef(connectorAccountId: string, externalId: string): string {
  return `${connectorAccountId}:${externalId}`;
}

export function parseEmailSourceRef(
  sourceRef: string
): { connectorAccountId: string; externalId: string } | null {
  const separatorIndex = sourceRef.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === sourceRef.length - 1) return null;
  return {
    connectorAccountId: sourceRef.slice(0, separatorIndex),
    externalId: sourceRef.slice(separatorIndex + 1)
  };
}

export interface PlanEmailTasksInput {
  readonly items: readonly EmailContextItem[];
  readonly mode: EmailTaskCreationMode;
  readonly rejectionAggregates: readonly {
    senderDomain: string;
    rejected: number;
    accepted: number;
  }[];
  /** Injected clock (ISO) — keeps the planner pure and the due-soon priority testable. */
  readonly now: string;
}

export interface PlannedEmailTask {
  readonly status: "suggested" | "todo";
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string | null;
  readonly priority: number | null;
  readonly sourceRef: string;
  readonly externalKey: string;
  readonly item: EmailContextItem;
}

/**
 * Pure planning pass from triaged email items to task candidates (#729 §5). Only explicit
 * field-picks from the item reach the output — snippets/summaries stay bounded upstream and
 * the description is re-capped here, so a full body can never ride along into a task.
 */
export function planEmailTasks(input: PlanEmailTasksInput): PlannedEmailTask[] {
  if (input.mode === "off") return [];

  const nowMs = Date.parse(input.now);
  const planned: PlannedEmailTask[] = [];

  for (const item of input.items) {
    if (!isCandidateActionability(item)) continue;
    if (item.suggestedTasks.length === 0 && item.dueDate === null) continue;

    const confidence = effectiveConfidence(item, input.rejectionAggregates);
    if (confidence === null || confidence < CONFIDENCE_FLOOR) continue;

    const candidates =
      item.suggestedTasks.length > 0
        ? item.suggestedTasks
        : [{ title: item.subject, dueDate: null }];

    for (const candidate of candidates) {
      const dueAt = candidate.dueDate ?? item.dueDate;
      planned.push({
        status: statusFor(input.mode, item, confidence),
        title: candidate.title,
        description: boundedDescription(item),
        dueAt,
        priority: priorityFor(item, dueAt, nowMs),
        sourceRef: emailSourceRef(item.account.connectorAccountId, item.messageKey),
        externalKey: emailTaskExternalKey(
          item.account.connectorAccountId,
          item.messageKey,
          candidate.title
        ),
        item
      });
    }
  }

  return planned;
}

function isCandidateActionability(item: EmailContextItem): boolean {
  if (item.actionability === "needs_action" || item.actionability === "needs_reply") return true;
  return (
    item.actionability === "time_sensitive_info" &&
    item.confidence >= TIME_SENSITIVE_CONFIDENCE_FLOOR
  );
}

/**
 * Accept/reject learning (#729 §6): a domain the user rejected ≥3 times with zero accepts is
 * skipped outright (returns null); with some accepts its confidence is halved so it must clear
 * the floor and status thresholds on merit.
 */
function effectiveConfidence(
  item: EmailContextItem,
  aggregates: PlanEmailTasksInput["rejectionAggregates"]
): number | null {
  const domain = item.sender.split("@").pop()?.toLowerCase() ?? "";
  const aggregate = aggregates.find((entry) => entry.senderDomain === domain);
  if (!aggregate || aggregate.rejected < REJECTION_SKIP_THRESHOLD) return item.confidence;
  if (aggregate.accepted === 0) return null;
  return item.confidence / 2;
}

function statusFor(
  mode: EmailTaskCreationMode,
  item: EmailContextItem,
  confidence: number
): "suggested" | "todo" {
  // A reply is a judgment call — no auto mode may promote it past review.
  if (item.actionability === "needs_reply") return "suggested";
  if (mode === "auto_safe") {
    return item.actionability === "needs_action" &&
      item.dueDate !== null &&
      confidence >= AUTO_SAFE_TODO_CONFIDENCE
      ? "todo"
      : "suggested";
  }
  if (mode === "auto") {
    return confidence >= AUTO_TODO_CONFIDENCE ? "todo" : "suggested";
  }
  return "suggested";
}

function priorityFor(item: EmailContextItem, dueAt: string | null, nowMs: number): number {
  if (item.importance === "high") return 2;
  if (dueAt !== null && Number.isFinite(nowMs)) {
    const dueMs = Date.parse(dueAt);
    if (Number.isFinite(dueMs) && dueMs - nowMs <= DUE_SOON_WINDOW_MS) return 2;
  }
  return 3;
}

function boundedDescription(item: EmailContextItem): string | null {
  const text = item.reason ?? item.summary;
  return text === null ? null : text.slice(0, MAX_DESCRIPTION_CHARS);
}
