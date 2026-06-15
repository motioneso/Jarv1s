import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EMOTIONS } from "@jarv1s/shared";
import { queryKeys } from "../api/query-keys";
import { listWellnessCheckins, listMedicationLogs, listMedications } from "../api/client";
import { emoColor, type Theme } from "./emotion-taxonomy";
import { WellnessChart, type DayPoint } from "./wellness-chart";

function TrendingUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
function HelpCircleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleString("default", { month: "short", day: "numeric" });
}

interface Props {
  theme?: Theme;
}

export function WellnessTrends({ theme = "light" }: Props) {
  const [range, setRange] = useState<14 | 30>(30);
  const [helpOpen, setHelpOpen] = useState(false);

  const checkinsQuery = useQuery({
    queryKey: [...queryKeys.wellness.checkins, range],
    queryFn: () => listWellnessCheckins(range * 3) // over-fetch; we filter by date below
  });
  const logsQuery = useQuery({
    queryKey: queryKeys.wellness.logs(range),
    queryFn: () => listMedicationLogs(range)
  });
  const medsQuery = useQuery({
    queryKey: queryKeys.wellness.medications,
    queryFn: listMedications
  });

  const checkins = checkinsQuery.data?.checkins ?? [];
  const logs = logsQuery.data?.logs ?? [];
  const meds = medsQuery.data?.medications ?? [];
  const scheduledMeds = meds.filter((m) => m.frequencyType !== "as_needed");
  const denom = Math.max(1, scheduledMeds.length);

  // Build log counts per date (taken only)
  const logsByDate: Record<string, number> = {};
  logs.forEach((log) => {
    if (log.status === "taken") {
      const d = (log.scheduledFor ?? log.loggedAt ?? "").slice(0, 10);
      if (d) logsByDate[d] = (logsByDate[d] ?? 0) + 1;
    }
  });

  // Build checkin lookup by date (most-recent check-in per day)
  const checkinByDate: Record<string, (typeof checkins)[0]> = {};
  checkins.forEach((c) => {
    const d = (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10);
    if (d && !checkinByDate[d]) checkinByDate[d] = c;
  });

  const todayStr = isoDate(0);

  const days: DayPoint[] = Array.from({ length: range }, (_, i) => {
    const iso = isoDate(range - 1 - i);
    const taken = logsByDate[iso] ?? 0;
    return {
      date: iso,
      label: shortLabel(iso),
      isToday: iso === todayStr,
      checkin: checkinByDate[iso] ?? null,
      medFrac: taken / denom,
      medTaken: taken,
      medDenom: denom
    };
  });

  return (
    <section className="wl-sec">
      <div className="wl-sec__head">
        <div className="wl-sec__title">
          Trends<span className="sub">history</span>
        </div>
        <div className="wl-sec__aside">
          <div
            role="group"
            aria-label="Chart range"
            style={{
              display: "inline-flex",
              background: "var(--surface-2)",
              borderRadius: "var(--radius-pill)",
              padding: 3,
              border: "1px solid var(--border)"
            }}
          >
            {([14, 30] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={range === v}
                style={{
                  padding: "4px 14px",
                  border: 0,
                  borderRadius: "var(--radius-pill)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: range === v ? "var(--surface)" : "transparent",
                  color: range === v ? "var(--text)" : "var(--text-subtle)",
                  boxShadow: range === v ? "var(--shadow-xs)" : "none",
                  transition: "var(--transition-control)"
                }}
                onClick={() => setRange(v)}
              >
                {v} days
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wl-chartcard">
        <div className="wl-chart__hd">
          <div>
            <div className="wl-chart__title">
              <span className="ic">
                <TrendingUpIcon />
              </span>
              Mood &amp; medication
              <span className="wl-help">
                <button
                  type="button"
                  className={`wl-help__btn${helpOpen ? " is-on" : ""}`}
                  aria-label="How to read this chart"
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen((o) => !o)}
                >
                  <HelpCircleIcon />
                </button>
                {helpOpen ? (
                  <>
                    <div className="wl-help__scrim" onClick={() => setHelpOpen(false)} />
                    <div className="wl-help__pop" role="dialog">
                      <div className="wl-help__row">
                        <span className="wl-help__k">Mood line</span>
                        <span className="wl-help__v">
                          Each check-in becomes a number from <strong>Heavy</strong> (−5) to{" "}
                          <strong>Bright</strong> (+5). The dot&apos;s color is the emotion you
                          logged.
                        </span>
                      </div>
                      <div className="wl-help__row">
                        <span className="wl-help__k">Meds dots</span>
                        <span className="wl-help__v">
                          One dot per day for how much of your regimen you logged. Hover any day for
                          the full list.
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </span>
            </div>
          </div>
          <div className="wl-chart__legend">
            {EMOTIONS.map((em) => {
              const c = emoColor(em.core, theme);
              return (
                <span key={em.core} className="wl-leg">
                  <span className="wl-leg__dot" style={{ background: c.tint }} />
                  {em.core.charAt(0).toUpperCase() + em.core.slice(1)}
                </span>
              );
            })}
          </div>
        </div>
        <WellnessChart days={days} theme={theme} />
      </div>
    </section>
  );
}
