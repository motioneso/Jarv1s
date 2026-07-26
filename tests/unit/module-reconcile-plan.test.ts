// #964: pure-logic units for the boot reconcile script. The end-to-end phases
// (purge/ensure/install) are covered by the Task 10 integration suite against a
// real Postgres; here we pin the fail-closed guards that protect DROP statements.
import { describe, expect, it } from "vitest";

import {
  assertQualifiedModuleTable,
  decideStagedAcceptance
} from "../../scripts/module-reconcile.js";

describe("assertQualifiedModuleTable", () => {
  it("accepts app-schema tables owned by the module prefix", () => {
    expect(() => assertQualifiedModuleTable("app.demo_module_leads", "demo-module")).not.toThrow();
    expect(() =>
      assertQualifiedModuleTable("app.demo_module_notes_v2", "demo-module")
    ).not.toThrow();
  });

  it("rejects tables outside the module's prefix (cross-module DROP attempt)", () => {
    expect(() => assertQualifiedModuleTable("app.users", "demo-module")).toThrow(/prefix/);
    expect(() => assertQualifiedModuleTable("app.notes_items", "demo-module")).toThrow(/prefix/);
  });

  it("rejects non-app schemas, quoting tricks, and injection shapes", () => {
    expect(() => assertQualifiedModuleTable("public.demo_module_leads", "demo-module")).toThrow();
    expect(() => assertQualifiedModuleTable('app."demo_module_leads"', "demo-module")).toThrow();
    expect(() =>
      assertQualifiedModuleTable("app.demo_module_leads; DROP TABLE app.users", "demo-module")
    ).toThrow();
    expect(() => assertQualifiedModuleTable("app.demo_module_leads--", "demo-module")).toThrow();
  });
});

describe("decideStagedAcceptance", () => {
  it("accepts when the on-disk package hash matches the staged hash", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: "abc" })).toEqual({
      accept: true
    });
  });

  it("declines with a reason when hashes differ (partial swap / tamper)", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: "def" })).toEqual({
      accept: false,
      reason: "staged package hash abc does not match on-disk package hash def"
    });
  });

  it("declines when the module is staged but missing on disk", () => {
    expect(decideStagedAcceptance({ stagedPackageHash: "abc", onDiskPackageHash: null })).toEqual({
      accept: false,
      reason: "staged package hash abc does not match on-disk package hash <absent>"
    });
  });
});
