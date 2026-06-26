export type ShellTheme = string;

export const SHELL_THEME_STORAGE_KEY = "jarvis.theme:v1";

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
