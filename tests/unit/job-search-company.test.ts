// tests/unit/job-search-company.test.ts
//
// Pins the company-name normaliser against the exact strings a live board produced. Three of the
// cases below ("solana%20foundation", "cleric", "tradeify") were read off the real board and are
// the reason this function exists; "Fi" is the guard on the other side — a short, correctly-cased
// name that a looser slug heuristic would happily mangle into something else.
//
// The idempotency case is load-bearing, not decoration: the normaliser is applied on the write
// path (upsertPostings) AND on the read path (mapPosting), so every stored row that was cleaned on
// the way in gets cleaned a second time on the way out. If f(f(x)) ever stopped equalling f(x)
// that double application would silently corrupt names in production, and nothing else in the
// system would notice.
import { describe, expect, it } from "vitest";

import { normalizeCompanyName } from "../../external-modules/job-search/src/domain/company.js";

describe("normalizeCompanyName", () => {
  it("decodes percent-encoded names and title-cases the result", () => {
    expect(normalizeCompanyName("solana%20foundation")).toBe("Solana Foundation");
  });

  it("title-cases a bare lowercase slug", () => {
    expect(normalizeCompanyName("cleric")).toBe("Cleric");
    expect(normalizeCompanyName("tradeify")).toBe("Tradeify");
  });

  it("splits slug separators into words", () => {
    expect(normalizeCompanyName("acme-labs")).toBe("Acme Labs");
    expect(normalizeCompanyName("open_source_collective")).toBe("Open Source Collective");
  });

  // The whole point of the "no uppercase anywhere" test in looksLikeSlug: one authored capital is
  // taken as proof a human wrote the name, and nothing further is done to it. Without this guard
  // "eBay" becomes "Ebay" and "OpenAI" keeps its case only by luck.
  it("leaves an authored name alone", () => {
    expect(normalizeCompanyName("Fi")).toBe("Fi");
    expect(normalizeCompanyName("eBay")).toBe("eBay");
    expect(normalizeCompanyName("OpenAI")).toBe("OpenAI");
    expect(normalizeCompanyName("Solana Foundation")).toBe("Solana Foundation");
    // A hyphen in an authored name is punctuation, not a slug separator, so it survives.
    expect(normalizeCompanyName("Hewlett-Packard")).toBe("Hewlett-Packard");
  });

  it("collapses stray whitespace", () => {
    expect(normalizeCompanyName("  Acme   Corp  ")).toBe("Acme Corp");
  });

  // A literal "%" is legal in a name and must not be handed to a decoder that throws on it; a
  // string that only looks encoded must survive rather than vanish.
  it("survives a name that is not valid encoding", () => {
    expect(normalizeCompanyName("100% Remote Ltd")).toBe("100% Remote Ltd");
    expect(normalizeCompanyName("Discount %zz Co")).toBe("Discount %zz Co");
  });

  it("is idempotent, because it runs on both the write and the read path", () => {
    for (const raw of [
      "solana%20foundation",
      "cleric",
      "acme-labs",
      "Fi",
      "eBay",
      "100% Remote Ltd",
      "  Acme   Corp  "
    ]) {
      const once = normalizeCompanyName(raw);
      expect(normalizeCompanyName(once)).toBe(once);
    }
  });

  it("returns an empty string unchanged rather than throwing", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
  });
});
