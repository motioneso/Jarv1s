import { describe, expect, it } from "vitest";

import {
  loadShellColorMode,
  loadShellTheme,
  saveShellColorMode,
  saveShellTheme,
  SHELL_COLOR_MODE_STORAGE_KEY,
  SHELL_THEME_STORAGE_KEY
} from "../../apps/web/src/shell/theme-storage.js";

describe("shell theme storage", () => {
  it("uses a versioned storage key and falls back when reads throw", () => {
    const storage = storageThatThrowsOnRead();

    expect(SHELL_THEME_STORAGE_KEY).toBe("jarvis.theme:v1");
    expect(loadShellTheme(storage)).toBe("light");
  });

  it("persists theme ids and ignores write failures", () => {
    const storage = memoryStorage();

    storage.setItem(SHELL_THEME_STORAGE_KEY, "solarized");
    expect(loadShellTheme(storage)).toBe("solarized");

    saveShellTheme("my-blue", storage);
    expect(storage.getItem(SHELL_THEME_STORAGE_KEY)).toBe("my-blue");

    expect(() => saveShellTheme("light", storageThatThrowsOnWrite())).not.toThrow();
  });

  it("persists an independent color mode with a light fallback", () => {
    const storage = memoryStorage();
    expect(loadShellColorMode(storage)).toBe("light");
    saveShellColorMode("dark", storage);
    expect(storage.getItem(SHELL_COLOR_MODE_STORAGE_KEY)).toBe("dark");
    expect(loadShellColorMode(storage)).toBe("dark");
  });

  it("derives dark mode from legacy Dark when new mode key is absent", () => {
    const storage = memoryStorage();
    storage.setItem(SHELL_THEME_STORAGE_KEY, "dark");

    expect(loadShellColorMode(storage)).toBe("dark");
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

function storageThatThrowsOnRead(): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {}
  };
}

function storageThatThrowsOnWrite(): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    }
  };
}
