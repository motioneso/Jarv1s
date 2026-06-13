import { describe, expect, it } from "vitest";

import { CORE_VERSION, satisfiesCoreVersion } from "@jarv1s/module-sdk";

describe("CORE_VERSION", () => {
  it("is the single source of truth for the module-API version", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });
});

describe("satisfiesCoreVersion", () => {
  it("admits every range form in use today (defaults to CORE_VERSION)", () => {
    expect(satisfiesCoreVersion(">=0.0.0")).toBe(true);
    expect(satisfiesCoreVersion("0.1.0")).toBe(true);
    expect(satisfiesCoreVersion(">=0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("*")).toBe(true);
  });

  it("supports the comparator forms a near-future module needs", () => {
    expect(satisfiesCoreVersion(">0.0.9", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("<0.2.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("<=0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion("=0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesCoreVersion(">=0.1.0", "0.1.0")).toBe(true);
  });

  it("rejects ranges that exclude the version", () => {
    expect(satisfiesCoreVersion(">=9.0.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("<0.1.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion(">0.1.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("=0.2.0", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("0.2.0", "0.1.0")).toBe(false);
  });

  it("fails closed on unparseable / unsupported ranges", () => {
    expect(satisfiesCoreVersion("", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("garbage", "0.1.0")).toBe(false);
    expect(satisfiesCoreVersion("^0.1.0", "0.1.0")).toBe(false); // caret unsupported
    expect(satisfiesCoreVersion("~0.1.0", "0.1.0")).toBe(false); // tilde unsupported
    expect(satisfiesCoreVersion(">=0.1", "0.1.0")).toBe(false); // not major.minor.patch
    expect(satisfiesCoreVersion(">=0.1.0 || <0.0.1", "0.1.0")).toBe(false); // OR unsupported
  });
});
