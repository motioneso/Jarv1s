import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { useState } from "react";

import { resolveActionRequest } from "../api/client";

interface ActionRequestCardProps {
  readonly actionRequestId: string;
  readonly toolName: string;
  readonly summary: string;
}

export function ActionRequestCard(props: ActionRequestCardProps) {
  const [status, setStatus] = useState<"pending" | "loading" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  const resolve = async (decision: "confirmed" | "rejected") => {
    setStatus("loading");
    setError(null);
    try {
      await resolveActionRequest(props.actionRequestId, decision);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve");
      setStatus("error");
    }
  };

  const isLoading = status === "loading";

  return (
    <div className="action-request-card" role="region" aria-label="Action request">
      <p className="action-request-tool">{props.toolName}</p>
      <p className="action-request-summary">{props.summary}</p>

      {status === "pending" || status === "error" ? (
        <div className="action-request-actions">
          <button
            className="primary-button"
            disabled={isLoading}
            type="button"
            onClick={() => void resolve("confirmed")}
          >
            <CheckCircle size={16} aria-hidden="true" />
            Approve
          </button>
          <button
            className="ghost-button"
            disabled={isLoading}
            type="button"
            onClick={() => void resolve("rejected")}
          >
            <XCircle size={16} aria-hidden="true" />
            Deny
          </button>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : status === "loading" ? (
        <p className="muted-text">
          <LoaderCircle className="spin" size={14} aria-hidden="true" /> Resolving…
        </p>
      ) : (
        <p className="muted-text">Resolved.</p>
      )}
    </div>
  );
}
