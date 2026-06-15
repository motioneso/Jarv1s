import { useState, useEffect } from "react";

export const PREFS_KEY = "jarvis.wellness.prefs";
export const PREFS_EVENT = "jarvis:wellness-prefs";

export interface WellnessPrefs {
  radial: boolean;
}

const DEFAULTS: WellnessPrefs = { radial: false };

export function readPrefs(): WellnessPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WellnessPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function writePrefs(prefs: WellnessPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  } catch {
    // localStorage may be unavailable; prefs stay in-memory
  }
}

export function useWellnessPrefs(): [WellnessPrefs, (patch: Partial<WellnessPrefs>) => void] {
  const [prefs, setPrefs] = useState<WellnessPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(readPrefs());

    const sync = () => setPrefs(readPrefs());
    window.addEventListener("storage", sync);
    window.addEventListener(PREFS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PREFS_EVENT, sync);
    };
  }, []);

  const update = (patch: Partial<WellnessPrefs>) => {
    const next = { ...prefs, ...patch };
    writePrefs(next);
    setPrefs(next);
  };

  return [prefs, update];
}
