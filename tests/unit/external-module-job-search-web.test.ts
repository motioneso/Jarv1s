import { describe, expect, it } from "vitest";

import {
  landingState,
  profileCardsFromResult
} from "../../external-modules/job-search/src/web/landing-model.js";
import { MODULE_STYLES } from "../../external-modules/job-search/src/web/styles.js";

describe("Job Search landing contract (#1232)", () => {
  it("shows the first-run state until profiles exist", () => {
    expect(landingState([])).toBe("first-run");
    expect(landingState([{ id: "profile-1", title: "Product leadership" }])).toBe("configured");
  });

  it("keeps profile cards to safe display fields", () => {
    expect(
      profileCardsFromResult({
        profiles: [
          { id: "profile-1", title: "Product leadership", status: "building", secret: "drop" },
          { title: "missing id" }
        ]
      })
    ).toEqual([{ id: "profile-1", title: "Product leadership", status: "building" }]);
  });

  it("uses the live Park Press type tokens without retired faces or raw colors", () => {
    expect(MODULE_STYLES).toContain("var(--font-display)");
    expect(MODULE_STYLES).toContain("var(--font-sans)");
    expect(MODULE_STYLES).not.toContain("--font-serif");
    expect(MODULE_STYLES).not.toContain("--font-mono");
    expect(MODULE_STYLES).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
