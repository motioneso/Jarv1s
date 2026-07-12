// scripts/job-search-acceptance-evidence.ts
//
// JS-09 (#938): render the Job Search acceptance-evidence artifact for
// release review. COUNTS-ONLY by construction: every field is structurally
// validated (semver-ish versions, kebab-case adapter ids, non-negative
// integer counts, closed unions for gate outcomes and the seven-day result)
// and any violation throws — résumé/profile text, company names,
// descriptions, credentials, and prompts are all free text, and no field
// accepts free text, so none of them can enter the artifact.
//
// Destination: a comment on issue #938 (GitHub is the source of truth for
// status) — this markdown is NEVER committed to the repo; posting it is the
// coordinator/QA's step, not this script's.
//
// CLI: pnpm evidence:job-search -- --results <path-to-results.json>
//   Versions, the enabled-adapter list, and the daily evaluation cap are
//   gathered from the repo; run counts, gate outcomes, and the seven-day
//   result come from the --results JSON (fields picked explicitly, unknown
//   keys dropped) and are validated by the renderer before anything prints.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KILL_SWITCHED,
  SOURCE_ADAPTERS,
  activeAdapters
} from "../external-modules/job-search/src/adapters/registry.js";
import { EVAL_DAILY_CAP } from "../external-modules/job-search/src/domain/limits.js";

export type GateOutcome = "pass" | "fail";
export type SevenDayResult = "pending" | "met" | "insufficient-supply";

export interface AcceptanceEvidenceInput {
  readonly coreVersion: string;
  readonly moduleVersion: string;
  readonly nodeVersion: string;
  readonly enabledAdapters: readonly string[];
  readonly runCounts: {
    readonly scheduledRuns: number;
    readonly ingested: number;
    readonly suppressedDuplicates: number;
    readonly evaluated: number;
  };
  readonly dedup: {
    readonly secondRunNewOpportunities: number;
    readonly secondRunNewEvaluations: number;
  };
  readonly gates: {
    readonly verifyFoundation: GateOutcome;
    readonly releaseHardening: GateOutcome;
    readonly moduleBuild: GateOutcome;
    readonly isolationSuite: GateOutcome;
    readonly failClosedSuite: GateOutcome;
    readonly lifecycleSuite: GateOutcome;
  };
  readonly evalDailyCap: number;
  readonly sevenDayResult: SevenDayResult;
}

const VERSION_RE = /^v?\d+\.\d+\.\d+$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const GATE_OUTCOMES: ReadonlySet<string> = new Set(["pass", "fail"]);
const SEVEN_DAY_RESULTS: ReadonlySet<string> = new Set(["pending", "met", "insufficient-supply"]);

function invalid(field: string): never {
  throw new Error(`evidence artifact is counts-only: invalid ${field}`);
}

function version(value: string, field: string): string {
  if (typeof value !== "string" || !VERSION_RE.test(value)) invalid(field);
  return value;
}

function count(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid(field);
  return value;
}

function gate(value: GateOutcome, field: string): GateOutcome {
  if (!GATE_OUTCOMES.has(value)) invalid(field);
  return value;
}

export function renderAcceptanceEvidence(input: AcceptanceEvidenceInput): string {
  const coreVersion = version(input.coreVersion, "coreVersion");
  const moduleVersion = version(input.moduleVersion, "moduleVersion");
  const nodeVersion = version(input.nodeVersion, "nodeVersion");

  if (!Array.isArray(input.enabledAdapters) || input.enabledAdapters.length === 0) {
    invalid("enabledAdapters");
  }
  const enabledAdapters = input.enabledAdapters.map((id) => {
    if (typeof id !== "string" || !ADAPTER_ID_RE.test(id)) invalid("enabledAdapters");
    return id;
  });

  const runCounts = {
    scheduledRuns: count(input.runCounts.scheduledRuns, "runCounts.scheduledRuns"),
    ingested: count(input.runCounts.ingested, "runCounts.ingested"),
    suppressedDuplicates: count(
      input.runCounts.suppressedDuplicates,
      "runCounts.suppressedDuplicates"
    ),
    evaluated: count(input.runCounts.evaluated, "runCounts.evaluated")
  };
  const dedup = {
    secondRunNewOpportunities: count(
      input.dedup.secondRunNewOpportunities,
      "dedup.secondRunNewOpportunities"
    ),
    secondRunNewEvaluations: count(
      input.dedup.secondRunNewEvaluations,
      "dedup.secondRunNewEvaluations"
    )
  };
  const gates = {
    verifyFoundation: gate(input.gates.verifyFoundation, "gates.verifyFoundation"),
    releaseHardening: gate(input.gates.releaseHardening, "gates.releaseHardening"),
    moduleBuild: gate(input.gates.moduleBuild, "gates.moduleBuild"),
    isolationSuite: gate(input.gates.isolationSuite, "gates.isolationSuite"),
    failClosedSuite: gate(input.gates.failClosedSuite, "gates.failClosedSuite"),
    lifecycleSuite: gate(input.gates.lifecycleSuite, "gates.lifecycleSuite")
  };
  const evalDailyCap = count(input.evalDailyCap, "evalDailyCap");
  if (!SEVEN_DAY_RESULTS.has(input.sevenDayResult)) invalid("sevenDayResult");

  return [
    "# Job Search acceptance evidence (#938)",
    "",
    "Counts-only artifact. No résumé, profile, query, posting, or provider content.",
    "",
    "## Package/runtime versions",
    "",
    `- Core: \`${coreVersion}\``,
    `- Module: \`${moduleVersion}\``,
    `- Node: \`${nodeVersion}\``,
    "",
    "## Enabled adapters",
    "",
    ...enabledAdapters.map((id) => `- \`${id}\``),
    "",
    "## Run counts",
    "",
    `- Scheduled runs: ${runCounts.scheduledRuns}`,
    `- Opportunities ingested: ${runCounts.ingested}`,
    `- Duplicates suppressed: ${runCounts.suppressedDuplicates}`,
    `- Evaluated: ${runCounts.evaluated}`,
    "",
    "## Dedup/evaluation results",
    "",
    `- Second run, new opportunities: ${dedup.secondRunNewOpportunities}`,
    `- Second run, new evaluations: ${dedup.secondRunNewEvaluations}`,
    `- Daily evaluation cap: ${evalDailyCap}`,
    "",
    "## Security/lifecycle gate outcomes",
    "",
    `- verify:foundation: ${gates.verifyFoundation}`,
    `- release hardening: ${gates.releaseHardening}`,
    `- module build: ${gates.moduleBuild}`,
    `- isolation suite: ${gates.isolationSuite}`,
    `- fail-closed suite: ${gates.failClosedSuite}`,
    `- lifecycle suite: ${gates.lifecycleSuite}`,
    "",
    "## Seven-day success result",
    "",
    `- ${input.sevenDayResult}`,
    ""
  ].join("\n");
}

type ResultsFile = Pick<
  AcceptanceEvidenceInput,
  "runCounts" | "dedup" | "gates" | "sevenDayResult"
>;

function readResults(path: string): ResultsFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  // Explicit field picks: unknown keys in the results file are dropped here,
  // and every picked value still goes through the renderer's validation.
  const runCounts = (parsed.runCounts ?? {}) as ResultsFile["runCounts"];
  const dedup = (parsed.dedup ?? {}) as ResultsFile["dedup"];
  const gates = (parsed.gates ?? {}) as ResultsFile["gates"];
  return {
    runCounts: {
      scheduledRuns: runCounts.scheduledRuns,
      ingested: runCounts.ingested,
      suppressedDuplicates: runCounts.suppressedDuplicates,
      evaluated: runCounts.evaluated
    },
    dedup: {
      secondRunNewOpportunities: dedup.secondRunNewOpportunities,
      secondRunNewEvaluations: dedup.secondRunNewEvaluations
    },
    gates: {
      verifyFoundation: gates.verifyFoundation,
      releaseHardening: gates.releaseHardening,
      moduleBuild: gates.moduleBuild,
      isolationSuite: gates.isolationSuite,
      failClosedSuite: gates.failClosedSuite,
      lifecycleSuite: gates.lifecycleSuite
    },
    sevenDayResult: parsed.sevenDayResult as SevenDayResult
  };
}

function main(): void {
  const flagIndex = process.argv.indexOf("--results");
  const resultsPath = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!resultsPath) {
    console.error("usage: tsx scripts/job-search-acceptance-evidence.ts --results <results.json>");
    process.exit(1);
  }

  const rootPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string };
  const manifest = JSON.parse(
    readFileSync(
      new URL("../external-modules/job-search/jarvis.module.json", import.meta.url),
      "utf8"
    )
  ) as { version: string };

  const results = readResults(resultsPath);
  process.stdout.write(
    renderAcceptanceEvidence({
      coreVersion: rootPackage.version,
      moduleVersion: manifest.version,
      nodeVersion: process.version,
      enabledAdapters: activeAdapters(SOURCE_ADAPTERS, KILL_SWITCHED).map((a) => a.id),
      evalDailyCap: EVAL_DAILY_CAP,
      ...results
    })
  );
}

// CLI: `pnpm evidence:job-search -- --results <path>`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
