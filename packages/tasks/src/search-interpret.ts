import {
  TASK_EFFORTS,
  TASK_QUADRANTS,
  TASK_STATUSES,
  type InterpretTaskSearchResponse,
  type TaskSearchDueIntent,
  type TaskSearchIntent
} from "@jarv1s/shared";

import { HttpError } from "./errors.js";

export interface TaskSearchVocabulary {
  readonly lists: readonly { readonly id: string; readonly name: string }[];
  readonly tagNames: readonly string[];
}

export function buildTaskSearchPrompt(input: {
  readonly query: string;
  readonly today: string;
  readonly vocabulary: TaskSearchVocabulary;
}): string {
  return [
    "Convert the user's task search phrase into JSON only.",
    'Allowed shape: {"text":string|null,"status":"todo|done|archived"|null,"effort":"quick|medium|large"|null,"priority":1-5|null,"listIds":string[],"tagNames":string[],"quadrant":"do|schedule|delegate|eliminate"|null,"due":{"kind":"none|overdue|today|this_week"}|{"kind":"range","dueAfter":string|null,"dueBefore":string|null}|null}.',
    "Known lists:",
    JSON.stringify(input.vocabulary.lists.map((list) => ({ id: list.id, name: list.name }))),
    "Known tags:",
    JSON.stringify(input.vocabulary.tagNames),
    `Today in the user's locale: ${input.today}.`,
    `User phrase: ${JSON.stringify(input.query)}`,
    "Return JSON only. Do not invent task data."
  ].join("\n");
}

export function parseTaskSearchIntent(
  providerText: string,
  vocabulary: TaskSearchVocabulary
): InterpretTaskSearchResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(providerText);
  } catch {
    throw new HttpError(502, "Task search interpreter returned invalid JSON");
  }
  return normalizeTaskSearchIntent(raw, vocabulary);
}

export function normalizeTaskSearchIntent(
  raw: unknown,
  vocabulary: TaskSearchVocabulary
): InterpretTaskSearchResponse {
  if (!isRecord(raw)) throw new HttpError(502, "Task search interpreter returned invalid JSON");

  const warnings: string[] = [];
  const listIds = normalizeListIds(raw["listIds"], vocabulary, warnings);
  const tagNames = normalizeTagNames(raw["tagNames"], vocabulary, warnings);
  const intent: TaskSearchIntent = {
    text: nullableString(raw["text"]),
    status: enumValue(raw["status"], TASK_STATUSES),
    effort: enumValue(raw["effort"], TASK_EFFORTS),
    priority: priorityValue(raw["priority"]),
    listIds,
    tagNames,
    quadrant: enumValue(raw["quadrant"], TASK_QUADRANTS),
    due: dueValue(raw["due"])
  };

  return {
    intent,
    confidence: enumValue(raw["confidence"], ["high", "medium", "low"] as const) ?? "medium",
    warnings
  };
}

function normalizeListIds(
  value: unknown,
  vocabulary: TaskSearchVocabulary,
  warnings: string[]
): readonly string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(vocabulary.lists.map((list) => list.id));
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (known.has(item)) ids.push(item);
    else warnings.push(`Unknown list ignored: ${item}`);
  }
  return [...new Set(ids)];
}

function normalizeTagNames(
  value: unknown,
  vocabulary: TaskSearchVocabulary,
  warnings: string[]
): readonly string[] {
  if (!Array.isArray(value)) return [];
  const byLower = new Map(vocabulary.tagNames.map((tag) => [tag.toLowerCase(), tag]));
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = byLower.get(item.toLowerCase());
    if (tag) tags.push(tag);
    else warnings.push(`Unknown tag ignored: ${item}`);
  }
  return [...new Set(tags)];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function enumValue<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[]
): TValue | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as TValue)
    : null;
}

function priorityValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? value
    : null;
}

function dueValue(value: unknown): TaskSearchDueIntent | null {
  if (!isRecord(value)) return null;
  if (
    value["kind"] === "none" ||
    value["kind"] === "overdue" ||
    value["kind"] === "today" ||
    value["kind"] === "this_week"
  ) {
    return { kind: value["kind"] };
  }
  if (value["kind"] === "range") {
    return {
      kind: "range",
      dueAfter: dateKey(value["dueAfter"]),
      dueBefore: dateKey(value["dueBefore"])
    };
  }
  return null;
}

function dateKey(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
