import { describe, expect, it } from "vitest";

import {
  getBuiltInModuleManifests,
  getBuiltInSqlMigrationDirectories
} from "@jarv1s/module-registry";

describe("sports built-in registration", () => {
  it("registers the sports module manifest", () => {
    const ids = getBuiltInModuleManifests().map((m) => m.id);
    expect(ids).toContain("sports");
  });

  it("contributes the sports sql migration directory", () => {
    const dirs = getBuiltInSqlMigrationDirectories();
    expect(dirs.some((d) => d.endsWith("/packages/sports/sql"))).toBe(true);
  });
});
