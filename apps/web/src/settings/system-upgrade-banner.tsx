import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHostDiagnostics } from "../api/client-admin";
import { queryKeys } from "../api/query-keys";

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function SystemUpgradeBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: diag } = useQuery({
    queryKey: queryKeys.settings.hostDiagnostics,
    queryFn: getHostDiagnostics,
    retry: false
  });

  if (dismissed || !diag || !diag.latestAvailableVersion || !diag.version) {
    return null;
  }

  const isUpgradeAvailable = compareVersions(diag.latestAvailableVersion, diag.version) > 0;
  if (!isUpgradeAvailable) {
    return null;
  }

  return (
    <>
      <div
        className="bfresh__stale"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem"
        }}
      >
        <span>A new version of Jarvis ({diag.latestAvailableVersion}) is available.</span>
        <div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="jds-btn jds-btn--sm"
            style={{ marginRight: "0.5rem" }}
          >
            View changes
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="jds-btn jds-btn--secondary jds-btn--sm"
          >
            Dismiss
          </button>
        </div>
      </div>

      {modalOpen && (
        <div className="wl-modal">
          <div className="wl-modal__backdrop" onClick={() => setModalOpen(false)} />
          <div className="wl-modal__body" style={{ maxWidth: 600, width: "100%" }}>
            <div className="wl-modal__head">
              <h2 className="wl-modal__title">Release Notes: {diag.latestAvailableVersion}</h2>
              <button type="button" className="wl-modal__close" onClick={() => setModalOpen(false)}>
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
              </button>
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                margin: "1rem 0",
                maxHeight: "60vh",
                overflowY: "auto",
                padding: "0 1rem"
              }}
            >
              {diag.releaseNotes || "No release notes provided."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
