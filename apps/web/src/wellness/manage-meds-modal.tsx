import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MedicationFrequencyTypeApi } from "@jarv1s/shared";
import { createMedication, listMedications, updateMedication } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { medColor, type Theme } from "./emotion-taxonomy";

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
function Trash2Icon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  theme?: Theme;
}

export function ManageMedsModal({ open, onClose, theme = "light" }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [freq, setFreq] = useState<MedicationFrequencyTypeApi>("once_daily");

  const medsQuery = useQuery({
    queryKey: queryKeys.wellness.medications,
    queryFn: listMedications,
    enabled: open
  });

  const addMutation = useMutation({
    mutationFn: () =>
      createMedication({
        name: name.trim(),
        dosage: dose.trim() || null,
        frequencyType: freq,
        scheduleTimes: freq !== "as_needed" ? ["08:00"] : null,
        timesPerDay: null,
        intervalHours: null,
        weekdays: null,
        cycleAnchorDate: null,
        cycleDaysOn: null,
        cycleDaysOff: null
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
      setName("");
      setDose("");
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => updateMedication(id, { active: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
    }
  });

  if (!open) return null;

  const meds = (medsQuery.data?.medications ?? []).filter((m) => m.active);

  return (
    <div
      className="wl-modal-scrim"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="wl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meds-modal-title"
        style={{ maxWidth: 540 }}
      >
        <div className="wl-modal__head">
          <div className="hm">
            <div className="wl-modal__eyebrow">Settings</div>
            <div className="wl-modal__title" id="meds-modal-title">
              Manage medications
            </div>
          </div>
          <button type="button" className="wl-modal__x" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="wl-modal__body">
          <div className="wl-medlist" style={{ marginBottom: 8 }}>
            {meds.map((m, i) => {
              const c = medColor(i, theme);
              return (
                <div key={m.id} className="wl-medrow" style={{ cursor: "default" }}>
                  <span className="wl-medrow__dot" style={{ background: c.tint }} />
                  <span className="wl-medrow__main">
                    <span className="wl-medrow__name">{m.name}</span>
                    <span className="wl-medrow__sub">
                      {m.dosage ? <span className="dose">{m.dosage}</span> : null}
                      {m.dosage ? " · " : ""}
                      {m.frequencyType === "as_needed"
                        ? "as needed"
                        : m.frequencyType.replace(/_/g, " ")}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="wl-tnote__x"
                    style={{ opacity: 1 }}
                    aria-label={`Remove ${m.name}`}
                    onClick={() => deactivateMutation.mutate(m.id)}
                  >
                    <Trash2Icon />
                  </button>
                </div>
              );
            })}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: 14,
              marginTop: 4
            }}
          >
            <div className="wl-hdetail__lbl" style={{ marginBottom: 10 }}>
              Add a medication
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
              <input
                placeholder="Name (e.g. Bupropion)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Medication name"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 12px",
                  fontSize: 14,
                  background: "var(--surface)",
                  color: "var(--text)"
                }}
              />
              <input
                placeholder="Dose (e.g. 50 mg)"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                aria-label="Dose"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 12px",
                  fontSize: 14,
                  background: "var(--surface)",
                  color: "var(--text)"
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 10,
                alignItems: "center"
              }}
            >
              <select
                value={freq}
                onChange={(e) => setFreq(e.target.value as MedicationFrequencyTypeApi)}
                style={{
                  flex: 1,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 12px",
                  fontSize: 14,
                  background: "var(--surface)",
                  color: "var(--text)"
                }}
              >
                <option value="once_daily">Morning (once daily)</option>
                <option value="times_per_day">Evening (twice daily)</option>
                <option value="as_needed">As needed (PRN)</option>
              </select>
              <button
                type="button"
                className="secondary-button"
                style={{ gap: 6, fontSize: 13, padding: "6px 14px", minHeight: "unset" }}
                disabled={!name.trim() || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                <PlusIcon />
                Add
              </button>
            </div>
          </div>
        </div>
        <div className="wl-modal__foot">
          <span className="spacer" />
          <button type="button" className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
