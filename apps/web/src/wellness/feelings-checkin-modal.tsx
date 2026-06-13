import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { BODY_SENSATIONS } from "@jarv1s/shared";
import type { CreateCheckinRequest } from "@jarv1s/shared";

import { createWellnessCheckin, sendChatTurn } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useChatStream } from "../chat/use-chat-stream";
import { useChatControls } from "../shell/chat-controls-context";
import { FeelingsPicker, type FeelingsSelection } from "./feelings-picker";

interface FeelingsCheckinModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function FeelingsCheckinModal(props: FeelingsCheckinModalProps) {
  const queryClient = useQueryClient();
  const { openChatWith } = useChatControls();
  const [selection, setSelection] = useState<FeelingsSelection | null>(null);
  const [sensations, setSensations] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [assisting, setAssisting] = useState(false);

  const createMutation = useMutation({
    mutationFn: (input: CreateCheckinRequest) => createWellnessCheckin(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wellness.checkins });
    }
  });

  if (!props.open) return null;

  function buildRequest(): CreateCheckinRequest | null {
    if (!selection) return null;
    return {
      feelingCore: selection.core,
      feelingSecondary: selection.secondary,
      feelingTertiary: selection.tertiary,
      sensations,
      intensity,
      energy,
      note: note.trim() ? note.trim() : null,
      identifiedVia: assisting ? "assisted" : "wheel"
    };
  }

  async function handleSave(discuss: boolean) {
    const request = buildRequest();
    if (!request) return;
    await createMutation.mutateAsync(request);
    if (discuss) {
      const summary = `I just logged feeling ${request.feelingTertiary ?? request.feelingSecondary ?? request.feelingCore}${
        request.intensity ? ` (intensity ${request.intensity.toString()})` : ""
      }${sensations.length ? `, with ${sensations.join(", ").toLowerCase()}` : ""}. Help me think through it.`;
      openChatWith(summary);
    }
    props.onClose();
  }

  function toggleSensation(name: string) {
    setSensations((current) =>
      current.includes(name) ? current.filter((s) => s !== name) : [...current, name]
    );
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Log how you feel">
      <div className="modal-panel wellness-checkin-modal">
        <header className="modal-header">
          <h2>How are you feeling?</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </header>

        <FeelingsPicker value={selection} onChange={setSelection} />

        <button
          type="button"
          className="ghost-button assisted-toggle"
          onClick={() => setAssisting((v) => !v)}
        >
          {assisting ? "Pick on the wheel instead" : "I don't know what I feel — talk it through"}
        </button>

        {assisting ? <AssistedChat /> : null}

        <fieldset className="sensations-field">
          <legend>Body check (optional)</legend>
          <div className="chips">
            {BODY_SENSATIONS.map((name) => (
              <button
                key={name}
                type="button"
                className={`feelings-chip ${sensations.includes(name) ? "active" : ""}`}
                onClick={() => toggleSensation(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field-label">
          Intensity (how strong, 1–5)
          <select
            value={intensity ?? ""}
            onChange={(e) => setIntensity(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Energy (depleted 1 → energized 5)
          <select
            value={energy ?? ""}
            onChange={(e) => setEnergy(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>

        <footer className="modal-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={!selection || createMutation.isPending}
            onClick={() => void handleSave(false)}
          >
            Save
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selection || createMutation.isPending}
            onClick={() => void handleSave(true)}
          >
            Save &amp; discuss
          </button>
        </footer>
        {createMutation.error ? (
          <p className="form-error">{readError(createMutation.error)}</p>
        ) : null}
      </div>
    </div>
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not save check-in";
}

/**
 * The assisted "talk it through" chat. Extracted into its own component so `useChatStream()`
 * (which opens an EventSource against /api/chat/stream) runs ONLY while this is mounted —
 * i.e. only when the user is actively in assisted mode. Mirrors OnboardingChatPanel; prevents
 * the modal from opening a redundant always-on SSE connection on every /wellness visit.
 */
function AssistedChat() {
  const { records } = useChatStream();
  const [assistInput, setAssistInput] = useState("");
  return (
    <div className="assisted-chat">
      <div className="assisted-transcript">
        {records.slice(-6).map((r, i) => (
          <p key={i} className={`assisted-line ${r.kind}`}>
            {r.text}
          </p>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (assistInput.trim()) {
            void sendChatTurn(assistInput.trim());
            setAssistInput("");
          }
        }}
      >
        <input
          value={assistInput}
          onChange={(e) => setAssistInput(e.target.value)}
          placeholder="Tell Jarvis what's going on..."
          aria-label="Message Jarvis"
        />
      </form>
    </div>
  );
}
