import { describe, expect, it } from "vitest";

import {
  applyGuidedPersonaText,
  createPersonaDraft,
  discardPersonaDraft,
  personaDraftIsDirty,
  personaSeedText
} from "../../apps/web/src/settings/settings-persona-preview.js";
import { readPersonaPreviewResult } from "../../packages/module-registry/src/built-in-module-helpers.js";

describe("personaSeedText", () => {
  it("turns dials into editable starter persona text", () => {
    expect(
      personaSeedText({
        tone: "Crisp",
        directness: "Direct",
        humor: "Dry",
        recovery: "Firm"
      })
    ).toContain("Keep responses crisp");
  });

  it("keeps authored text local until save and restores the server snapshot on discard", () => {
    const saved = { assistantName: "Jarvis", personaText: "Saved voice" };
    const draft = createPersonaDraft(saved);
    const guided = applyGuidedPersonaText(draft, {
      tone: "Crisp",
      directness: "Direct",
      humor: "Dry",
      recovery: "Firm"
    });

    expect(saved.personaText).toBe("Saved voice");
    expect(guided.personaText).toContain("Keep responses crisp");
    expect(personaDraftIsDirty(guided, saved)).toBe(true);
    const expected = { ...guided, ...saved };
    expect(discardPersonaDraft(saved, guided)).toEqual(expected);
  });

  it("extracts only text from the one-shot structured preview result", () => {
    expect(readPersonaPreviewResult({ rawObject: { text: "Keep it short." } })).toBe(
      "Keep it short."
    );
    expect(readPersonaPreviewResult({ rawText: '{"text":"Be direct."}' })).toBe("Be direct.");
    expect(() => readPersonaPreviewResult({ rawObject: { secret: "never show" } })).toThrow();
  });
});
