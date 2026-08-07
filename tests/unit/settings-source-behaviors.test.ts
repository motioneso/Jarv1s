import { describe, expect, it } from "vitest";

import {
  peopleNotesSourceBehaviors,
  findSourceBehaviorEnabled
} from "../../apps/web/src/settings/settings-source-behaviors.js";

describe("peopleNotesSourceBehaviors", () => {
  it("declares the people.notes.suggest-updates behavior", () => {
    expect(peopleNotesSourceBehaviors("Alfred")).toEqual([
      {
        id: "people.notes.suggest-updates",
        label: "Suggest note updates",
        description:
          "Create review candidates for Alfred-managed People note updates instead of silently changing human notes."
      }
    ]);
  });

  // #1441 — the description names the assistant, so it has to come from the caller's
  // configured name. A hardcoded literal would still satisfy a test that only checked
  // the behavior id, which is how this string survived the first rename pass.
  it("names the configured assistant rather than a hardcoded product name", () => {
    const [behavior] = peopleNotesSourceBehaviors("Alfred");

    expect(behavior.description).toContain("Alfred-managed");
    expect(behavior.description).not.toMatch(/Jarvis|Moss/i);
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
