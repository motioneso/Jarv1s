import { describe, expect, it } from "vitest";

import {
  assertSnapshotPayload,
  NEWS_SNAPSHOT_MAX_ARTICLES,
  NEWS_SNAPSHOT_MAX_STRING_LENGTH,
  NEWS_SNAPSHOT_MAX_TOTAL_BYTES,
  normalizePublisherDomain,
  publisherDomainMatches
} from "../../packages/news/src/personalization-domain.js";
import {
  createNewsSourceExclusionSchema,
  deleteNewsSourceExclusionSchema,
  getNewsPersonalizationSchema
} from "@jarv1s/shared";

// #953 Task 2 — pure domain normalization and the provisional snapshot storage guard.
// The normalizer is the single parse path for publisher domains (exclusions in Slice 1,
// custom sources in Slice 2): security posture is reject-by-default (credentials, ports,
// IP literals, non-HTTPS schemes) per the spec's SSRF/IDN hardening requirements.

describe("normalizePublisherDomain", () => {
  const accepted: ReadonlyArray<{ input: string; domain: string }> = [
    { input: "example.com", domain: "example.com" },
    { input: "Example.COM", domain: "example.com" },
    { input: "  example.com  ", domain: "example.com" },
    // Trailing dot is FQDN notation, not a distinct host.
    { input: "example.com.", domain: "example.com" },
    { input: "https://example.com", domain: "example.com" },
    { input: "https://example.com/", domain: "example.com" },
    { input: "https://www.example.com/politics/article?id=1#frag", domain: "www.example.com" },
    // Never blindly strip www — www.example.com and example.com stay distinct.
    { input: "www.example.com", domain: "www.example.com" },
    { input: "sub.news.example.co.uk", domain: "sub.news.example.co.uk" },
    // Non-ASCII IDN normalizes to punycode ASCII, lowercased.
    { input: "münchen.de", domain: "xn--mnchen-3ya.de" },
    { input: "https://МОСКВА.рф", domain: "xn--80adxhks.xn--p1ai" },
    // Schemeless host+path reads as an HTTPS URL; only the hostname is kept.
    { input: "example.com/section/page", domain: "example.com" }
  ];

  it.each(accepted)("accepts $input -> $domain", ({ input, domain }) => {
    expect(normalizePublisherDomain(input)).toEqual({ ok: true, domain });
  });

  const rejected: ReadonlyArray<{ input: string; label: string }> = [
    { input: "", label: "empty string" },
    { input: "   ", label: "whitespace only" },
    { input: "http://example.com", label: "non-HTTPS scheme" },
    { input: "ftp://example.com", label: "ftp scheme" },
    { input: "javascript:alert(1)", label: "javascript scheme" },
    { input: "https://user:pass@example.com", label: "credentials" },
    { input: "https://user@example.com", label: "username only" },
    { input: "user@example.com", label: "bare host with userinfo" },
    { input: "https://example.com:8443", label: "explicit port" },
    { input: "example.com:8443", label: "bare host with port" },
    { input: "https://192.168.0.1", label: "IPv4 literal" },
    { input: "192.168.0.1", label: "bare IPv4 literal" },
    { input: "https://0x7f000001", label: "hex IPv4 literal (URL-canonicalized)" },
    { input: "https://[::1]", label: "IPv6 literal" },
    { input: "localhost", label: "single-label host" },
    { input: "exa mple.com", label: "whitespace in host" },
    { input: "-bad.example.com", label: "leading hyphen label" },
    { input: `${"a".repeat(64)}.example.com`, label: "label over 63 chars" },
    { input: `${"a.".repeat(130)}com`, label: "hostname over 253 chars" },
    { input: `https://example.com/${"a".repeat(2048)}`, label: "input over 2048 chars" }
  ];

  it.each(rejected)("rejects $label", ({ input }) => {
    expect(normalizePublisherDomain(input).ok).toBe(false);
  });
});

describe("publisherDomainMatches", () => {
  it("matches the exact stored domain", () => {
    expect(publisherDomainMatches("example.com", "example.com")).toBe(true);
  });

  it("matches subdomains of the stored domain", () => {
    expect(publisherDomainMatches("example.com", "news.example.com")).toBe(true);
    expect(publisherDomainMatches("example.com", "a.b.example.com")).toBe(true);
  });

  it("does NOT match suffix-similar but distinct hosts", () => {
    expect(publisherDomainMatches("example.com", "notexample.com")).toBe(false);
  });

  it("does NOT match when the stored domain appears as a prefix trick", () => {
    expect(publisherDomainMatches("example.com", "example.com.evil.com")).toBe(false);
  });

  it("does NOT match parents of the stored domain (exclusion is not upward)", () => {
    expect(publisherDomainMatches("news.example.com", "example.com")).toBe(false);
  });
});

describe("assertSnapshotPayload (provisional Slice 1 storage guard)", () => {
  const article = (overrides: Record<string, unknown> = {}) => ({
    title: "A headline",
    url: "https://example.com/a",
    ...overrides
  });

  it("accepts an object with an empty articles array", () => {
    expect(() => assertSnapshotPayload({ articles: [] })).not.toThrow();
  });

  it("accepts exactly the max article count", () => {
    const payload = {
      articles: Array.from({ length: NEWS_SNAPSHOT_MAX_ARTICLES }, () => article())
    };
    expect(() => assertSnapshotPayload(payload)).not.toThrow();
  });

  it("rejects one article over the cap", () => {
    const payload = {
      articles: Array.from({ length: NEWS_SNAPSHOT_MAX_ARTICLES + 1 }, () => article())
    };
    expect(() => assertSnapshotPayload(payload)).toThrow(/articles/);
  });

  it.each([
    { value: null, label: "null" },
    { value: [], label: "array root" },
    { value: "articles", label: "string root" },
    { value: 42, label: "number root" }
  ])("rejects non-object root: $label", ({ value }) => {
    expect(() => assertSnapshotPayload(value)).toThrow();
  });

  it("rejects a payload whose articles is not an array", () => {
    expect(() => assertSnapshotPayload({ articles: {} })).toThrow(/articles/);
  });

  it("rejects an article entry that is not an object", () => {
    expect(() => assertSnapshotPayload({ articles: ["headline"] })).toThrow();
  });

  it("rejects any string over the per-string cap", () => {
    const payload = {
      articles: [article({ title: "x".repeat(NEWS_SNAPSHOT_MAX_STRING_LENGTH + 1) })]
    };
    expect(() => assertSnapshotPayload(payload)).toThrow(/string/i);
  });

  it("rejects excessive nesting", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i += 1) deep = { nested: deep };
    expect(() => assertSnapshotPayload({ articles: [article({ extra: deep })] })).toThrow(
      /depth|nest/i
    );
  });

  it.each([
    { value: () => undefined, label: "function" },
    { value: undefined, label: "undefined" },
    { value: 10n, label: "bigint" },
    { value: Number.NaN, label: "NaN" },
    { value: Number.POSITIVE_INFINITY, label: "Infinity" }
  ])("rejects non-JSON value: $label", ({ value }) => {
    expect(() => assertSnapshotPayload({ articles: [article({ bad: value })] })).toThrow();
  });

  it("rejects a payload over the total serialized-bytes cap", () => {
    // Many near-cap strings blow the total budget while each string stays legal.
    const count = Math.ceil(NEWS_SNAPSHOT_MAX_TOTAL_BYTES / NEWS_SNAPSHOT_MAX_STRING_LENGTH) + 1;
    const payload = {
      articles: [article()],
      padding: Array.from({ length: count }, () => "y".repeat(NEWS_SNAPSHOT_MAX_STRING_LENGTH))
    };
    expect(() => assertSnapshotPayload(payload)).toThrow(/bytes|size/i);
  });
});

describe("news personalization API schemas", () => {
  it("GET personalization response declares availability, lists, and snapshot metadata only", () => {
    const response = getNewsPersonalizationSchema.response[200];
    expect(response.additionalProperties).toBe(false);
    expect(response.required).toEqual([
      "availability",
      "customSources",
      "customTopics",
      "sourceExclusions",
      "snapshot"
    ]);
    // Snapshot exposes metadata only — never the payload.
    const snapshot = response.properties.snapshot;
    expect(JSON.stringify(snapshot)).not.toContain("payload");
    // DTOs must not leak validation fingerprints or provider identity.
    expect(JSON.stringify(response)).not.toContain("fingerprint");
    expect(JSON.stringify(response)).not.toContain("provider");
    expect(JSON.stringify(response)).not.toContain("model");
  });

  it("create-exclusion request is a single bounded source string", () => {
    const body = createNewsSourceExclusionSchema.body;
    expect(body.additionalProperties).toBe(false);
    expect(body.required).toEqual(["source"]);
    expect(body.properties.source.maxLength).toBe(2048);
    expect(body.properties.source.minLength).toBe(1);
  });

  it("delete-exclusion params require a uuid id", () => {
    expect(deleteNewsSourceExclusionSchema.params.properties.id.format).toBe("uuid");
  });
});
