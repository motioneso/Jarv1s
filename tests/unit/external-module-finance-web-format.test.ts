// tests/unit/external-module-finance-web-format.test.ts
import { describe, expect, it } from "vitest";

import {
  centsToAmountInput,
  parseAmountToCents
} from "../../external-modules/finance/src/web/format.js";

// FIN-03 (#1148) Task 4: the assign-input parser is the web side of the
// budget-apply params gate — anything it accepts must be a legal amountCents
// (integer, |cents| ≤ 100_000_000), and anything else must come back null so
// the screen keeps the previous value instead of enqueueing a bad job.

describe("parseAmountToCents", () => {
  it("parses plain dollars, currency symbols, and thousands separators", () => {
    expect(parseAmountToCents("50")).toBe(5000);
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
    expect(parseAmountToCents(" 1 234.5 ")).toBe(123450);
    expect(parseAmountToCents(".75")).toBe(75);
    expect(parseAmountToCents("0")).toBe(0);
  });

  it("accepts negative amounts (un-assigning money back to TBB)", () => {
    expect(parseAmountToCents("-20")).toBe(-2000);
    expect(parseAmountToCents("-$3.25")).toBe(-325);
  });

  it("rejects empty, garbage, and sub-cent precision", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("   ")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.3.4")).toBeNull();
    expect(parseAmountToCents("1e3")).toBeNull();
    expect(parseAmountToCents("5.999")).toBeNull();
    expect(parseAmountToCents("-")).toBeNull();
    expect(parseAmountToCents(".")).toBeNull();
  });

  it("rejects amounts beyond the manifest bound (±$1M in cents)", () => {
    expect(parseAmountToCents("1000000")).toBe(100_000_000);
    expect(parseAmountToCents("1000000.01")).toBeNull();
    expect(parseAmountToCents("-1000000.01")).toBeNull();
  });
});

describe("centsToAmountInput", () => {
  it("round-trips with the parser", () => {
    expect(centsToAmountInput(123456)).toBe("1234.56");
    expect(centsToAmountInput(0)).toBe("0.00");
    expect(centsToAmountInput(-2000)).toBe("-20.00");
    expect(parseAmountToCents(centsToAmountInput(37655))).toBe(37655);
  });
});
