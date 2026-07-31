// #1282 Task 2 (composer half): collectExternalBriefingContributions is the trust boundary
// where an external module's worker-invoke result — arbitrary, untrusted JSON — becomes a
// typed BriefingContribution or gets dropped. Every case here drives the real function with a
// vi.fn() invoker; none of them assert on a thrown error (J3) — a module that cannot answer
// must not take the whole briefing down, so the only thing worth asserting is the composed
// output.
import { describe, expect, it, vi } from "vitest";

import {
  collectExternalBriefingContributions,
  MAX_ITEMS,
  type BriefingContribution
} from "@jarv1s/briefings";
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

// Same base shape as tests/unit/external-module-briefing-manifest.test.ts, so both files agree
// on what a real validated manifest looks like.
const baseManifest = {
  schemaVersion: 1 as const,
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional" as const,
  compatibility: { jarv1s: ">=0.0.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 as const }
};

const moduleWithBriefing: JsonJarvisModuleManifest = {
  ...baseManifest,
  id: "job-search",
  name: "Job Search",
  briefing: {
    handler: "briefing.contribute",
    sections: ["morning", "evening"],
    toolName: "job-search.briefing"
  }
};

const moduleWithoutBriefing: JsonJarvisModuleManifest = {
  ...baseManifest,
  id: "no-briefing",
  name: "No Briefing"
};

const actorUserId = "user-1";
const requestId = "req-1";

function baseArgs(overrides: Partial<Parameters<typeof collectExternalBriefingContributions>[0]>) {
  return {
    manifests: [moduleWithBriefing, moduleWithoutBriefing],
    selectedToolNames: [moduleWithBriefing.briefing!.toolName],
    section: "morning" as const,
    actorUserId,
    requestId,
    invoke: vi.fn(),
    ...overrides
  };
}

describe("collectExternalBriefingContributions (#1282)", () => {
  it("invokes only modules that declare a briefing handler, with the exact argument object", async () => {
    const invoke = vi.fn().mockResolvedValue({ headline: "Two new leads", items: [] });

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    // Assert the argument, not just the call count — a caller that passes the wrong actor
    // would still be "called once".
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({
      moduleId: moduleWithBriefing.id,
      handler: "briefing.contribute",
      actorUserId,
      requestId,
      section: "morning"
    });
    expect(result).toEqual<BriefingContribution[]>([
      { moduleId: moduleWithBriefing.id, headline: "Two new leads", items: [] }
    ]);
  });

  it("skips a module the user has not selected", async () => {
    const invoke = vi.fn().mockResolvedValue({ headline: "Should not run", items: [] });

    const result = await collectExternalBriefingContributions(
      baseArgs({ invoke, selectedToolNames: [] })
    );

    // Catches an implementation that invokes first and filters after, which would run a
    // worker the user has switched off.
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("skips a module that does not declare this section", async () => {
    const morningOnly: JsonJarvisModuleManifest = {
      ...moduleWithBriefing,
      briefing: { ...moduleWithBriefing.briefing!, sections: ["morning"] }
    };
    const invoke = vi.fn().mockResolvedValue({ headline: "Should not run", items: [] });

    const result = await collectExternalBriefingContributions(
      baseArgs({
        invoke,
        manifests: [morningOnly],
        selectedToolNames: [morningOnly.briefing!.toolName],
        section: "evening"
      })
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("drops a module whose handler throws without failing the briefing", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("worker unreachable"));

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    // No rejection — this call must resolve, not throw.
    expect(result).toEqual([]);
  });

  it("drops a wrongly-shaped contribution rather than trusting it", async () => {
    const invoke = vi.fn().mockResolvedValue({ headline: 42 });

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    expect(result).toEqual([]);
  });

  it("drops one malformed item without discarding the whole contribution", async () => {
    const invoke = vi.fn().mockResolvedValue({
      headline: "Mixed batch",
      items: [
        { id: "1", title: "Good item", detail: "This one is well-formed" },
        { id: 123 } // malformed: id must be a non-empty string, title/detail missing
      ]
    });

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    expect(result).toHaveLength(1);
    expect(result[0]!.items).toEqual([
      { id: "1", title: "Good item", detail: "This one is well-formed" }
    ]);
  });

  it("caps items at MAX_ITEMS", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `item-${i}`,
      title: `Title ${i}`,
      detail: `Detail ${i}`
    }));
    const invoke = vi.fn().mockResolvedValue({ headline: "Flood", items });

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    expect(result[0]!.items).toHaveLength(MAX_ITEMS);
  });

  it("drops a non-relative-path href, not emitting it", async () => {
    const invoke = vi.fn().mockResolvedValue({
      headline: "Untrusted href",
      items: [
        {
          id: "1",
          title: "Item",
          detail: "Has a hostile href",
          href: "javascript:alert(1)"
        }
      ]
    });

    const result = await collectExternalBriefingContributions(baseArgs({ invoke }));

    // Assert absence of the property, not href: undefined — a renderer might still
    // stringify an explicit undefined value.
    expect(result[0]!.items[0]).not.toHaveProperty("href");
  });
});
