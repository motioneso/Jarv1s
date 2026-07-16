export type ShellTheme = string;
export type ShellColorMode = "light" | "dark";

export const SHELL_THEME_STORAGE_KEY = "jarvis.theme:v1";
export const SHELL_COLOR_MODE_STORAGE_KEY = "jarvis.color-mode:v1";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function loadShellTheme(storage: ThemeStorage = localStorage): ShellTheme {
  try {
    return storage.getItem(SHELL_THEME_STORAGE_KEY)?.trim() || "light";
  } catch {
    return "light";
  }
}

export function saveShellTheme(theme: ShellTheme, storage: ThemeStorage = localStorage): void {
  try {
    storage.setItem(SHELL_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be disabled, full, or unavailable in private browsing.
  }
}

export function loadShellColorMode(storage: ThemeStorage = localStorage): ShellColorMode {
  try {
    return storage.getItem(SHELL_COLOR_MODE_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveShellColorMode(
  mode: ShellColorMode,
  storage: ThemeStorage = localStorage
): void {
  try {
    storage.setItem(SHELL_COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be disabled, full, or unavailable in private browsing.
  }
}
