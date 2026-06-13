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

  it("targets the prod compose file and prepends real docker build steps when build is set", () => {
    const plan = createComposeSmokePlan({
      composeFile: "infra/docker-compose.prod.yml",
      build: true
    });
    // Compose-driven commands target the prod compose file.
    const composeCmds = plan.commands.filter((c) => c.args[0] === "compose");
    expect(composeCmds.length).toBeGreaterThan(0);
    expect(composeCmds.every((c) => c.args.includes("infra/docker-compose.prod.yml"))).toBe(true);
    // The first two commands are real `docker build` steps for the two Dockerfiles,
    // tagged to the GHCR refs the prod compose resolves (not a no-op `compose build`).
    expect(plan.commands.length).toBeGreaterThanOrEqual(2);
    const first = plan.commands[0];
    const second = plan.commands[1];
    if (!first || !second) {
      throw new Error("expected at least two commands when build is set");
    }
    expect(first.args[0]).toBe("build");
    expect(first.args).toContain("Dockerfile");
    expect(first.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s-api:"))).toBe(true);
    expect(second.args[0]).toBe("build");
    expect(second.args).toContain("apps/web/Dockerfile");
    expect(second.args.some((a) => a.startsWith("ghcr.io/motioneso/jarv1s-web:"))).toBe(true);
  });
});
