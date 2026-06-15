import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EMOTIONS, type CheckinDto, type DayAdherenceSummaryDto } from "@jarv1s/shared";
import { queryKeys } from "../api/query-keys";
import { listWellnessCheckins, getMedicationAdherenceSummary } from "../api/client";
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
  const adherenceQuery = useQuery({
    queryKey: queryKeys.wellness.adherenceSummary(range),
    queryFn: () => getMedicationAdherenceSummary(range)
  });

  const checkins = checkinsQuery.data?.checkins ?? [];

  // Build adherence lookup by date
  const summaryByDate: Record<string, DayAdherenceSummaryDto> = {};
  (adherenceQuery.data?.days ?? []).forEach((d) => {
    summaryByDate[d.date] = d;
  });

  // Build checkin lookup by date (all check-ins per day; list is newest-first)
  const checkinsByDate: Record<string, CheckinDto[]> = {};
  checkins.forEach((c) => {
    const d = (c.checkedInAt ?? c.createdAt ?? "").slice(0, 10);
    if (!d) return;
    (checkinsByDate[d] ??= []).push(c);
  });

  const todayStr = isoDate(0);

  const days: DayPoint[] = Array.from({ length: range }, (_, i) => {
    const iso = isoDate(range - 1 - i);
    const summary = summaryByDate[iso] ?? null;
    return {
      date: iso,
      label: shortLabel(iso),
      isToday: iso === todayStr,
      checkin: (checkinsByDate[iso] ?? [])[0] ?? null,
      checkins: checkinsByDate[iso] ?? [],
      medFrac:
        summary && summary.scheduledCount > 0 ? summary.takenCount / summary.scheduledCount : 0,
      medTaken: summary?.takenCount ?? 0,
      medDenom: summary?.scheduledCount ?? 0,
      doses: summary?.doses ?? []
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

      {checkinsQuery.isError || adherenceQuery.isError ? (
        <div className="wl-chartcard" style={{ padding: "16px 20px" }}>
          <span style={{ fontSize: 13, color: "var(--text-subtle)" }}>
            Couldn&apos;t load trend data — try refreshing.
          </span>
        </div>
      ) : (
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
                            One dot per day for how much of your regimen you logged. Hover any day
                            for the full list.
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
      )}
    </section>
  );
}
