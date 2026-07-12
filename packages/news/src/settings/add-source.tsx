import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Note } from "@jarv1s/settings-ui";
import { ApiError } from "@jarv1s/module-web-sdk";
import type { NewsSourcePreviewCandidate, NewsSourcePreviewResponse } from "@jarv1s/shared";

import { confirmNewsSource, previewNewsSource } from "../web/news-client.js";
import { newsQueryKeys } from "../web/query-keys.js";

/* #975 Task 9: the add-source flow (input → preview → candidate pick → confirm) lives in its
   own file so settings/index.tsx stays well under the 1000-line gate. It wires the Slice-2
   REST endpoints only — no chat/tool coupling. */

/**
 * Preview failures arrive as a 200 with a machine `reason` key (never the raw input — same
 * privacy rule as exclusion 400s), so this map is the single place they become sentences.
 * Unknown keys fall back to generic copy rather than leaking the key to the user.
 */
const PREVIEW_REJECTION_COPY: Record<string, string> = {
  policy: "That publication isn't allowed by the content policy.",
  invalid_input: "That doesn't look like a publication we can check — try a homepage link.",
  unreachable: "We couldn't reach that site. Check the address and try again.",
  not_https: "Only HTTPS links or bare domains are accepted."
};

/** Human copy for a failed preview, or null when the preview produced candidates. */
export function previewOutcomeMessage(result: NewsSourcePreviewResponse): string | null {
  switch (result.status) {
    case "unavailable":
      return "Adding sources is unavailable right now — check your AI model in Assistant settings.";
    case "rejected":
    case "invalid":
      return (
        (result.reason ? PREVIEW_REJECTION_COPY[result.reason] : undefined) ??
        "That publication can't be added."
      );
    default:
      return null;
  }
}

/**
 * The REST preview returns `candidates` and `candidateIds` as parallel arrays (the DTO keeps
 * display data separate from the opaque confirm handles). Zip them so the UI can't mismatch
 * a label with another candidate's id.
 */
export function zipPreviewCandidates(
  result: NewsSourcePreviewResponse
): readonly { candidate: NewsSourcePreviewCandidate; candidateId: string }[] {
  const candidates = result.candidates ?? [];
  const ids = result.candidateIds ?? [];
  return candidates
    .map((candidate, index) => ({ candidate, candidateId: ids[index] }))
    .filter((entry): entry is { candidate: NewsSourcePreviewCandidate; candidateId: string } =>
      Boolean(entry.candidateId)
    );
}

export function AddSourceFlow() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<NewsSourcePreviewResponse | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const previewMutation = useMutation({
    mutationFn: previewNewsSource,
    onSuccess: (result) => {
      setPreview(result);
      // Preselect the first candidate so a single-candidate preview is one click to confirm.
      setSelectedCandidateId(result.candidateIds?.[0] ?? null);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: confirmNewsSource,
    onSuccess: () => {
      setInput("");
      setPreview(null);
      setSelectedCandidateId(null);
      setAdded(true);
      // New source reshapes both the personalization pane and the composed front page.
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.personalization });
      void queryClient.invalidateQueries({ queryKey: newsQueryKeys.overview });
    }
  });

  function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setAdded(false);
    setPreview(null);
    previewMutation.mutate({ input: trimmed });
  }

  function confirmSelected() {
    if (!preview?.confirmationId || !selectedCandidateId) return;
    confirmMutation.mutate({
      confirmationId: preview.confirmationId,
      candidateId: selectedCandidateId
    });
  }

  function reset() {
    setPreview(null);
    setSelectedCandidateId(null);
    confirmMutation.reset();
  }

  const busy = previewMutation.isPending || confirmMutation.isPending;
  const previewFailure = preview ? previewOutcomeMessage(preview) : null;
  const candidates = preview ? zipPreviewCandidates(preview) : [];
  // Confirm failures carry friendly server copy (limit/duplicate/expired) in the error body;
  // surface it verbatim rather than re-guessing the cause from the status code.
  const confirmFailure = confirmMutation.isError
    ? confirmMutation.error instanceof ApiError
      ? confirmMutation.error.message
      : "Could not add that source. Try again."
    : null;
  const errorMessage =
    previewFailure ??
    confirmFailure ??
    (previewMutation.isError ? "Could not check that publication. Try again." : null);

  return (
    <div className="nw-set__addflow">
      <form className="nw-set__exform" onSubmit={submitPreview}>
        <label className="nw-set__exlabel" htmlFor="nw-addsource-input">
          Publication homepage or domain
        </label>
        <div className="nw-set__exrow">
          <input
            id="nw-addsource-input"
            className="jds-input"
            type="text"
            value={input}
            placeholder="theatlantic.com"
            disabled={busy}
            onChange={(event) => {
              setInput(event.target.value);
              setAdded(false);
            }}
          />
          <button type="submit" className="jds-btn jds-btn--sm" disabled={busy || !input.trim()}>
            {previewMutation.isPending ? "Checking…" : "Check"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <p className="nw-set__exerr" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <div className="nw-set__candidates">
          {preview?.duplicateOfSourceId ? (
            <Note>That publication is already in your personalized sources.</Note>
          ) : null}
          {candidates.length > 1 ? (
            <p className="nw-set__hint">We found more than one match — pick the right one.</p>
          ) : null}
          <ul className="nw-set__list" role={candidates.length > 1 ? "radiogroup" : undefined}>
            {candidates.map(({ candidate, candidateId }) => (
              <li key={candidateId} className="nw-set__item">
                {candidates.length > 1 ? (
                  <input
                    type="radio"
                    name="nw-addsource-candidate"
                    id={`nw-cand-${candidateId}`}
                    checked={selectedCandidateId === candidateId}
                    disabled={busy}
                    onChange={() => setSelectedCandidateId(candidateId)}
                  />
                ) : null}
                {/* Candidate labels/domains are model/web-derived — always plain text. */}
                <label className="nw-set__item-label" htmlFor={`nw-cand-${candidateId}`}>
                  {candidate.label}
                </label>
                <span className="nw-set__item-meta">{candidate.canonicalDomain}</span>
              </li>
            ))}
          </ul>
          <div className="nw-set__addrow">
            <button
              type="button"
              className="jds-btn jds-btn--sm"
              disabled={busy || !selectedCandidateId}
              onClick={confirmSelected}
            >
              {confirmMutation.isPending ? "Adding…" : "Add this source"}
            </button>
            <button
              type="button"
              className="jds-btn jds-btn--sm jds-btn--secondary"
              disabled={busy}
              onClick={reset}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {added ? <Note>Source added — it now contributes to your News page.</Note> : null}
    </div>
  );
}
