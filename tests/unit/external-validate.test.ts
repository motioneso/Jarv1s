import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

const base = {
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
});
