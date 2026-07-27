// tests/unit/job-search-manifest-conformance.test.ts
//
// Task 20 (#1304) follow-up: settings.tsx's own unit test mocks the transport (api.ts), so it
// goes fully green even if every button is wired to a queue or tool that doesn't exist in the
// real manifest — which is exactly the bug a coordinator caught by reading a diff by hand
// (apps/api/src/external-module-jobs.ts:50 404s any runQueue call whose queue name isn't in
// worker.queues with allowManualRun: true; packages/ai's assistant-tools route 403s any
// invokeTool call against a tool that isn't a declared assistantTools entry with risk:"read").
// This test closes that gap by reading the committed manifest and asserting the screen's own
// exported literals — not a retyped copy of them — actually resolve against it.
//
// Uses validateExternalModuleManifest()'s validated output rather than the raw JSON, same
// reasoning as job-search-manifest.test.ts's header: the validator reconstructs the manifest
// from an allow-list and silently drops fields it doesn't recognize, so asserting against raw
// JSON would pass for a manifest the real loader strips to pieces.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

// settings.tsx captures the host module runtime global at import time (runtime.ts's own
// header) — this must be imported before it, same requirement as every other test that
// imports a job-search web file directly (job-search-web-onboarding.test.tsx's precedent).
import "./helpers/install-module-runtime";
import {
  PORTAL_LIST_TOOL,
  PORTAL_SET_ENABLED_QUEUE,
  PROFILE_SET_BRIEFING_DETAIL_QUEUE
} from "../../external-modules/job-search/src/web/screens/settings";

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);

const webSrcDir = fileURLToPath(
  new URL("../../external-modules/job-search/src/web/", import.meta.url)
);

function loadValidatedManifest() {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const result = validateExternalModuleManifest(raw, "job-search", "0.1.0");
  if (!result.ok) {
    throw new Error(`job-search manifest failed to validate: ${JSON.stringify(result.errors)}`);
  }
  return result.manifest;
}

// Blind sweep helpers (#1304 follow-up, coordinator ruling): no per-screen test can be relied on
// to remember this check exists — the settings screen shipped two undeclared queue names and only
// a hand-read of the diff caught it. This walks every .ts/.tsx file under src/web/ and extracts
// every quoted "job-search.<something>" literal, regardless of which call site it came from, so a
// brand-new screen calling a name nobody declared fails here automatically the day it's written.
function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

interface JobSearchLiteral {
  readonly file: string;
  readonly line: number;
  readonly literal: string;
}

// Matches a quoted (', ", or `) literal starting with "job-search." — deliberately quote-anchored
// so it does not false-positive on the colon-separated localStorage key
// ("job-search:selected-profile-id") or the underscore-separated table name (job_search_profiles),
// neither of which is a tool or queue name.
const JOB_SEARCH_LITERAL_PATTERN = /(["'`])(job-search\.[A-Za-z0-9_.-]+)\1/;

function findJobSearchLiterals(files: readonly string[]): JobSearchLiteral[] {
  const found: JobSearchLiteral[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((lineText, index) => {
      const re = new RegExp(JOB_SEARCH_LITERAL_PATTERN.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(lineText)) !== null) {
        found.push({ file, line: index + 1, literal: match[2] });
      }
    });
  }
  return found;
}

describe("job-search settings screen vs. the committed manifest (#1304)", () => {
  it("declares both of settings.tsx's write queues with allowManualRun: true", () => {
    const manifest = loadValidatedManifest();
    const queues = manifest.worker?.queues ?? [];

    for (const queueName of [PORTAL_SET_ENABLED_QUEUE, PROFILE_SET_BRIEFING_DETAIL_QUEUE]) {
      const queue = queues.find((item) => item.name === queueName);
      // A queue missing here, or present without allowManualRun, is not a lint nit — it is the
      // exact condition that makes apps/api/src/external-module-jobs.ts 404 the runQueue call,
      // so the settings screen's toggle/segmented-control silently does nothing in production.
      expect(queue, `worker.queues is missing "${queueName}"`).toBeDefined();
      expect(queue?.allowManualRun, `"${queueName}" must set allowManualRun: true`).toBe(true);
    }
  });

  it("declares settings.tsx's one invokeTool call as a read-risk assistant tool", () => {
    const manifest = loadValidatedManifest();
    const tools = manifest.assistantTools ?? [];
    const tool = tools.find((item) => item.name === PORTAL_LIST_TOOL);

    // Load-bearing, not decorative: a write-risk tool reached through invokeTool 403s with
    // confirmation_required before it ever runs (rulings I3/I4) — so risk must be exactly
    // "read", not merely "declared".
    expect(tool, `assistantTools is missing "${PORTAL_LIST_TOOL}"`).toBeDefined();
    expect(tool?.risk).toBe("read");
  });
});

describe("every job-search.* literal under src/web/ resolves to a declared, reachable name (#1304)", () => {
  it("has no undeclared literal, no write-risk tool via invokeTool, no manual-run-disabled queue", () => {
    const manifest = loadValidatedManifest();
    const toolByName = new Map((manifest.assistantTools ?? []).map((tool) => [tool.name, tool]));
    const queueByName = new Map((manifest.worker?.queues ?? []).map((queue) => [queue.name, queue]));

    const files = walkSourceFiles(webSrcDir);
    const literals = findJobSearchLiterals(files);

    // Guard against a vacuous pass: if webSrcDir ever resolves wrong, a refactor moves src/web/,
    // or the literal regex stops matching, `literals` silently goes empty and the loop below
    // asserts nothing while the test still reports green — the worst failure mode for a net whose
    // entire job is catching a screen nobody remembered to check. Floors are set comfortably below
    // today's real counts (13 files under src/web/, 10 job-search.* literals across
    // root.tsx/use-profiles.ts/board.tsx/settings.tsx) but high enough that a broken walk trips one.
    expect(files.length, "walked no files under src/web/ — the sweep is disarmed").toBeGreaterThan(3);
    expect(literals.length, "found no job-search.* literals — the sweep is disarmed").toBeGreaterThan(5);

    const failures: string[] = [];

    for (const { file, line, literal } of literals) {
      const where = `${relative(webSrcDir, file)}:${line} -> "${literal}"`;
      const tool = toolByName.get(literal);
      const queue = queueByName.get(literal);

      // The naming convention keeps these buckets disjoint (queue names dash the last segment —
      // job-search.portal-set-enabled — while tool names stay fully dotted —
      // job-search.portal.set-enabled), so a literal that matches one never matches the other in
      // practice today. Nothing enforces that convention, though — validate.ts wouldn't catch a
      // violation — so treat it as an observation, not a guarantee. A collision would only produce
      // a confusing failure message here, not a wrong verdict: both branches below still check
      // their own bucket's rule independently.
      if (tool) {
        // Only ever reachable via invokeTool. Anything but risk:"read" 403s with
        // blockedReason: "confirmation_required" before it ever runs (packages/ai/src/routes.ts).
        if (tool.risk !== "read") {
          failures.push(`${where} is declared but risk is "${tool.risk}", not "read" (invokeTool 403s)`);
        }
      } else if (queue) {
        // Only ever reachable via runQueue, which 404s unless allowManualRun is true
        // (apps/api/src/external-module-jobs.ts:50).
        if (!queue.allowManualRun) {
          failures.push(`${where} is a declared queue but allowManualRun is not true (runQueue 404s)`);
        }
      } else {
        // Matches neither bucket — a brand-new screen calling a name nobody declared, or a typo.
        // This is what lets the sweep run with no exports and no per-screen coordination.
        failures.push(`${where} is not a declared assistantTools name or worker.queues name`);
      }
    }

    expect(failures, `undeclared or unreachable job-search.* literal(s):\n${failures.join("\n")}`).toHaveLength(
      0
    );
  });
});
