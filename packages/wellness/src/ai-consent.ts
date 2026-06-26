import type { DataContextDb } from "@jarv1s/db";
import type { ToolResult, ToolServices } from "@jarv1s/module-sdk";
import type { PreferencesRepository } from "@jarv1s/structured-state";

export const WELLNESS_AI_CONSENT_PREFERENCE_KEY = "wellness.ai_consent_granted";

export interface WellnessActiveService {
  readonly wellnessActive?: boolean;
}

export async function resolveEffectiveWellnessConsent(
  scopedDb: DataContextDb,
  preferences: PreferencesRepository,
  services: ToolServices | undefined,
  fallbackWellnessActive: boolean
): Promise<boolean> {
  const explicit = await preferences.get(scopedDb, WELLNESS_AI_CONSENT_PREFERENCE_KEY);
  if (explicit === true || explicit === false) return explicit;
  return (services as WellnessActiveService | undefined)?.wellnessActive ?? fallbackWellnessActive;
}

export async function readWellnessAiConsentState(
  scopedDb: DataContextDb,
  preferences: PreferencesRepository,
  wellnessActive: boolean
): Promise<{ effective: boolean; explicit: boolean | null }> {
  const explicit = await preferences.get(scopedDb, WELLNESS_AI_CONSENT_PREFERENCE_KEY);
  if (explicit === true || explicit === false) {
    return { effective: explicit, explicit };
  }
  return { effective: wellnessActive, explicit: null };
}

export function wellnessConsentRequiredResult(): ToolResult {
  return { data: { error: "Consent not granted", code: "WELLNESS_CONSENT_REQUIRED" } };
}
