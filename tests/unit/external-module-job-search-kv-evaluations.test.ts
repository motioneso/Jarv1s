// tests/unit/external-module-job-search-kv-evaluations.test.ts
//
// JS-07 (#936) Step 4: evaluation records + the daily AI budget ledger.
// Evaluations are a sibling key family (eval/<identityHash>) rather than
// fields on the job record — a description alone can be 16 KB, and the KV
// value cap is 65,535 bytes, so co-locating them would risk oversize jobs.
// `outdated` is COMPUTED on read by comparing stored input hashes to current
// inputs (no rewrite storm when a profile revision changes). The budget
// ledger is date-keyed (UTC — plan Open decision 2) and capped at
// EVAL_DAILY_CAP; takeBudget grants what remains, never more.
import { describe, expect, it } from "vitest";

import type {
  EvaluationInputs,
  EvaluationRecord
} from "../../external-modules/job-search/src/domain/evaluations.js";
import {
  budgetDateFor,
  getEvaluation,
  isOutdated,
  readBudgetUsed,
  saveEvaluation,
  takeBudget
} from "../../external-modules/job-search/src/domain/evaluations.js";
import { evaluationIdentity } from "../../external-modules/job-search/src/domain/keys.js";
import {
  EVAL_DAILY_CAP,
  EVALUATION_MAX_BYTES
} from "../../external-modules/job-search/src/domain/limits.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const JOB_HASH = "0123456789abcdef0123456789abcdef";

const INPUTS: EvaluationInputs = {
  opportunityContentHash: "aaaa0000aaaa0000aaaa0000aaaa0000",
  profileRevisionId: "profile-rev-1",
  resumeRevisionId: "resume-rev-1"
};

function makeEvaluation(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    schemaVersion: 1,
    evaluationId: evaluationIdentity(INPUTS),
    identityHash: JOB_HASH,
    fitBand: "strong",
    recommendation: "review",
    evidence: [
      { requirement: "5y TypeScript", evidence: "8y TypeScript at Acme", source: "resume" }
    ],
    blockers: [],
    gaps: ["No Kubernetes exposure"],
    unknowns: ["Team size"],
    preferenceMatches: ["remote"],
    preferenceConflicts: [],
    postingConfidence: "high",
    overallConfidence: "medium",
    summary: "Strong technical match.",
    inputs: INPUTS,
    createdAt: NOW.toISOString(),
    ...overrides
  };
}

describe("evaluation records (JS-07)", () => {
  it("round-trips an evaluation keyed by the job's identity hash", async () => {
    const kv = createMemoryKv();
    const record = makeEvaluation();
    await saveEvaluation(kv, record);
    expect(await getEvaluation(kv, JOB_HASH)).toEqual(record);
  });

  it("returns null when no evaluation exists", async () => {
    const kv = createMemoryKv();
    expect(await getEvaluation(kv, JOB_HASH)).toBeNull();
  });

  it("rejects malformed identity hashes before they become key material", async () => {
    const kv = createMemoryKv();
    await expect(getEvaluation(kv, "not-a-hash")).rejects.toThrow(JobSearchKvError);
  });

  it("enforces the evaluation byte cap with a typed error, writing nothing", async () => {
    const kv = createMemoryKv();
    const oversized = makeEvaluation({ summary: "x".repeat(EVALUATION_MAX_BYTES) });
    await expect(saveEvaluation(kv, oversized)).rejects.toMatchObject({
      code: "oversize_value"
    });
    expect(await getEvaluation(kv, JOB_HASH)).toBeNull();
  });

  it("a rewrite over the same key wins (latest evaluation replaces the old)", async () => {
    const kv = createMemoryKv();
    await saveEvaluation(kv, makeEvaluation());
    const newer = makeEvaluation({ fitBand: "low", recommendation: "pass" });
    await saveEvaluation(kv, newer);
    expect(await getEvaluation(kv, JOB_HASH)).toEqual(newer);
  });

  describe("isOutdated (computed on read, never stored)", () => {
    it("is current when all three input hashes match", () => {
      expect(isOutdated(makeEvaluation(), INPUTS)).toBe(false);
    });

    it.each([
      ["opportunityContentHash", { ...INPUTS, opportunityContentHash: "bbbb0000".repeat(4) }],
      ["profileRevisionId", { ...INPUTS, profileRevisionId: "profile-rev-2" }],
      ["resumeRevisionId", { ...INPUTS, resumeRevisionId: "resume-rev-2" }]
    ])("any changed input outdates it: %s", (_label, current) => {
      expect(isOutdated(makeEvaluation(), current as EvaluationInputs)).toBe(true);
    });
  });
});

describe("daily evaluation budget (JS-07)", () => {
  const DATE = "2026-07-11";

  it("budgetDateFor uses the UTC calendar date (plan Open decision 2)", () => {
    expect(budgetDateFor(NOW)).toBe("2026-07-11");
    // 23:30Z is already the NEXT day in UTC+2, but the ledger stays UTC.
    expect(budgetDateFor(new Date("2026-07-11T23:30:00.000Z"))).toBe("2026-07-11");
  });

  it("grants up to the cap and persists usage across takes", async () => {
    const kv = createMemoryKv();
    expect(await takeBudget(kv, DATE, 6)).toBe(6);
    expect(await takeBudget(kv, DATE, 6)).toBe(6);
    expect(await readBudgetUsed(kv, DATE)).toBe(12);
  });

  it("grants only the remainder near the cap, then zero when exhausted", async () => {
    const kv = createMemoryKv();
    expect(await takeBudget(kv, DATE, EVAL_DAILY_CAP - 2)).toBe(EVAL_DAILY_CAP - 2);
    expect(await takeBudget(kv, DATE, 6)).toBe(2);
    expect(await takeBudget(kv, DATE, 6)).toBe(0);
    expect(await readBudgetUsed(kv, DATE)).toBe(EVAL_DAILY_CAP);
  });

  it("each date has its own ledger (day rollover resets the budget)", async () => {
    const kv = createMemoryKv();
    expect(await takeBudget(kv, DATE, EVAL_DAILY_CAP)).toBe(EVAL_DAILY_CAP);
    expect(await takeBudget(kv, "2026-07-12", 6)).toBe(6);
    expect(await readBudgetUsed(kv, DATE)).toBe(EVAL_DAILY_CAP);
    expect(await readBudgetUsed(kv, "2026-07-12")).toBe(6);
  });

  it("a zero request grants zero and writes nothing", async () => {
    const kv = createMemoryKv();
    expect(await takeBudget(kv, DATE, 0)).toBe(0);
    expect(await readBudgetUsed(kv, DATE)).toBe(0);
  });

  it("rejects a date that does not satisfy the id pattern", async () => {
    const kv = createMemoryKv();
    await expect(takeBudget(kv, "2026/07/11", 1)).rejects.toThrow(JobSearchKvError);
  });
});
