import { getBuiltInModuleManifests } from "@jarv1s/module-registry";
import { describe, expect, it } from "vitest";

import { resolveQueryKeyToken } from "../../apps/web/src/api/query-keys.js";

describe("built-in module manifest affectsQueryKeys tokens", () => {
  const toolsWithTokens = getBuiltInModuleManifests().flatMap((manifest) =>
    (manifest.assistantTools ?? [])
      .filter((tool) => tool.affectsQueryKeys && tool.affectsQueryKeys.length > 0)
      .map((tool) => ({ moduleId: manifest.id, toolName: tool.name, tool }))
  );

  it("has at least one tool declaring affectsQueryKeys (sanity check the walk below runs)", () => {
    expect(toolsWithTokens.length).toBeGreaterThan(0);
  });

  it.each(
    toolsWithTokens.flatMap(({ moduleId, toolName, tool }) =>
      (tool.affectsQueryKeys ?? []).map((token) => ({ moduleId, toolName, token }))
    )
  )("$moduleId/$toolName declares a resolvable token: $token", ({ token }) => {
    const resolved = resolveQueryKeyToken(token);
    expect(resolved).toBeDefined();
    expect(Array.isArray(resolved)).toBe(true);
  });
});
