import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Mic, Square, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import { ApiError, lookupAiCapabilityRoute, transcribeAudio } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ConnectProviderEmpty } from "./connect-provider-empty";

/**
 * Chat composer, extracted from chat-drawer.tsx (#738) so the mic/voice-input control has
 * headroom to grow without pushing the drawer file over the file-size gate.
 *
 * Voice input (#738): tap-to-record via MediaRecorder, then POST the clip to
 * /api/ai/transcriptions (transient — raw audio never leaves this component and is never
 * persisted). The transcript is inserted into the text field for the user to review/edit; it
 * is NEVER auto-sent — send stays a manual, explicit action, identical to typed text. The mic
 * button is always rendered; it's disabled with an explanatory tooltip until the
 * "transcription" AI capability route reports available (the same capability-route
 * mechanism every other AI feature uses to know a provider is configured+healthy).
 */
export function Composer(props: {
  readonly readOnly: boolean;
  readonly isFounder: boolean;
  readonly initialText?: string;
  readonly isSending: boolean;
  readonly sendError: string | null;
  readonly needsProvider: boolean;
  readonly lockedModelUnavailable: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: (queuedText: string | null) => void;
}) {
  // Lazy initializer: the starter seeds the input on mount only. After that, the user owns the
  // value — typing/sending clears it and we never re-seed from the prop (no useEffect that would
  // clobber edits or re-fire the chip on re-render).
  const [text, setText] = useState(() => props.initialText ?? "");
  const [queuedText, setQueuedText] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Denied/unavailable mic is browser/device state, not server state — kept purely local and
  // never persisted or reported anywhere.
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const transcriptionRouteQuery = useQuery({
    queryKey: queryKeys.ai.capability("transcription"),
    queryFn: () => lookupAiCapabilityRoute("transcription")
  });
  const micAvailable = Boolean(transcriptionRouteQuery.data?.route?.available);

  const send = () => {
    if (props.readOnly) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (props.isSending) {
      setQueuedText(trimmed);
      setText("");
      return;
    }
    props.onSend(trimmed);
    setText("");
  };

  const restoreQueuedText = () => {
    if (queuedText === null) return;
    setText(queuedText);
    setQueuedText(null);
  };

  const discardQueuedText = () => setQueuedText(null);

  const stop = () => {
    props.onStop(queuedText);
    setQueuedText(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const insertTranscript = (transcript: string) => {
    // Lands in the composer for review/edit — the normal typed-message send path (Enter /
    // the send button) is the only way it goes out. No auto-send here.
    setText((current) => mergeTranscriptIntoText(current, transcript));
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        void transcribeAndInsert(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      // Denied permission or no device — surfaced inline, never sent to the server.
      setMicError("Microphone access was denied or unavailable.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const transcribeAndInsert = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const { text: transcript } = await transcribeAudio(blob);
      insertTranscript(transcript);
    } catch (error) {
      setMicError(
        error instanceof ApiError ? error.message : "Transcription failed. Please try again."
      );
    } finally {
      setTranscribing(false);
    }
  };

  const micDisabled =
    props.readOnly || props.lockedModelUnavailable || !micAvailable || transcribing;
  const micTitle = !micAvailable
    ? "Set up a transcription model in Settings → Assistant & AI to enable voice input"
    : recording
      ? "Stop recording"
      : transcribing
        ? "Transcribing…"
        : "Record a voice message";

  return (
    <div className="chatd__composer">
      {props.needsProvider ? <ConnectProviderEmpty isFounder={props.isFounder} /> : null}
      {props.lockedModelUnavailable ? (
        <p className="chatd-lock-warn">
          The locked chat model is unavailable. Contact your admin or go to <b>Settings → AI</b> to
          re-enable it or clear the lock.
        </p>
      ) : null}
      {props.sendError ? <p className="form-error">{props.sendError}</p> : null}
      {micError ? <p className="form-error">{micError}</p> : null}
      <div className={`chatd-input${props.readOnly ? " is-readonly" : ""}`}>
        <textarea
          aria-label="Message Jarvis"
          disabled={props.readOnly || props.lockedModelUnavailable}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            props.lockedModelUnavailable
              ? "Chat locked — model unavailable"
              : props.readOnly
                ? "Read-only history"
                : "Message Jarvis…"
          }
          rows={1}
          value={text}
        />
        <button
          aria-label={recording ? "Stop recording" : "Record voice message"}
          className={`chatd-mic${recording ? " is-recording" : ""}`}
          disabled={micDisabled}
          title={micTitle}
          type="button"
          onClick={recording ? stopRecording : () => void startRecording()}
        >
          {recording ? (
            <Square size={15} aria-hidden="true" fill="currentColor" />
          ) : (
            <Mic size={17} aria-hidden="true" />
          )}
        </button>
        <button
          aria-label={props.isSending ? "Stop generating" : "Send"}
          className="chatd-send"
          disabled={
            props.readOnly || props.lockedModelUnavailable || (!props.isSending && !text.trim())
          }
          title={props.isSending ? "Stop" : "Send"}
          type="button"
          onClick={props.isSending ? stop : send}
        >
          {props.isSending ? (
            <Square size={15} aria-hidden="true" fill="currentColor" />
          ) : (
            <ArrowUp size={17} aria-hidden="true" />
          )}
        </button>
      </div>
      {queuedText !== null ? (
        <div className="chatd-next" aria-live="polite">
          <button
            aria-label="Edit queued message"
            className="chatd-next__text"
            type="button"
            onClick={restoreQueuedText}
          >
            Next: &quot;{queuedText}&quot;
          </button>
          <button
            aria-label="Discard queued message"
            className="chatd-next__x"
            title="Discard queued message"
            type="button"
            onClick={discardQueuedText}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pure merge used by voice-input transcript insertion (#738). Exported so the "insert, don't
 * auto-send" behavior — a hard requirement of the spec — is directly unit-testable without
 * needing a full interactive render of the composer.
 */
export function mergeTranscriptIntoText(current: string, transcript: string): string {
  const trimmedTranscript = transcript.trim();
  if (!trimmedTranscript) return current;
  const trimmedCurrent = current.trim();
  return trimmedCurrent ? `${trimmedCurrent} ${trimmedTranscript}` : trimmedTranscript;
}
