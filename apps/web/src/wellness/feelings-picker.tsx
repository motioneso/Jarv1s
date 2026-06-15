import { EMOTIONS, WELLNESS_EMOTION_CORES } from "@jarv1s/shared";
import type { WellnessEmotionCore } from "@jarv1s/shared";

export interface FeelingsSelection {
  readonly core: WellnessEmotionCore;
  readonly secondary: string | null;
  /** Always null in the 2-level taxonomy (core → feeling only). */
  readonly tertiary: null;
}

interface FeelingsPickerProps {
  readonly value: FeelingsSelection | null;
  readonly onChange: (selection: FeelingsSelection) => void;
}

/**
 * BASIC, functional feelings picker — two dependent <select>s (core → feeling).
 * Uses the new jarvis-emotion-v1 taxonomy (2-level: no tertiary). Data comes from
 * the browser-safe @jarv1s/shared EMOTIONS list. Phase-3 will replace with the
 * polished palette/wheel UI from the design.
 */
export function FeelingsPicker(props: FeelingsPickerProps) {
  const coreEntry = props.value
    ? (EMOTIONS.find((e) => e.core === props.value!.core) ?? null)
    : null;

  return (
    <div className="feelings-picker">
      <label className="field-label">
        Feeling
        <select
          value={props.value?.core ?? ""}
          onChange={(e) =>
            props.onChange({
              core: e.target.value as WellnessEmotionCore,
              secondary: null,
              tertiary: null
            })
          }
          aria-label="Core emotion"
        >
          <option value="" disabled>
            Choose…
          </option>
          {WELLNESS_EMOTION_CORES.map((core) => (
            <option key={core} value={core}>
              {capitalize(core)}
            </option>
          ))}
        </select>
      </label>

      {coreEntry ? (
        <label className="field-label">
          More specific (optional)
          <select
            value={props.value?.secondary ?? ""}
            onChange={(e) =>
              props.onChange({
                core: coreEntry.core,
                secondary: e.target.value || null,
                tertiary: null
              })
            }
            aria-label="Feeling"
          >
            <option value="">—</option>
            {coreEntry.feelings.map((f) => (
              <option key={f.label} value={f.label}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
