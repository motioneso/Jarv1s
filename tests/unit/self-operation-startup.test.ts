import { describe, expect, it } from "vitest";

import { assertBuiltInSelfOperationManifests } from "@jarv1s/ai";
import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import type { ModuleAssistantToolManifest } from "@jarv1s/module-sdk";

/**
 * Regression coverage for the `assertBuiltInSelfOperationManifests(getBuiltInModuleManifests())`
 * call `apps/api/src/server.ts` runs in an `onReady` hook (server cannot become ready if it
 * throws). Exercised directly against the real built-in registry rather than by booting a full
 * `createApiServer` instance, which needs a live DB/pg-boss and is out of proportion to what
 * this hook actually touches (pure functions, no I/O).
 */
describe("built-in self-operation startup assertion", () => {
  it("built-in server startup fails closed on an unclassified built-in write tool", () => {
    const manifests = getBuiltInModuleManifests();

    expect(() => assertBuiltInSelfOperationManifests(manifests)).not.toThrow();

    const driftedTool: ModuleAssistantToolManifest = {
      name: "memory.driftedWrite",
      description: "Simulates a future built-in write tool that regressed to unclassified.",
      permissionId: "memory.manage",
      risk: "write"
    };
    const memoryManifest = manifests.find((manifest) => manifest.id === "memory");
    expect(memoryManifest, "expected a built-in memory manifest to exist").toBeDefined();

    const driftedManifests = manifests.map((manifest) =>
      manifest.id === "memory"
        ? { ...manifest, assistantTools: [...(manifest.assistantTools ?? []), driftedTool] }
        : manifest
    );

    expect(() => assertBuiltInSelfOperationManifests(driftedManifests)).toThrow(
      /memory.driftedWrite.*unclassified/
    );
  });

  it("built-in startup assertion deliberately excludes external manifests tracked by #1267", () => {
    const manifests = getBuiltInModuleManifests();

    // The real built-in inventory alone must pass — this is what actually gates startup.
    expect(() => assertBuiltInSelfOperationManifests(manifests)).not.toThrow();

    // An external-shaped manifest cannot declare actionFamilyId (its ABI does not support it),
    // so a write tool from one would always look unclassified to this assertion. Feeding
    // external manifests into the startup call would therefore fail closed on modules #1263
    // never intended to police — proving the server's exclusion of them is deliberate, not an
    // oversight. #1267 owns making external tools safe on their own terms; today they are safe
    // unconditionally via packages/ai/src/gateway/policy.ts:40.
    const externalShapedManifest = {
      id: "external-example",
      assistantTools: [
        {
          name: "external-example.write",
          description: "A hypothetical external module write tool.",
          permissionId: "external-example.manage",
          risk: "write"
        } satisfies ModuleAssistantToolManifest
      ]
    };

    expect(() =>
      assertBuiltInSelfOperationManifests([...manifests, externalShapedManifest])
    ).toThrow(/external-example\.write.*unclassified/);
  });
});
