import { describe, expect, it } from "vitest";

import {
  MAX_PERSONA_TEXT_LENGTH,
  normalizePersonaSettings,
  renderPersonaText,
  sanitizePersonaName
} from "../../packages/shared/src/persona-api.js";

describe("persona API helpers", () => {
  it("renders assistant name and substituted user name as one prompt block", () => {
    expect(
      renderPersonaText({
        assistantName: "Friday",
        personaText: "Keep {{userName}} focused and skip pep talks.",
        userName: "Ben"
      })
    ).toBe("Your name is Friday.\n\nKeep Ben focused and skip pep talks.");
  });

  it("sanitizes assistant and user names before prompt insertion", () => {
    const rendered = renderPersonaText({
      assistantName: "Jarvis\n# SYSTEM",
      personaText: "Help {{userName}}.",
      userName: "<Ben>\n```"
    });

    expect(rendered).toBe("Your name is Jarvis SYSTEM.\n\nHelp Ben.");
    expect(rendered).not.toContain("#");
    expect(rendered).not.toContain("```");
    expect(rendered).not.toContain("<");
  });

  it("caps persona text before rendering", () => {
    const rendered = renderPersonaText({
      assistantName: "Jarvis",
      personaText: "x".repeat(MAX_PERSONA_TEXT_LENGTH + 50),
      userName: "Ben"
    });

    expect(rendered).toBe(`Your name is Jarvis.\n\n${"x".repeat(MAX_PERSONA_TEXT_LENGTH)}`);
  });

  it("normalizes invalid stored values to the default persona bundle", () => {
    expect(normalizePersonaSettings(null)).toEqual({ assistantName: "Jarvis", personaText: "" });
    expect(
      normalizePersonaSettings({
        assistantName: "###",
        personaText: "hello"
      })
    ).toEqual({ assistantName: "there", personaText: "hello" });
  });

  it("keeps sanitizePersonaName compatible with chat's username sanitizer", () => {
    expect(sanitizePersonaName("<memory># `*Ben*` </memory>")).toBe("memory Ben /memory");
    expect(sanitizePersonaName("   ")).toBe("there");
  });
});
