import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { moodIndex } from "@jarv1s/shared";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { WellnessRepository } from "./repository.js";
import { serializeCheckin } from "./serialize.js";

const repository = new WellnessRepository();
const preferences = new PreferencesRepository();

export const wellnessRecentCheckInsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const consent = await preferences.get(scopedDb, "wellness.ai_consent_granted");
  if (!consent) {
    return {
      data: { error: "Consent not granted", code: "WELLNESS_CONSENT_REQUIRED" }
    };
  }
  const checkins = await repository.listCheckins(scopedDb, { limit: 20 });
  return {
    data: {
      items: checkins.map((c) => {
        const dto = serializeCheckin(c);
        return {
          checkedInAt: dto.checkedInAt,
          feelingCore: dto.feelingCore,
          feelingSecondary: dto.feelingSecondary,
          intensity: dto.intensity,
          moodIndex: dto.intensity != null ? moodIndex(dto.feelingCore, dto.intensity) : null
        };
      })
    },
    columnOrder: ["checkedInAt", "feelingCore", "feelingSecondary", "intensity", "moodIndex"]
  };
};

export const wellnessMedicationAdherenceExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  // Counts/status only — never a full medication list (privacy posture).
  const logs = await repository.listRecentLogs(scopedDb, { sinceDays: 7 });
  const taken = logs.filter((l) => l.status === "taken").length;
  const skipped = logs.filter((l) => l.status === "skipped").length;
  const prn = logs.filter((l) => l.status === "prn").length;
  const scheduled = taken + skipped;
  return {
    data: {
      windowDays: 7,
      scheduled,
      taken,
      skipped,
      prn,
      adherenceRate: scheduled > 0 ? Math.round((taken / scheduled) * 100) / 100 : null
    }
  };
};
