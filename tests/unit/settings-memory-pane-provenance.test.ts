import { describe, expect, it } from "vitest";

import {
  getMemoryFactProvenanceLabel,
  getMemoryFactProvenanceTone
} from "../../apps/web/src/settings/memory-provenance.js";

describe("memory pane provenance view model", () => {
  it("maps backend provenance to concise user-facing labels", () => {
    expect(getMemoryFactProvenanceLabel("volunteered")).toBe("said");
    expect(getMemoryFactProvenanceLabel("inferred")).toBe("inferred");
    expect(getMemoryFactProvenanceLabel("confirmed")).toBe("confirmed");
  });

  it("maps provenance to stable badge tone classes", () => {
    expect(getMemoryFactProvenanceTone("volunteered")).toBe("memory-fact__provenance--said");
    expect(getMemoryFactProvenanceTone("inferred")).toBe("memory-fact__provenance--inferred");
    expect(getMemoryFactProvenanceTone("confirmed")).toBe("memory-fact__provenance--confirmed");
  });
});
