import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

const manifestPath = fileURLToPath(
  new URL("../../external-modules/job-search/jarvis.module.json", import.meta.url)
);

describe("Job Search external module manifest (#1232)", () => {
  it("passes the real validator with only the JS-01 surface", () => {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const result = validateExternalModuleManifest(raw, "job-search", "0.1.0");

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.errors.join(", "));

    expect(result.manifest.version).toBe("0.2.0");
    expect(result.manifest.storage).toEqual([
      { namespace: "job-search.profiles", scopes: ["user"] },
      { namespace: "job-search.resume", scopes: ["user"] },
      { namespace: "job-search.sources", scopes: ["user"] },
      { namespace: "job-search.candidates", scopes: ["user"] },
      { namespace: "job-search.matches", scopes: ["user"] },
      { namespace: "job-search.feedback", scopes: ["user"] },
      { namespace: "job-search.settings", scopes: ["user"] },
      { namespace: "job-search.meta", scopes: ["user"] }
    ]);
    expect(result.manifest.database).toBeUndefined();
    expect(result.manifest.assistantTools).toEqual([
      expect.objectContaining({
        name: "job-search.profiles.list",
        permissionId: "job-search.profiles.list",
        risk: "read",
        handler: "profiles.list"
      }),
      expect.objectContaining({
        name: "job-search.resume.intake",
        permissionId: "job-search.resume.intake",
        risk: "write",
        handler: "resume.intake"
      }),
      expect.objectContaining({
        name: "job-search.resume.critique",
        permissionId: "job-search.resume.critique",
        risk: "write",
        handler: "resume.critique"
      })
    ]);
    expect(result.manifest.worker?.queues).toEqual([
      {
        name: "job-search.reset",
        handler: "reset",
        retryLimit: 1,
        allowManualRun: false
      },
      {
        name: "job-search.resume-revise",
        handler: "resume-revise",
        retryLimit: 1,
        allowManualRun: true,
        paramsSchema: { type: "object", fields: { revisionId: { type: "identifier" } } }
      }
    ]);
    expect(result.manifest.navigation).toEqual([
      { id: "job-search", label: "Job Search", path: "/", icon: "briefcase" }
    ]);
    expect(result.manifest.runtime).toEqual({
      workerEntrypoint: "dist/worker.js",
      workerContractVersion: 1
    });
    expect(result.manifest.web).toEqual({ entrypoint: "dist/web/index.js", contractVersion: 1 });
    expect(result.manifest.auth).toBeUndefined();
    expect(result.manifest.fetchHosts).toBeUndefined();
    expect(result.manifest.assistantOnboarding?.guidance).toContain(
      "Let's get your resume solid first."
    );
  });
});
