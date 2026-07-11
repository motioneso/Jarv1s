import { describe, expect, it } from "vitest";

import type { ExternalJarvisModulePackage, JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

describe("external module manifest types (#917)", () => {
  it("accepts a metadata-only manifest", () => {
    const manifest: JsonJarvisModuleManifest = {
      schemaVersion: 1,
      id: "acme-widgets",
      name: "Acme Widgets",
      version: "0.1.0",
      publisher: "Acme, Inc.",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" },
      runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
      assistantTools: [
        {
          name: "acme-widgets.lookup",
          description: "Look up a widget",
          permissionId: "acme-widgets.lookup",
          risk: "read",
          handler: "lookup"
        }
      ]
    };
    const pkg: ExternalJarvisModulePackage = {
      manifest,
      manifestHash: "sha256:deadbeef",
      packageHash: "sha256:cafebabe"
    };
    expect(pkg.manifest.id).toBe("acme-widgets");
    expect(pkg.manifest.compatibility.jarv1s).toBe(">=0.1.0");
  });
});
