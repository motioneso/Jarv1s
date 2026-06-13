import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getMedicationSchedule, logMedicationDose } from "../api/client";
import { queryKeys } from "../api/query-keys";

function todayIso(): string {
  // LOCAL civil date (NOT UTC) — the server treats this as the civil day to schedule.
  // Using toISOString() here would roll to the wrong day near midnight (Codex R1).
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function MedicationSchedule() {
  const queryClient = useQueryClient();
  const date = todayIso();
  const scheduleQuery = useQuery({
    queryKey: queryKeys.wellness.schedule(date),
    queryFn: () => getMedicationSchedule(date)
  });

  const logMutation = useMutation({
    mutationFn: (input: {
      medicationId: string;
      status: "taken" | "skipped" | "prn";
      scheduledFor: string | null;
      prnReason?: string;
    }) =>
      logMedicationDose(input.medicationId, {
        status: input.status,
        scheduledFor: input.scheduledFor,
        prnReason: input.prnReason ?? null
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.schedule(date) });
    }
  });

  if (scheduleQuery.isLoading) return <p>Loading schedule…</p>;
  const slots = scheduleQuery.data?.slots ?? [];

  return (
    <section className="medication-schedule" aria-label="Today's medications">
      <h3>Today</h3>
      {slots.length === 0 ? <p className="muted">No medications scheduled.</p> : null}
      <ul className="schedule-list">
        {slots.map((slot, i) => (
          <li
            key={`${slot.medicationId}-${i.toString()}`}
            className={`schedule-slot ${slot.status}`}
          >
            <span className="slot-name">{slot.name}</span>
            <span className="slot-time">
              {slot.asNeeded ? "As needed" : (slot.scheduledFor?.slice(11, 16) ?? "")}
            </span>
            <span className="slot-actions">
              {slot.asNeeded ? (
                <button
                  type="button"
                  onClick={() => {
                    const reason = window.prompt("Reason for this PRN dose?") ?? "";
                    if (reason.trim()) {
                      logMutation.mutate({
                        medicationId: slot.medicationId,
                        status: "prn",
                        scheduledFor: null,
                        prnReason: reason.trim()
                      });
                    }
                  }}
                >
                  Log as needed
                </button>
              ) : slot.status === "pending" ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      logMutation.mutate({
                        medicationId: slot.medicationId,
                        status: "taken",
                        scheduledFor: slot.scheduledFor
                      })
                    }
                  >
                    Taken
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      logMutation.mutate({
                        medicationId: slot.medicationId,
                        status: "skipped",
                        scheduledFor: slot.scheduledFor
                      })
                    }
                  >
                    Skip
                  </button>
                </>
              ) : (
                <span className="slot-status">{slot.status}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
