// tests/unit/external-module-job-search-kv-keys.test.ts
//
// JS-02 (#931) Task 2: identity hashes + key ABI. Keys carry ids and hashes
// only — never prose, URLs, or titles — so key listings can't leak private
// content. JS-03/05/06 root on these exact key strings; the ABI asserts here
// are a compatibility contract, not implementation detail.
import { describe, expect, it } from "vitest";

import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import {
  assertId,
  contentHash,
  evaluationIdentity,
  keys,
  opportunityIdentity
} from "../../external-modules/job-search/src/domain/keys.js";

const HEX_32 = /^[0-9a-f]{32}$/;

function expectKvErrorSync(fn: () => unknown, code: string): void {
  let error: unknown = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(JobSearchKvError);
  expect((error as JobSearchKvError).code).toBe(code);
}

describe("opportunityIdentity", () => {
  it("is deterministic 32-hex for adapter + externalId", () => {
    const a = opportunityIdentity({ adapterId: "greenhouse", externalId: "job-123" });
    const b = opportunityIdentity({ adapterId: "greenhouse", externalId: "job-123" });
    expect(a).toMatch(HEX_32);
    expect(a).toBe(b);
  });

  it("differs across adapters for the same externalId", () => {
    const a = opportunityIdentity({ adapterId: "greenhouse", externalId: "job-123" });
    const b = opportunityIdentity({ adapterId: "lever", externalId: "job-123" });
    expect(a).not.toBe(b);
  });

  it("prefers adapter/external-id over URL: canonicalUrl is ignored when externalId present", () => {
    const withUrl = opportunityIdentity({
      adapterId: "greenhouse",
      externalId: "job-123",
      canonicalUrl: "https://example.com/a"
    });
    const withOtherUrl = opportunityIdentity({
      adapterId: "greenhouse",
      externalId: "job-123",
      canonicalUrl: "https://example.com/b"
    });
    expect(withUrl).toBe(withOtherUrl);
  });

  it("falls back to canonicalUrl only when externalId is absent", () => {
    const urlOnly = opportunityIdentity({
      adapterId: "greenhouse",
      canonicalUrl: "https://example.com/a"
    });
    expect(urlOnly).toMatch(HEX_32);
    const idBased = opportunityIdentity({
      adapterId: "greenhouse",
      externalId: "https://example.com/a"
    });
    // Distinct derivation paths must not collide even on equal raw strings.
    expect(urlOnly).not.toBe(idBased);
  });

  it("throws invalid_record when both externalId and canonicalUrl are missing", () => {
    expectKvErrorSync(() => opportunityIdentity({ adapterId: "greenhouse" }), "invalid_record");
  });
});

describe("contentHash / evaluationIdentity", () => {
  it("contentHash is deterministic 32-hex and content-sensitive", () => {
    expect(contentHash("Senior Engineer at Acme")).toMatch(HEX_32);
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("evaluationIdentity varies with every tuple member", () => {
    const base = {
      opportunityContentHash: contentHash("posting"),
      profileRevisionId: "p1",
      resumeRevisionId: "r1"
    };
    const id = evaluationIdentity(base);
    expect(id).toMatch(HEX_32);
    expect(evaluationIdentity({ ...base })).toBe(id);
    expect(evaluationIdentity({ ...base, opportunityContentHash: contentHash("other") })).not.toBe(
      id
    );
    expect(evaluationIdentity({ ...base, profileRevisionId: "p2" })).not.toBe(id);
    expect(evaluationIdentity({ ...base, resumeRevisionId: "r2" })).not.toBe(id);
  });
});

describe("assertId", () => {
  it("accepts URL-safe ids up to 64 chars", () => {
    expect(() => assertId("greenhouse_123-A")).not.toThrow();
    expect(() => assertId("a".repeat(64))).not.toThrow();
  });

  it.each([
    ["space", "a b"],
    ["slash", "x/y"],
    ["65 chars", "a".repeat(65)],
    ["empty", ""]
  ])("rejects %s as invalid_record", (_label, bad) => {
    expectKvErrorSync(() => assertId(bad), "invalid_record");
  });
});

describe("key ABI", () => {
  it("produces the exact key strings JS-03/05/06 depend on", () => {
    const h = "0123456789abcdef0123456789abcdef";
    expect(keys.onboardingState).toBe("state");
    expect(keys.profileActive).toBe("active");
    expect(keys.profileRevision("r1")).toBe("revision/r1");
    expect(keys.resumeActive).toBe("active");
    expect(keys.resumeRevision("0")).toBe("revision/0");
    expect(keys.monitor("m1")).toBe("monitor/m1");
    expect(keys.monitorCursor("m1")).toBe("cursor/m1");
    expect(keys.job(h)).toBe(`job/${h}`);
    expect(keys.tombstone(h)).toBe(`tombstone/${h}`);
    expect(keys.run("m1", "r9")).toBe("run/m1/r9");
    expect(keys.runLatest("m1")).toBe("monitor/m1/latest");
    expect(keys.feedActive).toBe("active");
  });
});
