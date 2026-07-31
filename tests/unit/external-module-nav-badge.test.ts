// The nav badge is only useful if it survives manifest validation INTACT. Every case here
// asserts through validateExternalModuleManifest()'s validated output, never the raw JSON:
// the validator reconstructs the manifest from an allow-list, so a field that validates but
// is not re-emitted disappears with ok: true (F1) — this exact bug class has bitten this
// file before (#1282's briefing block).
import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "../../packages/module-registry/src/node.js";

// #1285: minimal manifest complete enough that navigation validation is the ONLY thing
// under test. Navigation doesn't require `runtime` (unlike `worker`/`briefing`), so this
// intentionally omits it — a badge test that fails on an unrelated missing field would
// misread as a badge bug.
const baseManifest = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" }
};

const navigationWithBadge = [
  {
    id: "job-search",
    label: "Job Search",
    path: "/",
    badge: { source: "notifications" }
  }
];

describe("external manifest nav badge (#1285)", () => {
  it("a declared badge survives manifest reconstruction", () => {
    const result = validateExternalModuleManifest(
      { ...baseManifest, navigation: navigationWithBadge },
      "job-search"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Deep-equal, not a truthiness check: this is the assertion that fails when the
    // re-emit line is missing from the reconstruction literal, and nothing else does.
    expect(result.manifest.navigation?.[0]?.badge).toEqual({ source: "notifications" });
  });

  it("rejects an unknown badge source", () => {
    const result = validateExternalModuleManifest(
      {
        ...baseManifest,
        navigation: [
          { id: "job-search", label: "Job Search", path: "/", badge: { source: "tool" } }
        ]
      },
      "job-search"
    );

    // Accepting any string would let a future badge source ship by accident — the
    // enum is closed today on purpose (module-sdk's ExternalModuleNavigationEntry.badge).
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/badge/);
  });

  it("rejects a badge that is not an object", () => {
    const result = validateExternalModuleManifest(
      {
        ...baseManifest,
        navigation: [{ id: "job-search", label: "Job Search", path: "/", badge: "notifications" }]
      },
      "job-search"
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/badge/);
  });

  it("a navigation entry with no badge still validates", () => {
    const result = validateExternalModuleManifest(
      {
        ...baseManifest,
        navigation: [{ id: "job-search", label: "Job Search", path: "/" }]
      },
      "job-search"
    );

    // The field is optional — no existing module manifest (none of which declare a
    // badge today) may break because this field now exists.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.navigation?.[0]?.badge).toBeUndefined();
  });
});
