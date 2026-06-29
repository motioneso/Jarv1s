import { describe, expect, it } from "vitest";
import { normalizeIdentity, candidateSignature } from "../matching.js";

describe("normalizeIdentity", () => {
  it("lowercases and trims email addresses", () => {
    expect(normalizeIdentity("email_address", " Alice@Example.COM ")).toBe("alice@example.com");
  });
  it("returns trimmed lowercase for source_identity", () => {
    expect(normalizeIdentity("source_identity", "  SRC:123  ")).toBe("src:123");
  });
  it("trims only for alias", () => {
    expect(normalizeIdentity("alias", "  Alice  ")).toBe("Alice");
  });
  it("trims only for display_name", () => {
    expect(normalizeIdentity("display_name", "  Bob Smith  ")).toBe("Bob Smith");
  });
});

describe("candidateSignature", () => {
  it("produces stable hash for same inputs regardless of order", () => {
    const a = candidateSignature("merge_people", ["uuid-1", "uuid-2"]);
    const b = candidateSignature("merge_people", ["uuid-2", "uuid-1"]);
    expect(a).toBe(b);
  });
  it("differs for different candidate kinds", () => {
    const a = candidateSignature("link_identity", ["uuid-1"]);
    const b = candidateSignature("create_person", ["uuid-1"]);
    expect(a).not.toBe(b);
  });
  it("produces 32-char hex string", () => {
    const sig = candidateSignature("merge_people", ["uuid-1"]);
    expect(sig).toMatch(/^[a-f0-9]{32}$/);
  });
});
