import { useEffect, useState } from "react";
import { EMOTIONS } from "@jarv1s/shared";
import {
  emoColor,
  emVars,
  coreLabel,
  type WellnessEmotionCore,
  type Theme
} from "./emotion-taxonomy";
import { CheckinDetailFields } from "./checkin-detail-fields";
import { useWellnessPrefs } from "./wellness-prefs";
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

function ChevLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
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

type PickerStyle = "Guided" | "Palette" | "Radial";

export function CheckinModal({
  open,
  onClose,
  onSave,
  initial,
  seedEmotion,
  theme = "light"
}: Props) {
  const [prefs] = useWellnessPrefs();
  const pickerStyle = (prefs.radial ? "Radial" : "Guided") as PickerStyle;
  const [emotion, setEmotion] = useState<WellnessEmotionCore | null>(null);
  const [feeling, setFeeling] = useState<string | null>(null);
  const [sensations, setSensations] = useState<string[]>([]);
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");
  const [step, setStep] = useState(0); // for Guided
  const [openFam, setOpenFam] = useState<WellnessEmotionCore | null>(null); // for Palette

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setEmotion(initial.emotion);
      setFeeling(initial.feeling);
      setSensations(initial.sensations.slice());
      setIntensity(initial.intensity);
      setNote(initial.note);
      setStep(2);
      setOpenFam(initial.emotion);
    } else if (seedEmotion) {
      setEmotion(seedEmotion);
      setFeeling(null);
      setSensations([]);
      setIntensity(3);
      setNote("");
      setStep(1);
      setOpenFam(seedEmotion);
    } else {
      setEmotion(null);
      setFeeling(null);
      setSensations([]);
      setIntensity(3);
      setNote("");
      setStep(0);
      setOpenFam(null);
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

  let body: React.ReactNode;
  let foot: React.ReactNode;

  if (pickerStyle === "Palette") {
    body = (
      <div>
        <div className="wl-q">What are you feeling?</div>
        <div className="wl-qsub">Open a family, then choose the closest word.</div>
        <div className="wl-palette">
          {EMOTIONS.map((em) => {
            const isOpen = openFam === em.core;
            const c = emoColor(em.core, theme);
            return (
              <div
                key={em.core}
                className={`wl-palrow${isOpen ? " is-open" : ""}`}
                style={emVars(em.core, theme)}
              >
                <button
                  type="button"
                  className="wl-palrow__head"
                  onClick={() => setOpenFam(isOpen ? null : em.core)}
                >
                  <span className="wl-palrow__dot" style={{ background: c.tint }} />
                  <span className="wl-palrow__name">{coreLabel(em.core)}</span>
                  <span className="wl-palrow__blurb">{em.blurb}</span>
                  <span className="wl-palrow__chev">
                    <ChevDown />
                  </span>
                </button>
                {isOpen ? (
                  <div className="wl-palrow__body">
                    <div className="wl-chipwrap">
                      {em.feelings.map((f) => (
                        <button
                          key={f.label}
                          type="button"
                          className={`wl-fchip${emotion === em.core && feeling === f.label ? " is-on" : ""}`}
                          onClick={() => {
                            setEmotion(em.core);
                            setFeeling(f.label);
                            if (emotion !== em.core) setSensations([]);
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {canSave && emotion && feeling ? (
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
        ) : null}
      </div>
    );
    foot = (
      <>
        <span className="spacer" />
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
          {initial ? "Update check-in" : "Save check-in"}
        </button>
      </>
    );
  } else if (pickerStyle === "Radial") {
    body = (
      <div>
        <div className="wl-q">What are you feeling?</div>
        <div className="wl-qsub">Tap your core emotion on the wheel.</div>
        <RadialDial
          value={emotion}
          onPick={(k) => {
            pickEmotion(k);
            setStep(1);
          }}
          theme={theme}
        />
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
    );
    foot = (
      <>
        <span className="spacer" />
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
          {initial ? "Update check-in" : "Save check-in"}
        </button>
      </>
    );
  } else {
    // Guided (default, 3 steps)
    if (step === 0) {
      body = (
        <div>
          <div className="wl-q">What&apos;s the core of it?</div>
          <div className="wl-qsub">
            Start broad — you&apos;ll narrow down next. There&apos;s no wrong answer.
          </div>
          <div className="wl-emogrid">
            {EMOTIONS.map((em) => {
              const c = emoColor(em.core, theme);
              return (
                <button
                  key={em.core}
                  type="button"
                  className={`wl-emobtn${emotion === em.core ? " is-on" : ""}`}
                  style={emVars(em.core, theme)}
                  onClick={() => {
                    pickEmotion(em.core);
                    setStep(1);
                  }}
                >
                  <span className="wl-emobtn__dot" style={{ background: c.tint }} />
                  <span className="wl-emobtn__name">{coreLabel(em.core)}</span>
                  <span className="wl-emobtn__blurb">{em.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    } else if (step === 1) {
      body = (
        <div>
          <div className="wl-q">Which shade of {e?.core}?</div>
          <div className="wl-qsub">Pick the word that&apos;s closest.</div>
          <FeelingChips />
        </div>
      );
    } else {
      body =
        emotion && feeling ? (
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
        ) : null;
    }
    foot = (
      <>
        {step > 0 ? (
          <button type="button" className="wl-modal__back" onClick={() => setStep((s) => s - 1)}>
            <ChevLeft />
            Back
          </button>
        ) : (
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
        )}
        <div className="wl-steps">
          {[0, 1, 2].map((s) => (
            <span
              key={s}
              className={`wl-steps__d${s === step ? " is-on" : s < step ? " is-done" : ""}`}
            />
          ))}
        </div>
        <span className="spacer" />
        {step < 2 ? (
          <button
            type="button"
            className="primary-button"
            disabled={step === 0 ? !emotion : !feeling}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
            {initial ? "Update check-in" : "Save check-in"}
          </button>
        )}
      </>
    );
  }

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
        <div className="wl-modal__body">{body}</div>
        <div className="wl-modal__foot">{foot}</div>
      </div>
    </div>
  );
}
