import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

const base = {
  schemaVersion: 1,
  id: "acme-widgets",
  name: "Acme Widgets",
  version: "0.1.0",
  publisher: "Acme, Inc.",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.1.0" }
};

describe("validateExternalModuleManifest (#917)", () => {
  it("accepts a well-formed metadata-only manifest", () => {
    const result = validateExternalModuleManifest(base, "acme-widgets", "0.1.0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.id).toBe("acme-widgets");
  });

  it("rejects a non-object", () => {
    const result = validateExternalModuleManifest(null, "acme-widgets");
    expect(result.ok).toBe(false);
  });

  // #917 (spec revision 2026-07-10, PR #924): the on-disk envelope contract version is required
  // and must be exactly the number 1 — a missing or future value fails closed at load.
  it("rejects a missing schemaVersion", () => {
    const { schemaVersion, ...withoutSchemaVersion } = base;
    const result = validateExternalModuleManifest(withoutSchemaVersion, "acme-widgets", "0.1.0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("schemaVersion");
  });

  it("rejects a future schemaVersion", () => {
    const result = validateExternalModuleManifest(
      { ...base, schemaVersion: 2 },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("schemaVersion");
  });

  it("rejects an id that does not match the directory name", () => {
    const result = validateExternalModuleManifest(base, "other-dir");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("directory");
  });

  it("rejects an id that is not a slug", () => {
    const result = validateExternalModuleManifest({ ...base, id: "Acme_Widgets" }, "Acme_Widgets");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { publisher, ...withoutPublisher } = base;
    const result = validateExternalModuleManifest(withoutPublisher, "acme-widgets");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("publisher");
  });

  it("rejects an incompatible core-version range", () => {
    const result = validateExternalModuleManifest(
      { ...base, compatibility: { jarv1s: ">=9.9.9" } },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("compatible");
  });

  it("rejects an executable/surface field (navigation)", () => {
    const result = validateExternalModuleManifest(
      { ...base, navigation: [{ id: "x", label: "X", path: "/x" }] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("navigation");
  });

  it("rejects declared auth in this slice", () => {
    const result = validateExternalModuleManifest(
      { ...base, auth: [{ id: "acme-widgets.key", kind: "api-key", label: "Key" }] },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("auth");
  });

  it("accepts a declared worker tool", () => {
    const result = validateExternalModuleManifest(
      {
        ...base,
        runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
        assistantTools: [
          {
            name: "acme-widgets.lookup",
            description: "Look up a widget",
            permissionId: "acme-widgets.lookup",
            risk: "read",
            inputSchema: { type: "object" },
            handler: "lookup"
          }
        ]
      },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(true);
  });

  it("rejects tools without a compatible worker", () => {
    const result = validateExternalModuleManifest(
      {
        ...base,
        assistantTools: [
          {
            name: "acme-widgets.lookup",
            description: "Look up a widget",
            permissionId: "acme-widgets.lookup",
            risk: "read",
            handler: "lookup"
          }
        ]
      },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("runtime");
  });

  it("rejects a worker entrypoint outside the package hash", () => {
    const result = validateExternalModuleManifest(
      { ...base, runtime: { workerEntrypoint: "worker.js", workerContractVersion: 1 } },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("dist/worker.js");
  });

  it("rejects unprefixed and duplicate worker tools", () => {
    const tool = {
      name: "lookup",
      description: "Look up a widget",
      permissionId: "lookup",
      risk: "read",
      handler: "lookup"
    };
    const result = validateExternalModuleManifest(
      {
        ...base,
        runtime: { workerEntrypoint: "../worker.js", workerContractVersion: 2 },
        assistantTools: [tool, tool]
      },
      "acme-widgets",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errors = result.errors.join(" ");
      expect(errors).toContain("workerEntrypoint");
      expect(errors).toContain("workerContractVersion");
      expect(errors).toContain("prefixed");
      expect(errors).toContain("unique");
    }
  });
});
