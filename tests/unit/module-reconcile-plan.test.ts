// #964: pure-logic units for the boot reconcile script. The end-to-end phases
// (purge/ensure/install) are covered by the Task 10 integration suite against a
// real Postgres; here we pin the fail-closed guards that protect DROP statements.
import { describe, expect, it } from "vitest";

import { assertQualifiedModuleTable, decideStagedAcceptance } from "../../scripts/module-reconcile.js";

describe("assertQualifiedModuleTable", () => {
  it("accepts app-schema tables owned by the module prefix", () => {
    expect(() => assertQualifiedModuleTable("app.job_search_leads", "job-search")).not.toThrow();
    expect(() => assertQualifiedModuleTable("app.job_search_notes_v2", "job-search")).not.toThrow();
  });

  it("rejects tables outside the module's prefix (cross-module DROP attempt)", () => {
    expect(() => assertQualifiedModuleTable("app.users", "job-search")).toThrow(/prefix/);
    expect(() => assertQualifiedModuleTable("app.notes_items", "job-search")).toThrow(/prefix/);
  });

  it("rejects non-app schemas, quoting tricks, and injection shapes", () => {
    expect(() => assertQualifiedModuleTable("public.job_search_leads", "job-search")).toThrow();
    expect(() => assertQualifiedModuleTable('app."job_search_leads"', "job-search")).toThrow();
    expect(() =>
      assertQualifiedModuleTable("app.job_search_leads; DROP TABLE app.users", "job-search")
    ).toThrow();
    expect(() => assertQualifiedModuleTable("app.job_search_leads--", "job-search")).toThrow();
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
