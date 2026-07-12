import { describe, expect, it } from "vitest";

import { assertIsolatedTestDatabase } from "../integration/test-database.js";

describe("assertIsolatedTestDatabase", () => {
  it("throws when the connection string targets the shared default database", () => {
    expect(() =>
      assertIsolatedTestDatabase("postgres://postgres:postgres@localhost:55433/jarv1s")
    ).toThrow(/shared/i);
  });

  it("does not throw for an isolated database name", () => {
    expect(() =>
      assertIsolatedTestDatabase(
        "postgres://postgres:postgres@localhost:55433/jarvis_test_12345_ab12"
      )
    ).not.toThrow();
  });
});
