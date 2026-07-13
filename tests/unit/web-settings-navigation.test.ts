import { describe, expect, it } from "vitest";

import {
  coerceSettingsSectionId,
  flattenSettingsGroups
} from "../../apps/web/src/settings/settings-navigation.js";

const sections = [
  { id: "profile", label: "Profile" },
  { id: "memory", label: "Memory" },
  { id: "general", label: "General" }
] as const;

describe("settings navigation model", () => {
  it("keeps a persisted section id when it belongs to the section list", () => {
    expect(coerceSettingsSectionId(sections, "memory")).toBe("memory");
  });

  it("falls back to the first section for stale or missing storage values", () => {
    expect(coerceSettingsSectionId(sections, null)).toBe("profile");
    expect(coerceSettingsSectionId(sections, "admin-only")).toBe("profile");
  });
});

describe("settings group flattening", () => {
  it("flattens groups in declared order", () => {
    const groups = [
      { label: "A", sections: [{ id: "one" }, { id: "two" }] },
      { label: "B", sections: [{ id: "three" }] }
    ];
    expect(flattenSettingsGroups(groups).map((s) => s.id)).toEqual(["one", "two", "three"]);
  });
});
