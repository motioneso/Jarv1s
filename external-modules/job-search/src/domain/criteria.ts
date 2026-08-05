// external-modules/job-search/src/domain/criteria.ts
//
// Task 10 (#1294): turning open conversation into a frame the user can see and correct.
// Pure domain code — no SDK imports, no network, no database access. `parseCriteria` and
// `parseContextSummary` are the only places these values are admitted; a bad value throws
// here rather than reaching a screen or a prompt.
//
// `parseCriteria` is strict in the same shape as Task 9's `parseScoreResult`: reject
// unknown keys, reject bad enum values, and default only absent list fields to `[]` and
// absent scalars to a neutral value — never invent content. `remote` has no `null` member
// in `SearchCriteria`, so its neutral default is the enum's own "no-preference" value;
// `wantNarrative`'s neutral default is `""`, which `completedSteps` already treats as "not
// answered" (L9: the UI is never made of model output, and a defaulting parser that invents
// content is exactly that risk one step removed).

import type { SearchCriteria } from "./records.js";

const REMOTE_VALUES = ["required", "preferred", "no-preference", "onsite-ok"] as const;

const KNOWN_CRITERIA_FIELDS = new Set<string>([
  "titles",
  "seniority",
  "locations",
  "remote",
  "compFloorCents",
  "excludeCompanies",
  "mustHave",
  "niceToHave",
  "dealbreakers",
  "wantNarrative"
]);

/** Handed to `ctx.ai.generateStructured` by whichever task extracts criteria from
 * conversation. Nothing here is `required` — the model may leave any field out, and
 * `parseCriteria` is the layer that turns an absence into a defined, non-invented default. */
export const CRITERIA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    titles: { type: "array", items: { type: "string" } },
    seniority: { type: "array", items: { type: "string" } },
    locations: { type: "array", items: { type: "string" } },
    remote: { type: "string", enum: REMOTE_VALUES },
    compFloorCents: { type: ["integer", "null"] },
    excludeCompanies: { type: "array", items: { type: "string" } },
    mustHave: { type: "array", items: { type: "string" } },
    niceToHave: { type: "array", items: { type: "string" } },
    dealbreakers: { type: "array", items: { type: "string" } },
    wantNarrative: { type: "string" }
  }
} as const;

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("criteria must be an object");
  }
  return raw as Record<string, unknown>;
}

function stringArray(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function isRemoteValue(value: unknown): value is (typeof REMOTE_VALUES)[number] {
  return typeof value === "string" && (REMOTE_VALUES as readonly string[]).includes(value);
}

export function parseCriteria(raw: unknown): SearchCriteria {
  const input = record(raw);

  // Unknown-key rejection happens before any field is read, so a model that helpfully
  // returns e.g. `overall` fails loudly rather than being silently ignored.
  for (const key of Object.keys(input)) {
    if (!KNOWN_CRITERIA_FIELDS.has(key)) {
      throw new Error(`unexpected field: ${key}`);
    }
  }

  const remoteRaw = input.remote;
  if (remoteRaw !== undefined && !isRemoteValue(remoteRaw)) {
    throw new Error(`remote must be one of ${REMOTE_VALUES.join(", ")}`);
  }
  const remote =
    remoteRaw === undefined ? "no-preference" : (remoteRaw as SearchCriteria["remote"]);

  const compFloorCentsRaw = input.compFloorCents;
  let compFloorCents: number | null = null;
  if (compFloorCentsRaw !== undefined && compFloorCentsRaw !== null) {
    if (typeof compFloorCentsRaw !== "number" || !Number.isInteger(compFloorCentsRaw)) {
      throw new Error("compFloorCents must be an integer or null");
    }
    compFloorCents = compFloorCentsRaw;
  }

  const wantNarrativeRaw = input.wantNarrative;
  if (wantNarrativeRaw !== undefined && typeof wantNarrativeRaw !== "string") {
    throw new Error("wantNarrative must be a string");
  }

  return {
    titles: stringArray(input, "titles"),
    seniority: stringArray(input, "seniority"),
    locations: stringArray(input, "locations"),
    remote,
    compFloorCents,
    excludeCompanies: stringArray(input, "excludeCompanies"),
    mustHave: stringArray(input, "mustHave"),
    niceToHave: stringArray(input, "niceToHave"),
    dealbreakers: stringArray(input, "dealbreakers"),
    wantNarrative: wantNarrativeRaw === undefined ? "" : wantNarrativeRaw
  };
}

/**
 * Fill in whatever a stored record is missing, so every consumer can rely on the full shape.
 *
 * Total by construction — it never throws, because it runs on the read path. `criteria.set` now
 * writes a *merge* of the fields the model sent rather than a whole defaulted object, so a profile
 * part-way through an interview holds only the keys that have actually been answered. Everything
 * downstream (`freehire.ts`'s `criteria.titles.length`, `score.ts`'s `criteria.seniority.join`,
 * `excludes.ts`'s `criteria.excludeCompanies.map`) dereferences those arrays directly, and would
 * throw on the first crawl of a half-answered profile. The store hydrates through this, so the
 * partial shape never leaves the database row.
 *
 * Deliberately not `parseCriteria`: validation belongs on the write path, where a bad value can be
 * rejected and reported. Throwing on the read path would make the profile itself unloadable — the
 * screen would go blank rather than show the user what they had already said.
 */
export function withCriteriaDefaults(
  stored: Partial<SearchCriteria> | null | undefined
): SearchCriteria {
  const c = stored ?? {};
  const list = (value: unknown): string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  return {
    titles: list(c.titles),
    seniority: list(c.seniority),
    locations: list(c.locations),
    remote: isRemoteValue(c.remote) ? c.remote : "no-preference",
    compFloorCents: typeof c.compFloorCents === "number" ? c.compFloorCents : null,
    excludeCompanies: list(c.excludeCompanies),
    mustHave: list(c.mustHave),
    niceToHave: list(c.niceToHave),
    dealbreakers: list(c.dealbreakers),
    wantNarrative: typeof c.wantNarrative === "string" ? c.wantNarrative : ""
  };
}

/**
 * The same validation as `parseCriteria`, but returning ONLY the fields the caller actually
 * sent — the handler merges the result over what is already stored instead of replacing it.
 *
 * `parseCriteria` defaults every absent field to its neutral value, which is right when a whole
 * record is being built from one extraction and catastrophic when it is used to service a partial
 * update: the seed prompt tells the model to record each answer the moment it hears it, so a
 * save of `{titles}` after a save of `{wantNarrative}` replaced the narrative with `""` and put
 * the "want" step back to not-done. On a live run the user answered everything in one message,
 * the model called this tool with an empty object to acknowledge it, and the whole record was
 * overwritten with defaults — while the tool card said "Resolved." Present-keys-win makes an
 * incremental interview safe, and `{ titles: [] }` still clears titles, because the key is there.
 *
 * Throws on an empty patch rather than writing nothing and reporting success. "I saved that"
 * over an unchanged record is the one outcome the user cannot detect and cannot recover from.
 */
export function parseCriteriaPatch(raw: unknown): Partial<SearchCriteria> {
  const input = record(raw);
  // Validate the whole thing first — unknown keys, bad enums, bad types all throw here exactly
  // as they would for a full parse. Only the projection below differs.
  const full = parseCriteria(input);

  const present = Object.keys(input);
  if (present.length === 0) {
    throw new Error("criteria must set at least one field");
  }

  const patch: Partial<SearchCriteria> = {};
  for (const key of present) {
    // Safe: `parseCriteria` has already rejected any key outside KNOWN_CRITERIA_FIELDS, so every
    // remaining key indexes both records.
    (patch as Record<string, unknown>)[key] = (full as unknown as Record<string, unknown>)[key];
  }
  return patch;
}

/** Drives the onboarding progress readout. Every step is derived from the stored record,
 * never from what the model claimed to have extracted — if the field is empty, the step is
 * not done, whatever the transcript said. */
export const ONBOARDING_STEPS = ["role", "want", "where", "comp", "sources"] as const;

export function completedSteps(
  criteria: Partial<SearchCriteria>,
  enabledPortals: number
): Array<(typeof ONBOARDING_STEPS)[number]> {
  const steps: Array<(typeof ONBOARDING_STEPS)[number]> = [];

  if ((criteria.titles?.length ?? 0) > 0) {
    steps.push("role");
  }
  if ((criteria.wantNarrative ?? "").trim().length > 0) {
    steps.push("want");
  }
  if ((criteria.locations?.length ?? 0) > 0 || criteria.remote === "required") {
    steps.push("where");
  }
  if (criteria.compFloorCents !== null && criteria.compFloorCents !== undefined) {
    steps.push("comp");
  }
  // The one step whose evidence lives outside the criteria object — enabled portals are a
  // property of the profile's sources, not of what the user said they want.
  if (enabledPortals > 0) {
    steps.push("sources");
  }

  return steps;
}

/** Comp and location stay optional: plenty of people genuinely have no floor, and forcing
 * one puts a number in the record the user did not mean. */
export function isReadyToCrawl(criteria: Partial<SearchCriteria>, enabledPortals: number): boolean {
  const steps = new Set(completedSteps(criteria, enabledPortals));
  return steps.has("role") && steps.has("want") && steps.has("sources");
}

/** Hard bound on the profile's `context_summary`. This string rides in `buildScorePrompt`
 * once per posting, so its length multiplies across the whole scored batch — a budget line,
 * not just a field. */
export const CONTEXT_SUMMARY_MAX = 1200;

// Every control character is forbidden, not allowlisted: the summary is one flowing
// paragraph by construction, so none has a legitimate use, and a NUL in particular must
// never reach Postgres — it aborts the statement rather than storing anything.
// Written as \xNN escapes deliberately, not literal bytes -- a literal NUL/DEL in this
// file makes git treat it as binary (no diff, no blame, silently mangled by editors and
// codegen). Do not "simplify" this back into literal control characters even though the
// matched set is identical either way.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

/**
 * The only place `context_summary` is admitted. Three rules, all enforced here because this
 * is the sole gate:
 *   - Bounds: over the cap is a rejection, never a truncation — a half-sentence fed to the
 *     scorer on every posting is worse than a distiller that has to try again.
 *   - Refresh: replaced wholesale, never appended, so an empty string (which would read as
 *     "we have context" while carrying none) is rejected rather than treated as an erase.
 *     Clearing the field is `null`, handled by the caller, not by this parser.
 *   - Provenance is enforced by the caller (only Task 16's confirmed tool may write it) —
 *     this function only proves the *value* is safe to store and prompt with.
 */
export function parseContextSummary(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("context summary must be a string");
  }
  if (CONTROL_CHAR_PATTERN.test(raw)) {
    throw new Error("context summary must not contain control characters");
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("context summary must not be empty or whitespace-only");
  }
  if (trimmed.length > CONTEXT_SUMMARY_MAX) {
    throw new Error(`context summary must be ${CONTEXT_SUMMARY_MAX} characters or fewer`);
  }

  return trimmed;
}
