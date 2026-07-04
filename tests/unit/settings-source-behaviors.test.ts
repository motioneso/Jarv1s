import { describe, expect, it } from "vitest";

import {
  PEOPLE_NOTES_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled
} from "../../apps/web/src/settings/settings-source-behaviors.js";

describe("PEOPLE_NOTES_SOURCE_BEHAVIORS", () => {
  it("declares the people.notes.suggest-updates behavior", () => {
    expect(PEOPLE_NOTES_SOURCE_BEHAVIORS).toEqual([
      {
        id: "people.notes.suggest-updates",
        label: "Suggest note updates",
        description:
          "Create review candidates for Jarvis-managed People note updates instead of silently changing human notes."
      }
    ]);
  });

  it("defaults to enabled when no source data is present", () => {
    expect(findSourceBehaviorEnabled([], "people.notes.suggest-updates")).toBe(true);
  });

  it("reflects a disabled override from source data", () => {
    const sources = [
      {
        id: "people-notes",
        name: "People notes",
        description: "",
        behaviors: [
          {
            id: "people.notes.suggest-updates",
            sourceId: "people-notes",
            name: "Suggest note updates",
            description: "",
            default: "default-on" as const,
            enabled: false,
            toggleable: true
          }
        ]
      }
    ];
    expect(findSourceBehaviorEnabled(sources, "people.notes.suggest-updates")).toBe(false);
  });
});
