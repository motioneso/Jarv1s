import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { WELLNESS_EXPORT_CATEGORIES, type WellnessExportCategory } from "@jarv1s/shared";
import { getDataExportDownloadUrl, getDataExportStatus, type ExportJobStatus } from "../api/client";
import { requestWellnessExport } from "../api/wellness-export";

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

function DownloadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

const CATEGORY_LABELS: { readonly [K in WellnessExportCategory]: string } = {
  checkins: "Mood check-ins",
  medications: "Medications & logs",
  therapyNotes: "Therapy notes",
  insights: "Insights"
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIso(): string {
  return isoDaysAgo(0);
}

const SENSITIVE_COPY =
  "This export will contain sensitive health and wellness data. Anyone you share it with will see it. Generate only if you trust the recipient (e.g. your doctor or therapist).";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WellnessExportModal({ open, onClose }: Props) {
  const [from, setFrom] = useState<string>(isoDaysAgo(90));
  const [to, setTo] = useState<string>(todayIso());
  const [categories, setCategories] = useState<readonly WellnessExportCategory[]>([
    ...WELLNESS_EXPORT_CATEGORIES
  ]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const rangeValid = from <= to && from !== "" && to !== "";
  const categoriesValid = categories.length > 0;
  const canGenerate = rangeValid && categoriesValid && acknowledged && jobId === null;

  const statusQuery = useQuery<ExportJobStatus>({
    queryKey: ["wellness-export", "status", jobId],
    queryFn: () => getDataExportStatus(jobId!),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "building" ? 2000 : false;
    }
  });

  const startMutation = useMutation({
    mutationFn: () =>
      requestWellnessExport({
        from,
        to,
        categories: [...categories] as readonly WellnessExportCategory[]
      }),
    onSuccess: (data) => setJobId(data.jobId)
  });

  if (!open) return null;

  const status = statusQuery.data?.status;
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const inProgress = status === "pending" || status === "building";

  function toggleCategory(cat: WellnessExportCategory) {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  function reset() {
    setJobId(null);
    setAcknowledged(false);
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <div
      className="wl-modal-scrim"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <div
        className="wl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wlexport-modal-title"
        style={{ maxWidth: 480 }}
      >
        <div className="wl-modal__head">
          <div className="hm">
            <div className="wl-modal__eyebrow">Share</div>
            <div className="wl-modal__title" id="wlexport-modal-title">
              Export for a clinician
            </div>
          </div>
          <button type="button" className="wl-modal__x" aria-label="Close" onClick={close}>
            <XIcon />
          </button>
        </div>

        <div className="wl-modal__body">
          {!jobId || isFailed ? (
            <>
              <p className="wl-modal__desc" style={{ marginBottom: 14 }}>
                Generate a printable document of your wellness data for a date range and the
                categories you choose. Open it in a browser and print to PDF to share.
              </p>

              <div className="wl-field" style={{ marginBottom: 12 }}>
                <label htmlFor="wlexport-from" className="wl-field__label">
                  From
                </label>
                <input
                  id="wlexport-from"
                  type="date"
                  className="wl-input"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="wl-field" style={{ marginBottom: 12 }}>
                <label htmlFor="wlexport-to" className="wl-field__label">
                  To
                </label>
                <input
                  id="wlexport-to"
                  type="date"
                  className="wl-input"
                  value={to}
                  max={todayIso()}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>

              <fieldset className="wl-fieldset" style={{ marginBottom: 12 }}>
                <legend className="wl-field__label">Include</legend>
                {WELLNESS_EXPORT_CATEGORIES.map((cat) => (
                  <label key={cat} className="wl-check">
                    <input
                      type="checkbox"
                      checked={categories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                    />
                    {CATEGORY_LABELS[cat]}
                  </label>
                ))}
              </fieldset>

              <label className="wl-check wl-check--sensitive" style={{ marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>{SENSITIVE_COPY}</span>
              </label>

              {isFailed ? (
                <div className="wl-modal__note wl-modal__note--error" style={{ marginBottom: 10 }}>
                  Export failed. Please try again.
                </div>
              ) : null}

              <button
                type="button"
                className="jds-btn jds-btn--primary"
                disabled={!canGenerate || startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                <span className="jds-btn__icon">
                  <DownloadIcon />
                </span>
                {startMutation.isPending ? "Starting…" : "Generate export"}
              </button>
            </>
          ) : inProgress ? (
            <div className="wl-modal__progress">
              <p>Building your export… this usually takes a few seconds.</p>
            </div>
          ) : isReady && jobId ? (
            <div className="wl-modal__ready">
              <p className="wl-modal__note">
                Your export is ready. Open it in a browser and print to PDF to share.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <a
                  href={getDataExportDownloadUrl(jobId)}
                  className="jds-btn jds-btn--primary jds-btn--sm"
                  download
                >
                  <span className="jds-btn__icon">
                    <DownloadIcon />
                  </span>
                  Download
                </a>
                <button
                  type="button"
                  className="jds-btn jds-btn--quiet jds-btn--sm"
                  onClick={reset}
                >
                  Start a new export
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
