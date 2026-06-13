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

  const createMutation = useMutation({
    mutationFn: (input: CreateMedicationRequest) => createMedication(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
      setName("");
      setDosage("");
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      updateMedication(input.id, { active: input.active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.medications });
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const times = scheduleTimes
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    createMutation.mutate({
      name: name.trim(),
      dosage: dosage.trim() ? dosage.trim() : null,
      frequencyType,
      scheduleTimes: frequencyType === "as_needed" ? null : times,
      timesPerDay: frequencyType === "times_per_day" ? times.length || 1 : null
    });
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
          {frequencyType !== "as_needed" ? (
            <input
              value={scheduleTimes}
              onChange={(e) => setScheduleTimes(e.target.value)}
              placeholder="Times (e.g. 08:00, 20:00)"
              aria-label="Schedule times"
            />
          ) : null}
          <button type="submit" className="primary-button" disabled={createMutation.isPending}>
            Add
          </button>
        </form>

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
