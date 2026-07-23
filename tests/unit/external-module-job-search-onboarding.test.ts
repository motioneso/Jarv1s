import { describe, expect, it } from "vitest";

import {
  INLINE_CONTROL_SLOTS,
  PROFILE_FIELDS
} from "../../external-modules/job-search/src/web/onboarding-model.js";

describe("Job Search onboarding shell (#1232)", () => {
  it("keeps the profile aside at eight authored field rows", () => {
    expect(PROFILE_FIELDS).toHaveLength(8);
    expect(PROFILE_FIELDS.map((field) => field.label)).toEqual([
      "Target roles",
      "Experience",
      "Compensation",
      "Work mode",
      "Locations",
      "Dealbreakers",
      "Resume",
      "Search status"
    ]);
  });

  it("declares empty inline-control slots for later slices", () => {
    expect(INLINE_CONTROL_SLOTS).toEqual(["resume-intake", "profile-chips", "source-controls"]);
  });
});
