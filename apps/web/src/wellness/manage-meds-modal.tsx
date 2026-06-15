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
  const [freqType, setFreqType] = useState<MedicationFrequencyTypeApi>("once_daily");
  const [timesPerDay, setTimesPerDay] = useState(2);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(["08:00"]);

  const handleFreqChange = (f: MedicationFrequencyTypeApi) => {
    setFreqType(f);
    if (f === "once_daily") {
      setScheduleTimes(["08:00"]);
    } else if (f === "times_per_day") {
      setTimesPerDay(2);
      setScheduleTimes(["08:00", "20:00"]);
    } else {
      setScheduleTimes([]);
    }
  };

  const isValidTime = (t: string) => /^\d{2}:\d{2}$/.test(t) && t >= "00:00" && t <= "23:59";

  const timesInvalid =
    freqType !== "as_needed" &&
    scheduleTimes
      .slice(0, freqType === "once_daily" ? 1 : timesPerDay)
      .some((t) => !isValidTime(t));

  const medsQuery = useQuery({
    queryKey: queryKeys.wellness.medications,
    queryFn: listMedications,
    enabled: open
  });

  const addMutation = useMutation({
    mutationFn: () => {
      const base = { name: name.trim(), dosage: dose.trim() || null, frequencyType: freqType };
      if (freqType === "as_needed") {
        return createMedication(base);
      }
      if (freqType === "times_per_day") {
        return createMedication({
          ...base,
          timesPerDay,
          scheduleTimes: scheduleTimes.slice(0, timesPerDay)
        });
      }
      return createMedication({ ...base, scheduleTimes });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
      void queryClient.invalidateQueries({ queryKey: ["wellness", "schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["wellness", "adherence-summary"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
      setName("");
      setDose("");
      setFreqType("once_daily");
      setScheduleTimes(["08:00"]);
      setTimesPerDay(2);
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => updateMedication(id, { active: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
      void queryClient.invalidateQueries({ queryKey: ["wellness", "schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["wellness", "adherence-summary"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wellness.insights });
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
            <div style={{ marginTop: 10 }}>
              <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>
                Frequency
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["once_daily", "times_per_day", "as_needed"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => handleFreqChange(f)}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      fontSize: 13,
                      borderRadius: "var(--radius-md)",
                      border: `1.5px solid ${freqType === f ? "var(--accent)" : "var(--border)"}`,
                      background: freqType === f ? "var(--accent-subtle)" : "var(--surface)",
                      color: freqType === f ? "var(--accent-fg)" : "var(--text)",
                      cursor: "pointer"
                    }}
                  >
                    {f === "once_daily"
                      ? "Once daily"
                      : f === "times_per_day"
                        ? "Multiple/day"
                        : "As needed"}
                  </button>
                ))}
              </div>
            </div>

            {freqType === "times_per_day" ? (
              <div style={{ marginTop: 10 }}>
                <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>
                  Times per day
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ fontSize: 14, padding: "4px 12px", minHeight: "unset" }}
                    disabled={timesPerDay <= 2}
                    onClick={() => {
                      const n = timesPerDay - 1;
                      setTimesPerDay(n);
                      setScheduleTimes((t) => t.slice(0, n));
                    }}
                  >
                    −
                  </button>
                  <span style={{ fontSize: 15, minWidth: 20, textAlign: "center" }}>
                    {timesPerDay}
                  </span>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ fontSize: 14, padding: "4px 12px", minHeight: "unset" }}
                    disabled={timesPerDay >= 6}
                    onClick={() => {
                      const n = timesPerDay + 1;
                      setTimesPerDay(n);
                      setScheduleTimes((t) => {
                        const copy = [...t];
                        while (copy.length < n) copy.push("12:00");
                        return copy;
                      });
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            ) : null}

            {freqType !== "as_needed" ? (
              <div style={{ marginTop: 10 }}>
                <div className="wl-hdetail__lbl" style={{ marginBottom: 6 }}>
                  {freqType === "once_daily" ? "Time of day" : "Times of day"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {scheduleTimes
                    .slice(0, freqType === "once_daily" ? 1 : timesPerDay)
                    .map((t, i) => (
                      <div key={i}>
                        <input
                          type="time"
                          value={t}
                          onChange={(e) =>
                            setScheduleTimes((prev) => {
                              const copy = [...prev];
                              copy[i] = e.target.value;
                              return copy;
                            })
                          }
                          aria-label={`Dose time ${i + 1}`}
                          style={{
                            border: `1px solid ${!isValidTime(t) && t !== "" ? "var(--color-error, #e53e3e)" : "var(--border)"}`,
                            borderRadius: "var(--radius-md)",
                            padding: "7px 12px",
                            fontSize: 14,
                            background: "var(--surface)",
                            color: "var(--text)",
                            width: "100%",
                            boxSizing: "border-box"
                          }}
                        />
                        {!isValidTime(t) && t !== "" ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--color-error, #e53e3e)",
                              marginTop: 2
                            }}
                          >
                            Enter a valid time (HH:MM)
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: "var(--text-subtle)",
                  fontStyle: "italic"
                }}
              >
                As-needed medications have no fixed schedule.
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="secondary-button"
                style={{ gap: 6, fontSize: 13, padding: "6px 14px", minHeight: "unset" }}
                disabled={!name.trim() || timesInvalid || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                <PlusIcon />
                Add medication
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
