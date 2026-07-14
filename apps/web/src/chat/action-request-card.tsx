import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveActionRequest } from "../api/client";
import type { ActionRequestPreview } from "./use-chat-stream";

interface ActionRequestCardProps {
  readonly actionRequestId: string;
  readonly toolName: string;
  readonly summary: string;
  /** Rich server-derived preview (email reply recipient/subject/body); live-stream only. */
  readonly preview?: ActionRequestPreview;
  readonly focusRequested?: boolean;
  readonly onFocusComplete?: () => void;
}

function humanizeToolName(toolName: string): string {
  const last = toolName.includes(".") ? toolName.split(".").pop()! : toolName;
  return last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function ActionRequestCard(props: ActionRequestCardProps) {
  const [status, setStatus] = useState<"pending" | "loading" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "done" || status === "error") {
      rootRef.current?.focus();
    }
  }, [status]);

  useEffect(() => {
    if (!props.focusRequested) return;
    rootRef.current?.scrollIntoView({ block: "center" });
    rootRef.current?.focus();
    props.onFocusComplete?.();
  }, [props.focusRequested, props.onFocusComplete]);

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
    <div
      className="action-request-card"
      role="region"
      aria-label="Action request"
      data-action-request-id={props.actionRequestId}
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="action-request-preview__label">{humanizeToolName(props.toolName)}</div>
      <p className="action-request-summary">{props.summary}</p>

      {props.preview ? (
        <div className="action-request-preview">
          <dl className="action-request-preview__meta">
            <div className="action-request-preview__row">
              <dt className="action-request-preview__label">To</dt>
              <dd className="action-request-preview__value">{props.preview.to}</dd>
            </div>
            <div className="action-request-preview__row">
              <dt className="action-request-preview__label">Subject</dt>
              <dd className="action-request-preview__value">{props.preview.subject}</dd>
            </div>
          </dl>
          <p className="action-request-preview__body">{props.preview.body}</p>
        </div>
      ) : null}

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
            Reject
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
