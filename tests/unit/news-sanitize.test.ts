import { describe, expect, it } from "vitest";

import {
  decodeEntities,
  sanitizeFeedText,
  sanitizeImageUrl,
  sanitizeItemUrl,
  sanitizePublishedAt,
  SUMMARY_CHAR_CAP,
  TITLE_CHAR_CAP
} from "../../packages/news/src/source/sanitize.js";

// #897: feed text is untrusted third-party content rendered into the app shell. The sanitizer is
// the only layer between raw RSS/Atom payloads and React text nodes, so these tests are hostile
// by design — the LLM-field-exfiltration lesson applies to feeds too: one guard is never enough,
// so the strip→decode→strip pipeline gets exercised at each stage.
describe("sanitizeFeedText (#897)", () => {
  it("strips plain HTML tags including script bodies' angle brackets", () => {
    const result = sanitizeFeedText("<script>alert(1)</script>Fuel prices rise", 500);
    expect(result).not.toMatch(/[<>]/);
    expect(result).toContain("Fuel prices rise");
  });

  it("strips tags that only appear AFTER entity decoding (double-encoded payload)", () => {
    // &lt;script&gt; survives the first strip pass untouched; if decode ran last, the caller
    // would receive live markup. The second strip + bracket scrub close that hole.
    const result = sanitizeFeedText("&lt;script&gt;alert(1)&lt;/script&gt;headline", 500);
    expect(result).not.toMatch(/[<>]/);
  });

  it("strips inline event handlers with the tag they ride on", () => {
    const result = sanitizeFeedText(`before <img src=x onerror=alert(1)> after`, 500);
    expect(result).not.toContain("onerror");
    expect(result).toBe("before after");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFeedText("  a \n\n  b\t c  ", 500)).toBe("a b c");
  });

  it("returns empty string for null/undefined", () => {
    expect(sanitizeFeedText(null, 500)).toBe("");
    expect(sanitizeFeedText(undefined, 500)).toBe("");
  });

  it("caps at the last word boundary when one exists past 60% of the cap", () => {
    // clipped = "one two th", last space at 7 > 10*0.6 → cut at the space, ellipsis appended.
    expect(sanitizeFeedText("one two three four", 10)).toBe("one two…");
  });

  it("hard-cuts when there is no usable word boundary (single long token)", () => {
    expect(sanitizeFeedText("a".repeat(40), 10)).toBe(`${"a".repeat(10)}…`);
  });

  it("keeps the shipped caps stable (titles 300 / summaries 500)", () => {
    // The card layout budgets line counts around these; a silent bump reflows every mosaic slot.
    expect(TITLE_CHAR_CAP).toBe(300);
    expect(SUMMARY_CHAR_CAP).toBe(500);
  });
});

describe("decodeEntities (#897)", () => {
  it("decodes named, decimal, and hex entities", () => {
    expect(decodeEntities("Fish &amp; Chips")).toBe("Fish & Chips");
    expect(decodeEntities("dash&#8230;")).toBe("dash…");
    expect(decodeEntities("it&#x2019;s")).toBe("it’s");
  });

  it("leaves an out-of-range codepoint as literal text instead of throwing", () => {
    // String.fromCodePoint(0x110000) throws RangeError; a feed must not be able to crash parsing.
    expect(decodeEntities("bad &#x110000; ref")).toBe("bad &#x110000; ref");
  });
});

describe("sanitizeItemUrl (#897)", () => {
  it("keeps http(s) URLs", () => {
    expect(sanitizeItemUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(sanitizeItemUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("rejects javascript:/data:/other schemes — these become anchor hrefs in the UI", () => {
    expect(sanitizeItemUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeItemUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeItemUrl("ftp://example.com/f")).toBeNull();
  });

  it("rejects unparseable garbage and empties", () => {
    expect(sanitizeItemUrl("not a url")).toBeNull();
    expect(sanitizeItemUrl("")).toBeNull();
    expect(sanitizeItemUrl(null)).toBeNull();
  });
});

describe("sanitizeImageUrl (#897)", () => {
  const hosts = ["ichef.bbci.co.uk"];

  it("keeps https images on an allow-listed host", () => {
    expect(sanitizeImageUrl("https://ichef.bbci.co.uk/img.png", hosts)).toBe(
      "https://ichef.bbci.co.uk/img.png"
    );
  });

  it("rejects plain http even on an allowed host (mixed content)", () => {
    expect(sanitizeImageUrl("http://ichef.bbci.co.uk/img.png", hosts)).toBeNull();
  });

  it("rejects hosts off the allow-list, including look-alike subdomains", () => {
    expect(sanitizeImageUrl("https://evil.example/img.png", hosts)).toBeNull();
    // Exact hostname match only — "ichef.bbci.co.uk.evil.example" must not pass a suffix check.
    expect(sanitizeImageUrl("https://ichef.bbci.co.uk.evil.example/img.png", hosts)).toBeNull();
  });
});

describe("sanitizePublishedAt (#897)", () => {
  it("normalizes RFC 822 (RSS2 pubDate) to ISO", () => {
    expect(sanitizePublishedAt("Thu, 09 Jul 2026 05:04:17 GMT")).toBe("2026-07-09T05:04:17.000Z");
  });

  it("normalizes ISO-with-offset (Atom) to UTC", () => {
    expect(sanitizePublishedAt("2026-07-08T18:37:25-04:00")).toBe("2026-07-08T22:37:25.000Z");
  });

  it("returns null for unparseable or missing dates instead of Invalid Date", () => {
    expect(sanitizePublishedAt("yesterday-ish")).toBeNull();
    expect(sanitizePublishedAt("")).toBeNull();
    expect(sanitizePublishedAt(null)).toBeNull();
  });
});
