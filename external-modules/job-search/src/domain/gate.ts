// external-modules/job-search/src/domain/gate.ts
//
// JS-07 (#936) Step 3: deterministic gate — the free filter that decides
// which opportunities are even eligible for (budgeted) AI evaluation.
// Spec §deterministic-gate: reject or flag ONLY from explicit structured
// facts; missing or unparseable data is unknown, never a rejection.
//
// Severity model:
// - "excluded": both sides of the comparison are structured/confirmed
//   (excluded company vs posting.company, employment type / work mode vs
//   the typed posting facts, parsed annual compensation vs a confirmed
//   currency+minimum, stale freshness = authoritative closure).
// - "flagged": a deterministic signal exists but free text cannot CONFIRM
//   impossibility (dealbreaker phrase in title/description, onsite posting
//   with zero location overlap). Flagged survivors still reach evaluation.
// - Sponsorship and industry exclusion have no structured posting-side
//   counterpart (PostingFacts carries neither), so per the missing-data
//   rule they stay unknown here by construction; the AI evaluation sees
//   `needsSponsorship`/`industries` through the profile instead.
//
// Profile field VALUES are untyped (ProfileRevision.fields is
// Record<string, unknown>) — every reader below parses defensively.
import { freshnessOf } from "./freshness.js";
import type { OpportunityRecord } from "./opportunities.js";

export type GateVerdict = "eligible" | "excluded" | "flagged";

export interface GateResult {
  verdict: GateVerdict;
  reasons: readonly string[];
}

function norm(text: string): string {
  return text.trim().toLowerCase();
}

/** Collapse case/punctuation so "Full-Time" / "full time" / "FULL_TIME" compare equal. */
function normToken(text: string): string {
  return norm(text).replace(/[^a-z0-9]/g, "");
}

/** Non-empty trimmed strings from an unknown value; anything else reads as absent. */
function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

const WORK_MODES = new Set(["remote", "hybrid", "onsite"]);

/** remotePreference may be a single string or an array; only known modes count. */
function readWorkModePreference(value: unknown): ReadonlySet<string> {
  const raw = typeof value === "string" ? [value] : readStringArray(value);
  return new Set(raw.map(norm).filter((v) => WORK_MODES.has(v)));
}

interface ConfirmedMinimum {
  currency: string;
  minimum: number;
}

/** A minimum is "confirmed" only as a structured {currency, minimum} pair. */
function readConfirmedMinimum(value: unknown): ConfirmedMinimum | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const fields = value as Record<string, unknown>;
  const rawMin = fields["minimum"];
  const minimum =
    typeof rawMin === "number"
      ? rawMin
      : typeof rawMin === "string" && /^\d+(\.\d+)?$/.test(rawMin.trim())
        ? Number(rawMin.trim())
        : Number.NaN;
  const currency = typeof fields["currency"] === "string" ? fields["currency"].trim() : "";
  if (!Number.isFinite(minimum) || minimum <= 0 || !/^[A-Za-z]{3}$/.test(currency)) {
    return null;
  }
  return { currency: currency.toUpperCase(), minimum };
}

// Hourly/daily/weekly/monthly pay cannot be reliably compared to an annual
// minimum — any such marker makes the whole string unknown.
const NON_ANNUAL_PATTERN =
  /(?:\bper\s+|\/\s*)(?:hour|hr|day|week|wk|month|mo)\b|\b(?:hourly|daily|weekly|monthly)\b/i;

const CURRENCY_CODE_PATTERN = /\b(USD|CAD|AUD|NZD|EUR|GBP|CHF|JPY|INR|SEK|NOK|DKK)\b/i;

// A bare "$" is presumed USD (the overwhelmingly common case on the boards
// we ingest); other dollar currencies must spell their code to be compared.
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["$", "USD"]
];

interface ParsedCompensation {
  currency: string;
  annualMax: number;
}

/** Best-effort annual maximum from a free-text compensation string; null = unknown. */
function parseAnnualCompensation(text: string): ParsedCompensation | null {
  if (NON_ANNUAL_PATTERN.test(text)) {
    return null;
  }
  const code = CURRENCY_CODE_PATTERN.exec(text);
  const symbol = CURRENCY_SYMBOLS.find(([sym]) => text.includes(sym));
  const currency = code !== null ? code[1]!.toUpperCase() : (symbol?.[1] ?? null);
  if (currency === null) {
    return null;
  }
  let annualMax = 0;
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)) {
    const value = Number(match[1]!.replace(/,/g, "")) * (match[2] !== undefined ? 1000 : 1);
    if (value > annualMax) {
      annualMax = value;
    }
  }
  // Sub-four-digit "annual" figures are almost certainly not salaries
  // (grades, team sizes) — refuse to compare rather than mis-exclude.
  return annualMax >= 1000 ? { currency, annualMax } : null;
}

export function applyGate(
  profileFields: Record<string, unknown>,
  record: OpportunityRecord
): GateResult {
  const excluded: string[] = [];
  const flagged: string[] = [];
  const posting = record.posting;

  // Authoritative closure: the board itself stopped listing this posting.
  if (freshnessOf(record) === "stale") {
    excluded.push("stale_posting");
  }

  const excludedCompanies = readStringArray(profileFields["excludedCompanies"]).map(norm);
  if (excludedCompanies.includes(norm(posting.company))) {
    excluded.push("excluded_company");
  }

  const employmentTypes = readStringArray(profileFields["employmentTypes"]).map(normToken);
  if (
    employmentTypes.length > 0 &&
    posting.employmentType !== undefined &&
    normToken(posting.employmentType) !== "" &&
    !employmentTypes.includes(normToken(posting.employmentType))
  ) {
    excluded.push("employment_type_incompatible");
  }

  const workModes = readWorkModePreference(profileFields["remotePreference"]);
  if (workModes.size > 0 && posting.workMode !== undefined && !workModes.has(posting.workMode)) {
    excluded.push("work_mode_incompatible");
  }

  const confirmedMinimum = readConfirmedMinimum(profileFields["compensation"]);
  if (confirmedMinimum !== null && posting.compensation !== undefined) {
    const parsed = parseAnnualCompensation(posting.compensation);
    if (
      parsed !== null &&
      parsed.currency === confirmedMinimum.currency &&
      parsed.annualMax < confirmedMinimum.minimum
    ) {
      excluded.push("compensation_below_minimum");
    }
  }

  // Dealbreakers are the user's own words matched against posting text —
  // deterministic, but text can say "no on-call" too, so flag, don't reject.
  // Entries under 3 chars would match near-everything and are ignored.
  const haystack = norm(`${posting.title}\n${posting.description}`);
  for (const term of readStringArray(profileFields["dealbreakers"])) {
    const needle = norm(term);
    if (needle.length >= 3 && haystack.includes(needle)) {
      flagged.push(`dealbreaker_match:${needle}`);
    }
  }

  // Geography matters only when the posting CONFIRMS onsite; location strings
  // are free text on both sides, so a zero-overlap miss is a flag, never proof.
  const locations = readStringArray(profileFields["locations"]).map(norm);
  if (locations.length > 0 && posting.workMode === "onsite" && posting.location !== undefined) {
    const postingLocation = norm(posting.location);
    const overlaps = locations.some(
      (loc) => postingLocation.includes(loc) || loc.includes(postingLocation)
    );
    if (!overlaps) {
      flagged.push("location_mismatch");
    }
  }

  if (excluded.length > 0) {
    return { verdict: "excluded", reasons: [...excluded, ...flagged] };
  }
  if (flagged.length > 0) {
    return { verdict: "flagged", reasons: flagged };
  }
  return { verdict: "eligible", reasons: [] };
}
