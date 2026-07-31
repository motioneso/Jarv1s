import { describe, expect, it } from "vitest";
import { getAllQueueDefinitions } from "@jarv1s/module-registry";

describe("module-registry wiring (G3)", () => {
  it("registers the connectors.google-sync queue globally", () => {
    const names = getAllQueueDefinitions().map((q) => q.name);
    expect(names).toContain("connectors.google-sync");
  });
});
