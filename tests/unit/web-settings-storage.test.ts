import { describe, expect, it } from "vitest";

import {
  readSettingsStorage,
  writeSettingsStorage
} from "../../apps/web/src/settings/settings-storage.js";

describe("settings storage", () => {
  it("uses versioned keys and returns null when a key is absent", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    writeSettingsStorage(storage, "mode", "admin");

    expect(values.get("jarvis.settings:v1:mode")).toBe("admin");
    expect(readSettingsStorage(storage, "mode")).toBe("admin");
    expect(readSettingsStorage(storage, "advanced")).toBeNull();
  });

  it("falls back to null when browser storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      }
    };

    expect(readSettingsStorage(storage, "mode")).toBeNull();
    expect(() => writeSettingsStorage(storage, "mode", "personal")).not.toThrow();
  });
});
