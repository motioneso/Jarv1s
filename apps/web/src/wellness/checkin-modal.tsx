import { useEffect, useState } from "react";
import { EMOTIONS } from "@jarv1s/shared";
import { emVars, coreLabel, type WellnessEmotionCore, type Theme } from "./emotion-taxonomy";
import { CheckinDetailFields } from "./checkin-detail-fields";
import { RadialDial } from "./radial-dial";

export interface CheckinFormValue {
  emotion: WellnessEmotionCore;
  feeling: string;
  sensations: string[];
  intensity: number;
  note: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (value: CheckinFormValue) => void;
  initial?: CheckinFormValue | null;
  seedEmotion?: WellnessEmotionCore | null;
  theme?: Theme;
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function CheckinModal({
  open,
  onClose,
  onSave,
  initial,
  seedEmotion,
  theme = "light"
}: Props) {
  const [emotion, setEmotion] = useState<WellnessEmotionCore | null>(null);
  const [feeling, setFeeling] = useState<string | null>(null);
  const [sensations, setSensations] = useState<string[]>([]);
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setEmotion(initial.emotion);
      setFeeling(initial.feeling);
      setSensations(initial.sensations.slice());
      setIntensity(initial.intensity);
      setNote(initial.note);
    } else if (seedEmotion) {
      setEmotion(seedEmotion);
      setFeeling(null);
      setSensations([]);
      setIntensity(3);
      setNote("");
    } else {
      setEmotion(null);
      setFeeling(null);
      setSensations([]);
      setIntensity(3);
      setNote("");
    }
  }, [open, initial, seedEmotion]);

  if (!open) return null;

  const e = emotion ? EMOTIONS.find((x) => x.core === emotion) : null;
  const canSave = emotion != null && feeling != null;

  const pickEmotion = (k: WellnessEmotionCore) => {
    setEmotion(k);
    setFeeling(null);
    setSensations([]);
  };

  const toggleSensation = (s: string) => {
    setSensations((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const save = () => {
    if (!emotion || !feeling) return;
    onSave({ emotion, feeling, sensations, intensity, note: note.trim() });
    onClose();
  };

  const FeelingChips = () => {
    if (!e) return null;
    return (
      <div className="wl-chipwrap" style={emVars(emotion, theme)}>
        {e.feelings.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`wl-fchip${feeling === f.label ? " is-on" : ""}`}
            onClick={() => setFeeling(f.label)}
          >
            {f.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      className="wl-modal-scrim"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="wl-modal" role="dialog" aria-modal="true" aria-labelledby="wl-modal-title">
        <div className="wl-modal__head">
          <div className="hm">
            <div className="wl-modal__eyebrow">
              {initial ? "Edit check-in" : "Mental-health check-in"}
            </div>
            <div className="wl-modal__title" id="wl-modal-title">
              How are you feeling right now?
            </div>
          </div>
          <button type="button" className="wl-modal__x" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="wl-modal__body">
          <div>
            <div className="wl-q">What are you feeling?</div>
            <div className="wl-qsub">Tap your core emotion on the wheel.</div>
            <RadialDial value={emotion} onPick={pickEmotion} theme={theme} />
            {emotion && feeling ? (
              <div
                style={{
                  marginTop: 22,
                  paddingTop: 20,
                  borderTop: "1px solid var(--border-subtle)",
                  ...emVars(emotion, theme)
                }}
              >
                <CheckinDetailFields
                  emotion={emotion}
                  feeling={feeling}
                  sensations={sensations}
                  intensity={intensity}
                  note={note}
                  onSensation={toggleSensation}
                  onIntensity={setIntensity}
                  onNote={setNote}
                  theme={theme}
                />
              </div>
            ) : emotion ? (
              <div style={{ marginTop: 18 }}>
                <div className="wl-q" style={{ fontSize: 15 }}>
                  Which shade of {coreLabel(emotion)}?
                </div>
                <FeelingChips />
              </div>
            ) : null}
          </div>
        </div>
        <div className="wl-modal__foot">
          <span className="spacer" />
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
            {initial ? "Update check-in" : "Save check-in"}
          </button>
        </div>
      </div>
    </div>
  );
}
