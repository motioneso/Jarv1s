import { describe, expect, it } from "vitest";

import { createRobotsGate, parseRobots } from "../../packages/web-research/src/robots.js";

describe("parseRobots", () => {
  it("uses longest-match precedence with allow winning ties", () => {
    const policy = parseRobots(
      "User-agent: *\nDisallow: /\nAllow: /public\nDisallow: /public/private\nAllow: /equal\nDisallow: /equal",
      "Jarvis-WebResearch"
    );

    expect(policy.isPathAllowed("/nope")).toBe(false);
    expect(policy.isPathAllowed("/public/story")).toBe(true);
    expect(policy.isPathAllowed("/public/private/story")).toBe(false);
    expect(policy.isPathAllowed("/equal")).toBe(true);
  });

  it("supports wildcards, end anchors, and specific user-agent groups", () => {
    const policy = parseRobots(
      [
        "User-agent: *",
        "Disallow: /shared",
        "User-agent: Jarvis-WebResearch",
        "Disallow: /*.pdf$",
        "Allow: /shared"
      ].join("\n"),
      "Jarvis-WebResearch"
    );

    expect(policy.isPathAllowed("/report.pdf")).toBe(false);
    expect(policy.isPathAllowed("/report.pdf?download=1")).toBe(true);
    expect(policy.isPathAllowed("/shared/story")).toBe(true);
  });
});

describe("createRobotsGate", () => {
  it.each([
    [404, true],
    [410, true],
    [503, false]
  ])("maps status %i to allowed=%s", async (status, allowed) => {
    const gate = createRobotsGate();
    await expect(
      gate.isAllowed(new URL("https://example.com/story"), async () => ({ status, body: "" }))
    ).resolves.toBe(allowed);
  });

  it("fails closed on an unreachable robots file", async () => {
    await expect(
      createRobotsGate().isAllowed(new URL("https://example.com/story"), async () => null)
    ).resolves.toBe(false);
  });

  it("caches by origin until the TTL expires", async () => {
    let now = 0;
    let calls = 0;
    const gate = createRobotsGate({ cacheTtlMs: 100, now: () => now });
    const fetchText = async () => {
      calls += 1;
      return { status: 200, body: "User-agent: *\nAllow: /" };
    };

    await gate.isAllowed(new URL("https://example.com/one"), fetchText);
    await gate.isAllowed(new URL("https://example.com/two"), fetchText);
    expect(calls).toBe(1);
    now = 101;
    await gate.isAllowed(new URL("https://example.com/three"), fetchText);
    expect(calls).toBe(2);
  });
});
