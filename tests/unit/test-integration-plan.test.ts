import { describe, expect, it } from "vitest";

import { createDatabaseIsolationPlan } from "../../scripts/test-integration.js";

describe("createDatabaseIsolationPlan", () => {
  it("passes through when JARVIS_PGDATABASE is already set", () => {
    const plan = createDatabaseIsolationPlan(
      { JARVIS_PGDATABASE: "jarvis_build_537" } as NodeJS.ProcessEnv,
      "unused-entropy"
    );

    expect(plan).toEqual({ mode: "passthrough" });
  });

  it("generates an isolated database name when JARVIS_PGDATABASE is unset", () => {
    const plan = createDatabaseIsolationPlan({} as NodeJS.ProcessEnv, "12345_ab12cd");

    expect(plan).toEqual({ mode: "isolated", databaseName: "jarvis_test_12345_ab12cd" });
  });

  it("ignores an empty-string JARVIS_PGDATABASE (treats as unset)", () => {
    const plan = createDatabaseIsolationPlan({ JARVIS_PGDATABASE: "" } as NodeJS.ProcessEnv, "xyz");

    expect(plan).toEqual({ mode: "isolated", databaseName: "jarvis_test_xyz" });
  });
});
