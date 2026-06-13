import { FEELINGS_WHEEL, WELLNESS_FEELING_CORES } from "@jarv1s/shared";
import type { WellnessFeelingCore } from "@jarv1s/shared";

export interface FeelingsSelection {
  readonly core: WellnessFeelingCore;
  readonly secondary: string | null;
  readonly tertiary: string | null;
}

interface FeelingsPickerProps {
  readonly value: FeelingsSelection | null;
  readonly onChange: (selection: FeelingsSelection) => void;
}

/**
 * BASIC, functional feelings picker — three dependent <select>s (core → secondary →
 * tertiary). Deliberately NOT a polished colored wheel (deferred to a Ben UI session). Data
 * comes from the browser-safe @jarv1s/shared taxonomy, so restyling never touches logic.
 */
export function FeelingsPicker(props: FeelingsPickerProps) {
  const coreNode = props.value
    ? (FEELINGS_WHEEL.find((c) => c.core === props.value!.core) ?? null)
    : null;
  const secNode =
    coreNode && props.value?.secondary
      ? (coreNode.secondary.find((s) => s.name === props.value!.secondary) ?? null)
      : null;

  return (
    <div className="feelings-picker">
      <label className="field-label">
        Feeling
        <select
          value={props.value?.core ?? ""}
          onChange={(e) =>
            props.onChange({
              core: e.target.value as WellnessFeelingCore,
              secondary: null,
              tertiary: null
            })
          }
          aria-label="Core feeling"
        >
          <option value="" disabled>
            Choose…
          </option>
          {WELLNESS_FEELING_CORES.map((core) => (
            <option key={core} value={core}>
              {capitalize(core)}
            </option>
          ))}
        </select>
      </label>

      {coreNode ? (
        <label className="field-label">
          More specific (optional)
          <select
            value={props.value?.secondary ?? ""}
            onChange={(e) =>
              props.onChange({
                core: coreNode.core,
                secondary: e.target.value || null,
                tertiary: null
              })
            }
            aria-label="Secondary feeling"
          >
            <option value="">—</option>
            {coreNode.secondary.map((sec) => (
              <option key={sec.name} value={sec.name}>
                {capitalize(sec.name)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {secNode ? (
        <label className="field-label">
          Even more specific (optional)
          <select
            value={props.value?.tertiary ?? ""}
            onChange={(e) =>
              props.onChange({
                core: coreNode!.core,
                secondary: secNode.name,
                tertiary: e.target.value || null
              })
            }
            aria-label="Tertiary feeling"
          >
            <option value="">—</option>
            {secNode.tertiary.map((t) => (
              <option key={t} value={t}>
                {capitalize(t)}
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
