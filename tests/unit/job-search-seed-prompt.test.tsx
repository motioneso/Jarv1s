// tests/unit/job-search-seed-prompt.test.ts
//
// Task 17 (#1301): the seed prompt that frames the module's per-profile chat thread.
//
// Tool names cited in the prompt are checked against validateExternalModuleManifest()'s
// validated output, never the raw JSON (F1) — the validator reconstructs the manifest from an
// allow-list and silently drops fields it doesn't know, so a raw-JSON read could pass against a
// manifest the real loader would strip down further. Same pattern as job-search-manifest.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// seed-prompt.ts co-locates the pure buildSeedPrompt with the useProfileThread hook (per the
// task's own file list), so importing it evaluates web/runtime.ts's module-scope readRuntime()
// call even though this file never touches React. Install the runtime twin first, same as
// job-search-web-root.test.tsx, or the import throws "requires the Jarvis module runtime v1".
import "./helpers/install-module-runtime.js";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

import { buildSeedPrompt } from "../../external-modules/job-search/src/domain/seed-prompt.js";
import type { Profile } from "../../external-modules/job-search/src/web/use-profiles.js";

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);

function declaredToolNames(): string[] {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const result = validateExternalModuleManifest(raw, "job-search", "0.1.0");
  if (!result.ok) {
    throw new Error(`job-search manifest failed validation: ${JSON.stringify(result.errors)}`);
  }
  return (result.manifest.assistantTools ?? []).map((tool) => tool.name);
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    profileId: "p1",
    name: "Acme SWE search",
    state: "active",
    briefingDetail: null,
    completedSteps: ["role", "want", "where", "comp", "sources"],
    readyToCrawl: true,
    surfaceKey: "surf-1",
    ...overrides
  };
}

// Any dotted/hyphenated `job-search.*` token — the same shape every real tool name takes.
const TOOL_NAME_PATTERN = /job-search\.[a-z][a-z-]*(?:\.[a-z][a-z-]*)+/g;

describe("job-search seed prompt (#1301)", () => {
  it("names the tools that write criteria and resume verbatim", () => {
    const prompt = buildSeedPrompt(profile());
    expect(prompt).toContain("job-search.criteria.set");
    expect(prompt).toContain("job-search.resume.set");
  });

  it("cites no tool name that isn't in the manifest's declared assistantTools", () => {
    const declared = new Set(declaredToolNames());
    expect(declared.size).toBeGreaterThan(0);

    const prompt = buildSeedPrompt(profile());
    const cited = prompt.match(TOOL_NAME_PATTERN) ?? [];
    expect(cited.length).toBeGreaterThan(0);
    for (const name of cited) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it("tells the model the interview has a defined end: five named steps", () => {
    const prompt = buildSeedPrompt(profile());
    for (const step of ["role", "want", "where", "comp", "sources"]) {
      expect(prompt).toContain(step);
    }
  });

  it("never tells the model to withhold a capability — this is a full session", () => {
    const prompt = buildSeedPrompt(profile());
    expect(prompt).not.toMatch(/only use|do not use|you cannot|not available here/i);
  });

  it("stays within the 150-word guidance cap", () => {
    const prompt = buildSeedPrompt(profile());
    const words = prompt.split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(150);
  });
});
