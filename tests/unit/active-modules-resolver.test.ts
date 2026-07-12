import { describe, expect, it } from "vitest";

import { commitmentsModuleManifest } from "../../packages/commitments/src/manifest.js";
import { goalsModuleManifest } from "../../packages/goals/src/manifest.js";
import { notesModuleManifest } from "../../packages/notes/src/manifest.js";
import { peopleModuleManifest } from "../../packages/people/src/manifest.js";

describe("required built-in modules (#996, #860)", () => {
  it.each([
    ["commitments", commitmentsModuleManifest],
    ["people", peopleModuleManifest],
    ["goals", goalsModuleManifest],
    ["notes", notesModuleManifest]
  ])("%s is lifecycle:required with availability.required true", (_name, manifest) => {
    expect(manifest.lifecycle).toBe("required");
    expect(manifest.availability?.required).toBe(true);
  });
});
