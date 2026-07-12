// tests/unit/job-search-acceptance-evidence.test.ts
//
// JS-09 (#938) Task 3: the release-review evidence artifact is COUNTS-ONLY.
// The renderer must fail closed on any free text smuggled into a field —
// résumé/profile text, company names, descriptions, credentials, and prompts
// are all free text, and no field accepts free text, so none of them can
// reach the artifact. The rendered markdown must never name a provider.
import { describe, expect, it } from "vitest";

import {
  renderAcceptanceEvidence,
  type AcceptanceEvidenceInput
} from "../../scripts/job-search-acceptance-evidence.js";

const PROVIDER_RE =
  /openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i;

const input: AcceptanceEvidenceInput = {
  coreVersion: "0.1.10",
  moduleVersion: "0.1.0",
  nodeVersion: "v22.0.0",
  enabledAdapters: ["greenhouse", "lever", "ashby"],
  runCounts: { scheduledRuns: 2, ingested: 3, suppressedDuplicates: 2, evaluated: 3 },
  dedup: { secondRunNewOpportunities: 0, secondRunNewEvaluations: 0 },
  gates: {
    verifyFoundation: "pass",
    releaseHardening: "pass",
    moduleBuild: "pass",
    isolationSuite: "pass",
    failClosedSuite: "pass",
    lifecycleSuite: "pass"
  },
  evalDailyCap: 25,
  sevenDayResult: "pending"
};

describe("job-search acceptance evidence artifact (#938)", () => {
  it("renders every required section, counts-only", () => {
    const out = renderAcceptanceEvidence(input);
    for (const section of [
      "Package/runtime versions",
      "Enabled adapters",
      "Run counts",
      "Dedup/evaluation results",
      "Security/lifecycle gate outcomes",
      "Seven-day success result"
    ])
      expect(out).toContain(section);
    expect(out).toContain("pending");
    expect(out).not.toMatch(PROVIDER_RE);
  });

  it("fails closed on free text smuggled into any string field", () => {
    for (const bad of [
      { ...input, coreVersion: "JS09-ACCEPT-RESUME-SENTINEL-93d1c4 worked at Initech" },
      { ...input, enabledAdapters: ["greenhouse", "My resume says confidential things"] },
      { ...input, sevenDayResult: "he worked at Initech since 2019" as never }
    ])
      expect(() => renderAcceptanceEvidence(bad)).toThrow(/counts-only|invalid/i);
  });

  it("fails closed on non-integer or negative counts", () => {
    for (const bad of [
      { ...input, evalDailyCap: -1 },
      { ...input, runCounts: { ...input.runCounts, ingested: 1.5 } },
      { ...input, dedup: { ...input.dedup, secondRunNewOpportunities: Number.NaN } }
    ])
      expect(() => renderAcceptanceEvidence(bad)).toThrow(/counts-only|invalid/i);
  });

  it("fails closed on a gate outcome outside the pass/fail union", () => {
    const bad = {
      ...input,
      gates: { ...input.gates, verifyFoundation: "pass (see resume notes)" as never }
    };
    expect(() => renderAcceptanceEvidence(bad)).toThrow(/counts-only|invalid/i);
  });
});
