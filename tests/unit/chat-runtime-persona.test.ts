import { describe, expect, it } from "vitest";

import type { AccessContext, DataContextDb, DataContextRunner, PreferencesPort } from "@jarv1s/db";
import { CHAT_SETTINGS_PREFERENCE_KEY } from "@jarv1s/shared";
import { DEFAULT_JARVIS_PERSONA, resolveChatPersona } from "../../packages/chat/src/live/runtime.js";

describe("DEFAULT_JARVIS_PERSONA", () => {
  it("keeps app knowledge closed behind map and snapshot tools", () => {
    expect(DEFAULT_JARVIS_PERSONA).not.toContain("notes.search");
    expect(DEFAULT_JARVIS_PERSONA).not.toContain("connect Google");
    expect(DEFAULT_JARVIS_PERSONA).toContain("app.getMapSlice");
    expect(DEFAULT_JARVIS_PERSONA).toContain("chat.getCurrentView");
    expect(DEFAULT_JARVIS_PERSONA).toContain("I don't know");
    expect(DEFAULT_JARVIS_PERSONA).toContain("non-prerequisite");
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

describe("resolveChatPersona", () => {
  it("adds saved response style to the live persona prompt", async () => {
    const persona = await resolveChatPersona(
      {
        dataContext: dataContext(),
        personaPreferences: {
          get: async () => ({ assistantName: "Jarvis", personaText: "" })
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
});
