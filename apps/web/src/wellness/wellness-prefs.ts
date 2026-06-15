import { useState, useEffect } from "react";

const PREFS_KEY = "jarvis.wellness.prefs";

export interface WellnessPrefs {
  radial: boolean;
}

const DEFAULTS: WellnessPrefs = { radial: false };

function readPrefs(): WellnessPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WellnessPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: WellnessPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable; prefs stay in-memory
  }
}

export function useWellnessPrefs(): [WellnessPrefs, (patch: Partial<WellnessPrefs>) => void] {
  const [prefs, setPrefs] = useState<WellnessPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(readPrefs());
  }, []);

  const update = (patch: Partial<WellnessPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writePrefs(next);
      return next;
    });
  };

  return [prefs, update];
}
