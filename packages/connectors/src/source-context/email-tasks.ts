import { createHash } from "node:crypto";

import type { DataContextDb } from "@jarv1s/db";
import {
  DEFAULT_EMAIL_TASK_MODE,
  EMAIL_TASK_CREATION_MODES,
  EMAIL_TASK_MODE_PREF_KEY,
  type TaskSuggestionMetadataV1,
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
const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;
const DEFAULT_EMAIL_TASK_DESCRIPTION = "This email may need your attention.";

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
      readonly suggestionMetadata?: TaskSuggestionMetadataV1;
    }
  ): Promise<{ readonly id: string }>;
}

export interface EmailActionSuppressionState {
  readonly subjectSignature: string;
  readonly dismissalCount: number;
  readonly lastDeadlineEvidenceKey: string | null;
  readonly lastContextMessageKey: string | null;
}

export type EmailActionResurfaceReason = "due_tomorrow" | "relevant_context";

/** Same normalization/hash contract as memory signatures, kept local to connectors. */
export function createEmailActionSubjectSignature(inferredSubject: string): string {
  const normalized = inferredSubject.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`email-action-subject::${normalized}`).digest("hex");
}

/** Resurfacing is evidence for one cached message, never every message sharing a subject. */
export function emailActionResurfaceKey(subjectSignature: string, messageKey: string): string {
  return `${subjectSignature}:${messageKey}`;
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
  /** Retained for callers compiled against the pre-subject planner; intentionally ignored. */
  readonly rejectionAggregates?: readonly {
    senderDomain: string;
    rejected: number;
    accepted: number;
  }[];
  readonly suppressionStates?: readonly EmailActionSuppressionState[];
  /** Keys are emailActionResurfaceKey(subjectSignature, messageKey). */
  readonly resurfaceReasons?: ReadonlyMap<string, EmailActionResurfaceReason>;
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
  readonly suggestionMetadata: TaskSuggestionMetadataV1;
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
  const suppressions = new Map(
    (input.suppressionStates ?? []).map((state) => [state.subjectSignature, state])
  );
  const planned: PlannedEmailTask[] = [];

  for (const item of input.items) {
    if (!isCandidateActionability(item)) continue;
    if (item.suggestedTasks.length === 0) continue;

    const confidence = item.confidence;
    if (confidence < CONFIDENCE_FLOOR) continue;

    const inferredSubject = item.inferredSubject?.trim();
    const subjectSignature = inferredSubject
      ? createEmailActionSubjectSignature(inferredSubject)
      : undefined;
    if (subjectSignature === undefined) continue;
    const suppression = subjectSignature ? suppressions.get(subjectSignature) : undefined;
    const resurfaceReason = subjectSignature
      ? input.resurfaceReasons?.get(emailActionResurfaceKey(subjectSignature, item.messageKey))
      : undefined;
    if ((suppression?.dismissalCount ?? 0) >= 2 && !resurfaceReason) continue;
    if (item.cacheMessageId === null) continue;
    const description = boundedDescription(item);
    if (description === null) continue;
    const candidates = item.suggestedTasks;

    for (const candidate of candidates) {
      if (candidate.title.trim().length === 0) continue;
      const dueAt = candidate.dueDate ?? item.dueDate;
      const suggestionMetadata: TaskSuggestionMetadataV1 = {
        version: 1,
        category: item.actionability as TaskSuggestionMetadataV1["category"],
        sourceLabel: item.account.providerLabel,
        sourceHref: item.sourceHref,
        cacheMessageId: item.cacheMessageId,
        subjectSignature,
        computedAt: input.now,
        resurfaceReason: resurfaceReason ?? null
      };
      planned.push({
        status: resurfaceReason ? "suggested" : statusFor(input.mode, item, confidence),
        title: candidate.title,
        description,
        dueAt,
        priority: priorityFor(item, dueAt, nowMs),
        sourceRef: emailSourceRef(item.account.connectorAccountId, item.messageKey),
        externalKey: emailTaskExternalKey(
          item.account.connectorAccountId,
          item.messageKey,
          candidate.title
        ),
        suggestionMetadata,
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
  const text = item.reason?.trim();
  return text ? text.slice(0, MAX_DESCRIPTION_CHARS) : DEFAULT_EMAIL_TASK_DESCRIPTION;
}
