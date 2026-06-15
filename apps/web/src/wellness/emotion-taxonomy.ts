// Thin re-export + frontend color helpers for the wellness emotion taxonomy.
// Colors are frontend-only (oklch ramp, theme-aware). Never import node:* here.
import {
  EMOTIONS,
  EMOTION_POLARITY,
  moodIndex,
  moodBand,
  type WellnessEmotionCore,
  type EmotionEntry,
  type EmotionFeeling
} from "@jarv1s/shared";

export { EMOTIONS, EMOTION_POLARITY, moodIndex, moodBand };
export type { WellnessEmotionCore, EmotionEntry, EmotionFeeling };

/** Look up an EmotionEntry by core key. */
export function getEmotion(core: WellnessEmotionCore): EmotionEntry {
  const entry = EMOTIONS.find((e) => e.core === core);
  if (!entry) throw new Error(`Unknown emotion core: ${core}`);
  return entry;
}

/** oklch hue for each core (muted, editorial — matches design's wellness-data.js). */
const EMOTION_HUES: Readonly<Record<WellnessEmotionCore, number>> = {
  happy: 150,
  sad: 245,
  fear: 65,
  anger: 28,
  disgust: 318,
  surprise: 100
};

export interface ColorRamp {
  readonly soft: string;
  readonly soft2: string;
  readonly tint: string;
  readonly ink: string;
  readonly line: string;
}

export type Theme = "light" | "dark";

/** Theme-aware muted oklch color ramp for a given hue. */
function ramp(hue: number, theme: Theme): ColorRamp {
  if (theme === "dark") {
    return {
      soft: `oklch(0.32 0.045 ${hue})`,
      soft2: `oklch(0.39 0.055 ${hue})`,
      tint: `oklch(0.70 0.110 ${hue})`,
      ink: `oklch(0.84 0.080 ${hue})`,
      line: `oklch(0.72 0.115 ${hue})`
    };
  }
  return {
    soft: `oklch(0.955 0.028 ${hue})`,
    soft2: `oklch(0.905 0.045 ${hue})`,
    tint: `oklch(0.620 0.115 ${hue})`,
    ink: `oklch(0.450 0.090 ${hue})`,
    line: `oklch(0.580 0.120 ${hue})`
  };
}

/** Theme-aware color ramp for an emotion core. */
export function emoColor(core: WellnessEmotionCore, theme: Theme = "light"): ColorRamp {
  return ramp(EMOTION_HUES[core] ?? 150, theme);
}

/** Med hue cycling — pleasant oklch hues rotated by index. */
const MED_HUES = [200, 340, 130, 45, 280, 95, 15];
export function medColor(idx: number, theme: Theme = "light"): ColorRamp {
  return ramp(MED_HUES[idx % MED_HUES.length] ?? 150, theme);
}

/** CSS custom properties dict for an emotion color set — spread onto style prop. */
export function emVars(
  core: WellnessEmotionCore | null,
  theme: Theme = "light"
): Record<string, string> {
  if (!core) return {};
  const c = emoColor(core, theme);
  return { "--em-soft": c.soft, "--em-tint": c.tint, "--em-ink": c.ink };
}

/** Human label for a mood band key. */
export const MOOD_BAND_LABELS: Readonly<Record<string, string>> = {
  bright: "Bright",
  lifted: "Lifted",
  even: "Even",
  low: "Low",
  heavy: "Heavy"
};

/** Capitalize a core key for display. */
export function coreLabel(core: WellnessEmotionCore): string {
  return core.charAt(0).toUpperCase() + core.slice(1);
}
