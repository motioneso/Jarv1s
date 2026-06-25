import { describe, expect, it } from "vitest";

import { createComposeSmokePlan } from "../../scripts/smoke-compose.js";

describe("createComposeSmokePlan — prod variant", () => {
  it("defaults to the dev compose file with no build step", () => {
    const plan = createComposeSmokePlan();
    // The compose-driven commands all target the dev compose file…
    const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
    expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.yml"))).toBe(true);
    // …and there is no `docker build` step.
    expect(plan.commands.some((c) => c.args[0] === "build")).toBe(false);
  });

  it("targets the prod compose file and prepends one jarv1s image build when build is set", () => {
    const plan = createComposeSmokePlan({
      composeFile: "infra/docker-compose.prod.yml",
      build: true
    });
    // Compose-driven commands target the prod compose file.
    const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
    expect(composeCmds.length).toBeGreaterThan(0);
    expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.prod.yml"))).toBe(true);
    const first = plan.commands[0];
    if (!first) throw new Error("expected a build command when build is set");
    expect(first.args[0]).toBe("build");
    expect(first.args).toContain("Dockerfile");
    expect(first.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s:"))).toBe(true);
    expect(plan.commands.filter((c) => c.args[0] === "build")).toHaveLength(1);
    expect(plan.healthUrl).toBe("http://localhost:1533/health/ready");
    expect(plan.commands.some((c) => c.args.includes("api"))).toBe(false);
    expect(plan.commands.some((c) => c.args.includes("web"))).toBe(false);
    expect(plan.commands.some((c) => c.args.includes("worker"))).toBe(false);
    expect(plan.commands.some((c) => c.args.includes("migrate"))).toBe(false);
    expect(plan.commands.some((c) => c.args.includes("jarv1s"))).toBe(true);
  });
});
