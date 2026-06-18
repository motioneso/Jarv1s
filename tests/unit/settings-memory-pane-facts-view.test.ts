import { describe, expect, it } from "vitest";

import { partitionMemoryFacts } from "../../apps/web/src/settings/memory-facts-view.js";
import type { MemoryFact } from "../../apps/web/src/api/memory-client.js";

function fact(id: string, provenance: MemoryFact["provenance"]): MemoryFact {
  return {
    id,
    category: "preference",
    content: `Fact ${id}`,
    importance: 0.5,
    provenance,
    sourceThreadId: null,
    createdAt: "2026-06-15T00:00:00.000Z"
  };
}

describe("memory facts view model", () => {
  it("separates inferred patterns from remembered facts", () => {
    const result = partitionMemoryFacts([
      fact("volunteered", "volunteered"),
      fact("inferred-a", "inferred"),
      fact("confirmed", "confirmed"),
      fact("inferred-b", "inferred")
    ]);

    expect(result.remembered.map((f) => f.id)).toEqual(["volunteered", "confirmed"]);
    expect(result.inferred.map((f) => f.id)).toEqual(["inferred-a", "inferred-b"]);
  });
});
