import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { CreateMedicationRequest, MedicationFrequencyTypeApi } from "@jarv1s/shared";

import { createMedication, listMedications, updateMedication } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { MedicationSchedule } from "./medication-schedule";

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: MedicationFrequencyTypeApi; label: string }> = [
  { value: "once_daily", label: "Once daily" },
  { value: "times_per_day", label: "N times per day" },
  { value: "specific_weekdays", label: "Specific weekdays" },
  { value: "every_n_hours", label: "Every N hours" },
  { value: "as_needed", label: "As needed (PRN)" },
  { value: "cyclical", label: "Cyclical" }
];

// ISO weekday order (1 = Monday … 7 = Sunday) — matches the route/DB weekday contract.
const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" }
];

export function MedicationsView() {
  const queryClient = useQueryClient();
  const medsQuery = useQuery({
    queryKey: queryKeys.wellness.medications,
    queryFn: listMedications
  });
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequencyType, setFrequencyType] = useState<MedicationFrequencyTypeApi>("once_daily");
  const [scheduleTimes, setScheduleTimes] = useState("08:00");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [intervalHours, setIntervalHours] = useState("8");
  const [cycleAnchorDate, setCycleAnchorDate] = useState("");
  const [cycleDaysOn, setCycleDaysOn] = useState("21");
  const [cycleDaysOff, setCycleDaysOff] = useState("7");

  // Which fields each frequency type needs (drives both the inputs shown and the payload built).
  const needsTimes = frequencyType !== "as_needed" && frequencyType !== "every_n_hours";
  const needsWeekdays = frequencyType === "specific_weekdays";
  const needsInterval = frequencyType === "every_n_hours";
  const needsCycle = frequencyType === "cyclical";

  const createMutation = useMutation({
    mutationFn: (input: CreateMedicationRequest) => createMedication(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
      setName("");
      setDosage("");
      setWeekdays([]);
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      updateMedication(input.id, { active: input.active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
    }
  });

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b)
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const times = scheduleTimes
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Build only the fields this frequency type allows. as_needed (PRN) must carry NO
    // scheduling/cycle fields (the DB CHECK rejects them); every_n_hours uses intervalHours
    // and NO schedule_times; cyclical needs an anchor + on/off days + one anchor time.
    const input: CreateMedicationRequest = {
      name: name.trim(),
      dosage: dosage.trim() ? dosage.trim() : null,
      frequencyType,
      scheduleTimes: needsTimes ? times : null,
      timesPerDay: frequencyType === "times_per_day" ? times.length || 1 : null,
      intervalHours: needsInterval ? Number(intervalHours) || null : null,
      weekdays: needsWeekdays ? weekdays : null,
      cycleAnchorDate: needsCycle ? cycleAnchorDate || null : null,
      cycleDaysOn: needsCycle ? Number(cycleDaysOn) || null : null,
      cycleDaysOff: needsCycle ? Number(cycleDaysOff) || null : null
    };
    createMutation.mutate(input);
  }

  return (
    <div className="medications-view">
      <MedicationSchedule />

      <section aria-label="Medications">
        <h3>Medications</h3>
        <form className="medication-form" onSubmit={submit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Sertraline)"
            aria-label="Medication name"
          />
          <input
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            placeholder="Dosage (e.g. 50 mg)"
            aria-label="Dosage"
          />
          <select
            value={frequencyType}
            onChange={(e) => setFrequencyType(e.target.value as MedicationFrequencyTypeApi)}
            aria-label="Frequency"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {needsTimes ? (
            <input
              value={scheduleTimes}
              onChange={(e) => setScheduleTimes(e.target.value)}
              placeholder="Times (e.g. 08:00, 20:00)"
              aria-label="Schedule times"
            />
          ) : null}
          {needsInterval ? (
            <input
              type="number"
              min={1}
              max={24}
              value={intervalHours}
              onChange={(e) => setIntervalHours(e.target.value)}
              placeholder="Every N hours (1–24)"
              aria-label="Interval hours"
            />
          ) : null}
          {needsWeekdays ? (
            <fieldset className="weekday-picker" aria-label="Weekdays">
              <legend>Days of week</legend>
              {WEEKDAY_OPTIONS.map((day) => (
                <label key={day.value} className="weekday-option">
                  <input
                    type="checkbox"
                    checked={weekdays.includes(day.value)}
                    onChange={() => toggleWeekday(day.value)}
                    aria-label={day.label}
                  />
                  {day.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {needsCycle ? (
            <div className="cycle-fields">
              <label className="field-label">
                Cycle start
                <input
                  type="date"
                  value={cycleAnchorDate}
                  onChange={(e) => setCycleAnchorDate(e.target.value)}
                  aria-label="Cycle anchor date"
                />
              </label>
              <label className="field-label">
                Days on
                <input
                  type="number"
                  min={1}
                  value={cycleDaysOn}
                  onChange={(e) => setCycleDaysOn(e.target.value)}
                  aria-label="Cycle days on"
                />
              </label>
              <label className="field-label">
                Days off
                <input
                  type="number"
                  min={0}
                  value={cycleDaysOff}
                  onChange={(e) => setCycleDaysOff(e.target.value)}
                  aria-label="Cycle days off"
                />
              </label>
            </div>
          ) : null}
          <button type="submit" className="primary-button" disabled={createMutation.isPending}>
            Add
          </button>
        </form>
        {createMutation.error ? (
          <p className="form-error">{readError(createMutation.error)}</p>
        ) : null}

        <ul className="medication-list">
          {(medsQuery.data?.medications ?? []).map((med) => (
            <li key={med.id} className={`medication-item ${med.active ? "" : "inactive"}`}>
              <span>
                {med.name}
                {med.dosage ? ` · ${med.dosage}` : ""}
              </span>
              <button
                type="button"
                className="ghost-button"
                onClick={() => toggleActiveMutation.mutate({ id: med.id, active: !med.active })}
              >
                {med.active ? "Deactivate" : "Reactivate"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not add medication";
}
