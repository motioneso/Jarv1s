export type SettingsStorageKey = "mode" | "advanced" | "categoryPersonal" | "categoryAdmin";

interface SettingsStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const STORAGE_PREFIX = "jarvis.settings:v1";

function storageKey(key: SettingsStorageKey): string {
  return `${STORAGE_PREFIX}:${key}`;
}

export function browserSettingsStorage(): SettingsStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readSettingsStorage(
  storage: SettingsStorage | null,
  key: SettingsStorageKey
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

export function writeSettingsStorage(
  storage: SettingsStorage | null,
  key: SettingsStorageKey,
  value: string
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey(key), value);
  } catch {
    // Storage may be disabled or unavailable; settings remain usable with in-memory state.
  }
}
