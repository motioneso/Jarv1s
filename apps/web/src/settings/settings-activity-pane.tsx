import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listActionAuditLog } from "../api/client.js";
import { queryKeys } from "../api/query-keys.js";
import { formatDateTime, useUserLocale } from "../locale/locale-format.js";
import type { PaneProps } from "./settings-types.js";
import { Select } from "./settings-ui.js";
import type { ActionAuditLogEntryDto } from "@jarv1s/shared";

type DateRange = "today" | "7d" | "30d" | "90d";

const RANGE_LABELS: Record<DateRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days"
};

function sinceForRange(range: DateRange): string {
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const offsets: Record<DateRange, number> = {
    today: 0,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000
  };
  return new Date(Date.now() - offsets[range]).toISOString();
}

function approvalLabel(mode: ActionAuditLogEntryDto["approvalMode"]): string {
  const labels: Record<typeof mode, string> = {
    auto: "Auto-run",
    yolo: "YOLO",
    confirmed: "Confirmed",
    rejected: "Declined",
    cancelled: "Cancelled",
    timeout: "Timed out"
  };
  return labels[mode];
}

function outcomeLabel(outcome: ActionAuditLogEntryDto["outcome"]): string {
  const labels: Record<typeof outcome, string> = {
    success: "Done",
    failed: "Failed",
    denied: "Declined",
    cancelled: "Cancelled"
  };
  return labels[outcome];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isDistinct(outcome: ActionAuditLogEntryDto["outcome"]): boolean {
  return outcome === "failed" || outcome === "denied";
}

export function ActivityPane(_props: PaneProps) {
  const locale = useUserLocale();
  const [range, setRange] = useState<DateRange>("30d");
  const [familyFilter, setFamilyFilter] = useState<string>("");

  const since = sinceForRange(range);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.ai.actionAuditLog({ since }),
    queryFn: () => listActionAuditLog({ since, limit: 200 })
  });

  const entries = data?.entries ?? [];

  const families = Array.from(
    new Set(
      entries.filter((e) => e.actionFamilyId).map((e) => `${e.toolModuleId}/${e.actionFamilyId}`)
    )
  );

  const filtered = familyFilter
    ? entries.filter((e) => `${e.toolModuleId}/${e.actionFamilyId}` === familyFilter)
    : entries;

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">Activity</h2>
        <p className="settings-section__desc">Actions Jarvis ran on your behalf, last 90 days.</p>
      </header>

      <div
        className="audfilter"
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
      >
        {(["today", "7d", "30d", "90d"] as DateRange[]).map((r) => (
          <button
            key={r}
            className={`jds-btn jds-btn--quiet jds-btn--sm${range === r ? " jds-btn--active" : ""}`}
            onClick={() => setRange(r)}
            type="button"
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
        {families.length > 0 && (
          <Select
            aria-label="Filter by action family"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
          >
            <option value="">All actions</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        )}
      </div>

      {isLoading && (
        <div className="aud__empty" aria-live="polite">
          Loading…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="aud__empty">
          <p>No Jarvis actions in this period.</p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className="aud__row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.75rem 0",
                borderBottom: "1px solid var(--jds-border)"
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{entry.toolName}</span>
                {entry.actionFamilyId && (
                  <span style={{ marginLeft: "0.375rem", opacity: 0.6, fontSize: "0.875em" }}>
                    {entry.actionFamilyId}
                  </span>
                )}
                <div
                  style={{
                    marginTop: "0.25rem",
                    display: "flex",
                    gap: "0.375rem",
                    flexWrap: "wrap"
                  }}
                >
                  <span className="jds-badge jds-badge--neutral">
                    {approvalLabel(entry.approvalMode)}
                  </span>
                  <span
                    className={`jds-badge${isDistinct(entry.outcome) ? " jds-badge--red" : " jds-badge--neutral"}`}
                  >
                    {outcomeLabel(entry.outcome)}
                  </span>
                  {entry.sourceSurface !== "chat" && (
                    <span className="jds-badge jds-badge--steel">{entry.sourceSurface}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
                <span className="aud__when" title={formatDateTime(entry.occurredAt, locale)}>
                  {relativeTime(entry.occurredAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
