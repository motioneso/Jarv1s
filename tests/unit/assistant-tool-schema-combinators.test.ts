import { describe, expect, it } from "vitest";

import { getBuiltInModuleManifests } from "../../packages/module-registry/src/index.js";

/**
 * #1363 — a top-level `anyOf`/`oneOf`/`allOf` on a tool INPUT schema is valid JSON Schema, passes
 * our own validation, and sails through CI, but the Anthropic API rejects it and the CLI responds
 * by dropping the ENTIRE tool from the session. `app.getMapSlice` was missing from every chat for
 * exactly that reason, while the chat persona kept instructing the model to call it — so app
 * questions were answered from the model's priors instead of our declared app map, and nothing
 * anywhere reported a problem. The only trace was a line in the CLI's own MCP client log inside
 * the container.
 *
 * There is no way to express "at least one of these fields" in JSON Schema without a combinator,
 * so that rule belongs in the tool description and the execute handler, never in the schema.
 *
 * Scope is deliberate:
 *   - INPUT schemas only. Output schemas are not sent to the API as tool definitions, and
 *     `appGetMapSliceOutputSchema` legitimately uses a nested `anyOf` for a nullable object.
 *   - TOP LEVEL only. A combinator nested inside a property is fine; it is the root that breaks.
 */
const FORBIDDEN_ROOT_KEYWORDS = ["anyOf", "oneOf", "allOf", "not"] as const;

describe("assistant tool input schemas", () => {
  const manifests = getBuiltInModuleManifests();

  // A sweep over an empty list passes every assertion below, so prove the sweep is real before
  // trusting it. `app.getMapSlice` is named explicitly because it is the tool this test exists for:
  // if a refactor drops the settings manifest out of the registry, the guard must go red rather
  // than quietly stop covering the one schema that already broke once.
  it("actually reaches every built-in module's tools", () => {
    const toolNames = manifests.flatMap((manifest) =>
      (manifest.assistantTools ?? []).map((tool) => tool.name)
    );
    expect(manifests.length).toBeGreaterThan(15);
    expect(toolNames.length).toBeGreaterThan(60);
    expect(toolNames).toContain("app.getMapSlice");
  });

  it("never use a top-level combinator, which makes the API drop the whole tool", () => {
    const offenders: string[] = [];

    for (const manifest of manifests) {
      for (const tool of manifest.assistantTools ?? []) {
        const schema = tool.inputSchema as Record<string, unknown> | undefined;
        if (!schema || typeof schema !== "object") continue;
        for (const keyword of FORBIDDEN_ROOT_KEYWORDS) {
          if (keyword in schema) {
            offenders.push(`${tool.name} (top-level "${keyword}")`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
