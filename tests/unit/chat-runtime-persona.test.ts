import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb, DataContextRunner, PreferencesPort } from "@moss/db";
import { CHAT_SETTINGS_PREFERENCE_KEY, normalizePersonaSettings } from "@moss/shared";
import { DEFAULT_MOSS_PERSONA, resolveChatPersona } from "../../packages/chat/src/live/runtime.js";

describe("DEFAULT_MOSS_PERSONA", () => {
  it("keeps app knowledge closed behind map and snapshot tools", () => {
    expect(DEFAULT_MOSS_PERSONA).not.toContain("notes.search");
    expect(DEFAULT_MOSS_PERSONA).not.toContain("connect Google");
    expect(DEFAULT_MOSS_PERSONA).toContain("app.getMapSlice");
    expect(DEFAULT_MOSS_PERSONA).toContain("chat.getCurrentView");
    expect(DEFAULT_MOSS_PERSONA).toContain("I don't know");
    expect(DEFAULT_MOSS_PERSONA).toContain("non-prerequisite");
  });

  it("asks for pasted text rather than model-initiated capture", () => {
    expect(DEFAULT_MOSS_PERSONA).toContain("ask the user to paste the exact text");
    expect(DEFAULT_MOSS_PERSONA).toContain("never request or initiate a screenshot");
  });

  // #1441 — the default persona is name-neutral. The assistant's identity comes
  // solely from persona.assistantName, rendered once by renderPersonaText.
  it("states no assistant identity of its own", () => {
    expect(DEFAULT_MOSS_PERSONA).not.toMatch(/You are \w+, /);
    expect(DEFAULT_MOSS_PERSONA).not.toMatch(/Your name is /);
  });

  it("still names the Moss product", () => {
    expect(DEFAULT_MOSS_PERSONA).toContain("Moss app");
  });
});

function dataContext(): DataContextRunner {
  return {
    withDataContext: async <T>(
      _access: AccessContext,
      fn: (scopedDb: DataContextDb) => Promise<T>
    ) => fn({} as DataContextDb)
  } as unknown as DataContextRunner;
}

function preferences(get: PreferencesPort["get"]): PreferencesPort {
  return {
    get,
    getWithMetadata: async () => null,
    upsert: async () => undefined
  };
}

function composePrompt(persona: { assistantName: string; personaText: string }): Promise<string> {
  return resolveChatPersona(
    {
      dataContext: dataContext(),
      personaPreferences: { get: async () => persona },
      localePreferences: preferences(async () => null),
      chatPreferences: preferences(async () => null)
    },
    "00000000-0000-0000-0000-000000000001",
    "Owner"
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("resolveChatPersona", () => {
  it("adds saved response style to the live persona prompt", async () => {
    const persona = await resolveChatPersona(
      {
        dataContext: dataContext(),
        personaPreferences: {
          get: async () => ({ assistantName: "Moss", personaText: "" })
        },
        localePreferences: preferences(async () => null),
        chatPreferences: preferences(async (_scopedDb, key) =>
          key === CHAT_SETTINGS_PREFERENCE_KEY ? { responseStyle: "detailed" } : null
        )
      },
      "00000000-0000-0000-0000-000000000001",
      "Owner"
    );

    expect(persona).toContain(
      "Default response style: detailed. Include useful context, reasoning, and next steps."
    );
  });

  // #1441 acceptance. Before this change the composed prompt carried two
  // contradictory identities: "You are Jarvis, …" from the default persona and
  // "Your name is Alfred." from the user's setting.
  it("names the configured assistant exactly once", async () => {
    const prompt = await composePrompt({ assistantName: "Alfred", personaText: "" });

    expect(countOccurrences(prompt, "Alfred")).toBe(1);
    expect(prompt).toContain("Your name is Alfred.");
  });

  it("carries no hardcoded assistant name", async () => {
    const prompt = await composePrompt({ assistantName: "Alfred", personaText: "" });

    expect(prompt).not.toMatch(/Jarvis/i);
    // A rename of the identity line rather than its removal would reintroduce
    // the same defect under the new product name.
    expect(prompt).not.toContain("You are Moss");
    expect(prompt).not.toContain("Your name is Moss");
  });

  it("still names the Moss product independently of the assistant name", async () => {
    const prompt = await composePrompt({ assistantName: "Alfred", personaText: "" });

    expect(prompt).toContain("Moss app");
  });
});

describe("normalizePersonaSettings", () => {
  // Two separate literals back this default; fixing one and missing the other
  // passes a single-path test.
  it("defaults the assistant name to Moss", () => {
    expect(normalizePersonaSettings(undefined).assistantName).toBe("Moss");
    expect(normalizePersonaSettings({}).assistantName).toBe("Moss");
  });

  it("keeps a configured assistant name", () => {
    expect(normalizePersonaSettings({ assistantName: "Alfred" }).assistantName).toBe("Alfred");
  });
});
