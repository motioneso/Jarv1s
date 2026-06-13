import { assertDataContextDb } from "@jarv1s/db";
import type { FocusSignalProvider } from "@jarv1s/module-sdk";

import { WellnessRepository } from "./repository.js";

const repository = new WellnessRepository();

/**
 * Derive a normalized readiness in [0,1] from recent self-rated ENERGY (1–5 → 0–1) — NOT
 * from emotion intensity (a calm low-intensity feeling is not low readiness; Codex R1).
 * Only check-ins that recorded an explicit `energy` value contribute. Returns null when no
 * recent check-in carries an energy rating, so the focus path is unaffected for users who
 * never rate energy. The summary is abstracted ("energy trended low") — never raw feelings/meds.
 */
export const wellnessFocusSignal: FocusSignalProvider = async (scopedDb, _ctx) => {
  assertDataContextDb(scopedDb);
  const recent = await repository.listCheckins(scopedDb, { limit: 7 });
  const energies = recent.map((c) => c.energy).filter((n): n is number => typeof n === "number");
  if (energies.length === 0) return null;

  const avg = energies.reduce((sum, n) => sum + n, 0) / energies.length;
  const readiness = Math.min(1, Math.max(0, (avg - 1) / 4)); // energy 1→0, 5→1
  const level = readiness <= 0.35 ? "low" : readiness >= 0.7 ? "high" : "moderate";
  return {
    moduleId: "wellness",
    readiness,
    summary: `Energy trended ${level} over recent check-ins.`
  };
};
