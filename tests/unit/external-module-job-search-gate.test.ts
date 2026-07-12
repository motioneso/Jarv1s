// tests/unit/external-module-job-search-gate.test.ts
//
// JS-07 (#936) Step 3: deterministic gate. The gate may reject or flag ONLY
// from explicit structured facts (spec §deterministic-gate); anything
// missing or unparseable is unknown and NEVER a rejection. Profile field
// values arrive untyped (ProfileRevision.fields is Record<string, unknown>)
// so every reader parses defensively. Sponsorship and industry exclusion
// have no structured posting-side counterpart, so they stay unknown here by
// construction — the AI evaluation sees them via the profile instead.
import { describe, expect, it } from "vitest";

import { applyGate } from "../../external-modules/job-search/src/domain/gate.js";
import type { OpportunityRecord } from "../../external-modules/job-search/src/domain/opportunities.js";

const HASH = "0123456789abcdef0123456789abcdef";

function makeRecord(
  posting: Partial<OpportunityRecord["posting"]> = {},
  overrides: Partial<Omit<OpportunityRecord, "posting">> = {}
): OpportunityRecord {
  return {
    schemaVersion: 1,
    identityHash: HASH,
    adapterId: "greenhouse",
    status: "new",
    statusAt: "2026-07-11T09:00:00.000Z",
    firstSeenAt: "2026-07-11T09:00:00.000Z",
    lastSeenAt: "2026-07-11T09:00:00.000Z",
    contentHash: HASH,
    ...overrides,
    posting: {
      title: "Software Engineer",
      company: "Acme",
      description: "Build things.",
      descriptionTruncated: false,
      ...posting
    }
  };
}

describe("deterministic gate (JS-07)", () => {
  it("empty profile + fresh record passes every gate", () => {
    const result = applyGate({}, makeRecord());
    expect(result).toEqual({ verdict: "eligible", reasons: [] });
  });

  it("stale freshness is authoritative closure — excluded even with empty profile", () => {
    const result = applyGate({}, makeRecord({}, { freshness: "stale" }));
    expect(result.verdict).toBe("excluded");
    expect(result.reasons).toContain("stale_posting");
  });

  it("uncertain/absent freshness is unknown, not closure", () => {
    expect(applyGate({}, makeRecord({}, { freshness: "uncertain" })).verdict).toBe("eligible");
    expect(applyGate({}, makeRecord({}, { freshness: "active" })).verdict).toBe("eligible");
  });

  describe("excluded companies", () => {
    it("matches case-insensitively with whitespace tolerance", () => {
      const result = applyGate(
        { excludedCompanies: ["  ACME  ", "Globex"] },
        makeRecord({ company: "acme" })
      );
      expect(result.verdict).toBe("excluded");
      expect(result.reasons).toContain("excluded_company");
    });

    it("non-matching company passes", () => {
      const result = applyGate({ excludedCompanies: ["Globex"] }, makeRecord({ company: "Acme" }));
      expect(result.verdict).toBe("eligible");
    });

    it("malformed field values are unknown, never a rejection", () => {
      expect(applyGate({ excludedCompanies: "Acme" }, makeRecord()).verdict).toBe("eligible");
      expect(applyGate({ excludedCompanies: [42, null] }, makeRecord()).verdict).toBe("eligible");
      expect(applyGate({ excludedCompanies: { company: "Acme" } }, makeRecord()).verdict).toBe(
        "eligible"
      );
    });
  });

  describe("employment type", () => {
    it("normalizes punctuation/case on both sides before comparing", () => {
      const profile = { employmentTypes: ["Full-Time", "contract"] };
      expect(applyGate(profile, makeRecord({ employmentType: "full time" })).verdict).toBe(
        "eligible"
      );
      expect(applyGate(profile, makeRecord({ employmentType: "FULL_TIME" })).verdict).toBe(
        "eligible"
      );
    });

    it("posting type outside the profile's set is excluded", () => {
      const result = applyGate(
        { employmentTypes: ["full-time"] },
        makeRecord({ employmentType: "internship" })
      );
      expect(result.verdict).toBe("excluded");
      expect(result.reasons).toContain("employment_type_incompatible");
    });

    it("missing posting type or empty profile set is unknown/no-preference", () => {
      expect(applyGate({ employmentTypes: ["full-time"] }, makeRecord()).verdict).toBe("eligible");
      expect(
        applyGate({ employmentTypes: [] }, makeRecord({ employmentType: "internship" })).verdict
      ).toBe("eligible");
    });
  });

  describe("work mode", () => {
    it("accepts remotePreference as a single string", () => {
      const result = applyGate({ remotePreference: "remote" }, makeRecord({ workMode: "onsite" }));
      expect(result.verdict).toBe("excluded");
      expect(result.reasons).toContain("work_mode_incompatible");
    });

    it("accepts remotePreference as an array and passes members", () => {
      const profile = { remotePreference: ["remote", "hybrid"] };
      expect(applyGate(profile, makeRecord({ workMode: "hybrid" })).verdict).toBe("eligible");
      expect(applyGate(profile, makeRecord({ workMode: "onsite" })).verdict).toBe("excluded");
    });

    it("missing work mode or unparseable preference is unknown", () => {
      expect(applyGate({ remotePreference: "remote" }, makeRecord()).verdict).toBe("eligible");
      expect(
        applyGate({ remotePreference: "office" }, makeRecord({ workMode: "onsite" })).verdict
      ).toBe("eligible");
      expect(applyGate({ remotePreference: 42 }, makeRecord({ workMode: "onsite" })).verdict).toBe(
        "eligible"
      );
    });
  });

  describe("compensation minimum", () => {
    const profile = { compensation: { currency: "USD", minimum: 150_000 } };

    it("excludes when the parsed annual maximum is below the confirmed minimum", () => {
      const result = applyGate(profile, makeRecord({ compensation: "$120k - $140k" }));
      expect(result.verdict).toBe("excluded");
      expect(result.reasons).toContain("compensation_below_minimum");
    });

    it("passes when the range reaches the minimum", () => {
      expect(applyGate(profile, makeRecord({ compensation: "$120,000 - $180,000" })).verdict).toBe(
        "eligible"
      );
    });

    it("explicit currency codes parse too", () => {
      const result = applyGate(profile, makeRecord({ compensation: "100,000 - 120,000 USD" }));
      expect(result.verdict).toBe("excluded");
    });

    it("currency mismatch is unknown, not a comparison", () => {
      expect(applyGate(profile, makeRecord({ compensation: "€120,000" })).verdict).toBe("eligible");
    });

    it("non-annual periodicity is unknown (no hourly-vs-annual comparisons)", () => {
      expect(applyGate(profile, makeRecord({ compensation: "$60 per hour" })).verdict).toBe(
        "eligible"
      );
      expect(applyGate(profile, makeRecord({ compensation: "$500/day" })).verdict).toBe("eligible");
    });

    it("unparseable text, missing field, or unconfirmed profile minimum is unknown", () => {
      expect(applyGate(profile, makeRecord({ compensation: "competitive" })).verdict).toBe(
        "eligible"
      );
      expect(applyGate(profile, makeRecord()).verdict).toBe("eligible");
      expect(
        applyGate(
          { compensation: { minimum: 150_000 } }, // no currency → not confirmed
          makeRecord({ compensation: "$100k" })
        ).verdict
      ).toBe("eligible");
      expect(
        applyGate(
          { compensation: "150k USD" }, // not the structured object shape
          makeRecord({ compensation: "$100k" })
        ).verdict
      ).toBe("eligible");
    });

    it("numeric-string minimum parses defensively", () => {
      const result = applyGate(
        { compensation: { currency: "USD", minimum: "150000" } },
        makeRecord({ compensation: "$120k" })
      );
      expect(result.verdict).toBe("excluded");
    });
  });

  describe("dealbreakers (flag, not exclude — free text cannot confirm)", () => {
    it("flags a dealbreaker phrase found in the description", () => {
      const result = applyGate(
        { dealbreakers: ["on-call"] },
        makeRecord({ description: "Weekly on-call rotation required." })
      );
      expect(result.verdict).toBe("flagged");
      expect(result.reasons).toContain("dealbreaker_match:on-call");
    });

    it("matches in the title, case-insensitively", () => {
      const result = applyGate(
        { dealbreakers: ["Crypto"] },
        makeRecord({ title: "Senior crypto exchange engineer" })
      );
      expect(result.verdict).toBe("flagged");
      expect(result.reasons).toContain("dealbreaker_match:crypto");
    });

    it("no match, short/empty entries, or malformed field stays eligible", () => {
      expect(applyGate({ dealbreakers: ["on-call"] }, makeRecord()).verdict).toBe("eligible");
      expect(applyGate({ dealbreakers: ["", "  ", "ab"] }, makeRecord()).verdict).toBe("eligible");
      expect(applyGate({ dealbreakers: "on-call" }, makeRecord()).verdict).toBe("eligible");
    });
  });

  describe("location (flag only when onsite is confirmed)", () => {
    const profile = { locations: ["Toronto", "Vancouver"] };

    it("flags an onsite posting with no location overlap", () => {
      const result = applyGate(
        profile,
        makeRecord({ workMode: "onsite", location: "Berlin, Germany" })
      );
      expect(result.verdict).toBe("flagged");
      expect(result.reasons).toContain("location_mismatch");
    });

    it("substring overlap in either direction passes", () => {
      expect(
        applyGate(profile, makeRecord({ workMode: "onsite", location: "Toronto, ON" })).verdict
      ).toBe("eligible");
      expect(
        applyGate(
          { locations: ["Toronto, Canada"] },
          makeRecord({ workMode: "onsite", location: "Toronto" })
        ).verdict
      ).toBe("eligible");
    });

    it("unconfirmed work mode, remote/hybrid, or missing location is unknown", () => {
      expect(applyGate(profile, makeRecord({ location: "Berlin" })).verdict).toBe("eligible");
      expect(
        applyGate(profile, makeRecord({ workMode: "remote", location: "Berlin" })).verdict
      ).toBe("eligible");
      expect(applyGate(profile, makeRecord({ workMode: "onsite" })).verdict).toBe("eligible");
    });
  });

  it("excluded outranks flagged; all firing reasons are collected", () => {
    const result = applyGate(
      { excludedCompanies: ["Acme"], dealbreakers: ["on-call"] },
      makeRecord({ description: "on-call rotation" })
    );
    expect(result.verdict).toBe("excluded");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["excluded_company", "dealbreaker_match:on-call"])
    );
  });

  it("does not mutate its inputs", () => {
    const record = makeRecord({ workMode: "onsite" }, { freshness: "stale" });
    const snapshot = JSON.stringify(record);
    const fields = { excludedCompanies: ["Acme"] };
    applyGate(fields, record);
    expect(JSON.stringify(record)).toBe(snapshot);
    expect(fields).toEqual({ excludedCompanies: ["Acme"] });
  });
});
