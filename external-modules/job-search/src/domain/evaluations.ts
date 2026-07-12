// external-modules/job-search/src/domain/evaluations.ts
//
// JS-07 (#936) Step 4: AI evaluation records + the daily budget ledger.
// Evaluations are a sibling key family (eval/<identityHash>) in
// NS.opportunities, NOT fields on the job record — a description alone can
// be 16 KB against the 65,535-byte KV cap, so co-locating would risk
// oversize jobs. They get their own tighter cap (EVALUATION_MAX_BYTES).
// `outdated` is never stored: it is COMPUTED on read by comparing the
// record's input hashes to the current inputs, so a profile-revision change
// outdates every evaluation without a rewrite storm. The budget ledger is
// keyed by UTC calendar date (plan Open decision 2 — the user-level ledger
// uses DEFAULT_TIMEZONE, not a per-monitor zone) and capped at
// EVAL_DAILY_CAP; takeBudget grants what remains, never more.
import { JobSearchKvError } from "./errors.js";
import { keys, assertId } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { EVAL_DAILY_CAP, EVALUATION_MAX_BYTES } from "./limits.js";
import { assertHash } from "./opportunities.js";
import { readRecord, writeRecord } from "./records.js";
import { DEFAULT_TIMEZONE, localDateAndTime } from "./schedule.js";

/**
 * The exact inputs an evaluation was computed from. Any member changing
 * means the stored evaluation no longer describes reality (isOutdated).
 */
export interface EvaluationInputs {
  opportunityContentHash: string;
  profileRevisionId: string;
  resumeRevisionId: string;
}

export type FitBand = "strong" | "possible" | "low";
export type EvaluationRecommendation = "review" | "watch" | "pass";
export type EvaluationConfidence = "high" | "medium" | "low";

export interface EvaluationEvidence {
  requirement: string;
  evidence: string;
  source: string;
}

export interface EvaluationRecord {
  schemaVersion: 1;
  /** = evaluationIdentity(inputs) — identity of this computation. */
  evaluationId: string;
  /** The job this evaluation belongs to (its eval/<h> key material). */
  identityHash: string;
  fitBand: FitBand;
  recommendation: EvaluationRecommendation;
  evidence: EvaluationEvidence[];
  blockers: string[];
  gaps: string[];
  unknowns: string[];
  preferenceMatches: string[];
  preferenceConflicts: string[];
  postingConfidence: EvaluationConfidence;
  overallConfidence: EvaluationConfidence;
  summary: string;
  inputs: EvaluationInputs;
  createdAt: string;
}

/** Daily budget ledger record stored at evalBudget/<YYYY-MM-DD>. */
export interface EvalBudgetRecord {
  schemaVersion: 1;
  date: string;
  used: number;
}

/** Latest evaluation for a job, or null when none exists. */
export async function getEvaluation(
  kv: JobSearchKv,
  identityHash: string
): Promise<EvaluationRecord | null> {
  assertHash(identityHash);
  const record = await readRecord(kv, NS.opportunities, keys.evaluation(identityHash));
  return record as EvaluationRecord | null;
}

/**
 * Write an evaluation (latest wins — a rewrite over the same key replaces
 * the old record). Enforces EVALUATION_MAX_BYTES with a typed
 * `oversize_value` error BEFORE any write; message carries sizes only.
 */
export async function saveEvaluation(kv: JobSearchKv, record: EvaluationRecord): Promise<void> {
  assertHash(record.identityHash);
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > EVALUATION_MAX_BYTES) {
    throw new JobSearchKvError(
      "oversize_value",
      `evaluation is ${bytes} bytes; limit is ${EVALUATION_MAX_BYTES}`
    );
  }
  await writeRecord(kv, NS.opportunities, keys.evaluation(record.identityHash), record);
}

/**
 * Computed on read, never stored: an evaluation is outdated as soon as ANY
 * of its three inputs (posting content, profile revision, resume revision)
 * differs from the current state.
 */
export function isOutdated(record: EvaluationRecord, current: EvaluationInputs): boolean {
  return (
    record.inputs.opportunityContentHash !== current.opportunityContentHash ||
    record.inputs.profileRevisionId !== current.profileRevisionId ||
    record.inputs.resumeRevisionId !== current.resumeRevisionId
  );
}

/**
 * The ledger date for a moment in time — the UTC calendar date (plan Open
 * decision 2: the user-level budget uses DEFAULT_TIMEZONE, not a monitor's
 * zone, so two monitors in different zones share one daily budget).
 */
export function budgetDateFor(now: Date): string {
  return localDateAndTime(now, DEFAULT_TIMEZONE).date;
}

function readLedgerUsed(record: Record<string, unknown> | null): number {
  if (record === null) {
    return 0;
  }
  // Fail closed on shape drift: a corrupt `used` must never grant budget.
  if (typeof record.used !== "number" || !Number.isFinite(record.used) || record.used < 0) {
    throw new JobSearchKvError("invalid_record", "budget ledger has a non-numeric used count");
  }
  return record.used;
}

/**
 * Reserve up to `requested` evaluations from the date's budget. Returns the
 * granted count: the full request while budget remains, the remainder near
 * the cap, and 0 when exhausted. A zero grant writes nothing.
 */
export async function takeBudget(
  kv: JobSearchKv,
  date: string,
  requested: number,
  cap: number = EVAL_DAILY_CAP
): Promise<number> {
  assertId(date);
  if (requested <= 0) {
    return 0;
  }
  const key = keys.evalBudget(date);
  const used = readLedgerUsed(await readRecord(kv, NS.opportunities, key));
  const granted = Math.min(requested, Math.max(0, cap - used));
  if (granted === 0) {
    return 0;
  }
  const ledger: EvalBudgetRecord = { schemaVersion: 1, date, used: used + granted };
  await writeRecord(kv, NS.opportunities, key, ledger);
  return granted;
}

/** Evaluations already spent on the given date (0 when no ledger exists). */
export async function readBudgetUsed(kv: JobSearchKv, date: string): Promise<number> {
  assertId(date);
  return readLedgerUsed(await readRecord(kv, NS.opportunities, keys.evalBudget(date)));
}
