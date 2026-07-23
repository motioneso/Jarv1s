import { useEffect, useRef, useState } from "react";
import type { ChatSurface } from "@jarv1s/shared";

import { sendChatTurn } from "../../api/client";
import { BrandMark } from "../../shell/brand-mark";
import { Thread } from "../message-row";
import type { ChatRecordKind } from "../use-chat-stream";
import type { AssistantSurfaceViewProps } from "./contracts";
import { useAssistantSurfaceHost } from "./host-context";
import "./assistant-surface.css";

const DEFAULT_RECORD_KINDS: ReadonlySet<ChatRecordKind> = new Set([
  "user",
  "reply",
  "action_request",
  "action_result",
  "error"
]);

export function AssistantSurface(props: AssistantSurfaceViewProps) {
  const { records, registerComposer } = useAssistantSurfaceHost(props.surface);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const allowed = props.recordKinds ? new Set(props.recordKinds) : DEFAULT_RECORD_KINDS;
  const visibleRecords = records.filter((record) => allowed.has(record.kind));

  useEffect(
    () =>
      registerComposer((nextDraft) => {
        setDraft(nextDraft);
        requestAnimationFrame(() => inputRef.current?.focus());
      }),
    [registerComposer]
  );

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const outcome = props.composer?.onSubmitText?.(text) ?? "send";
    if (outcome === "send") {
      void sendChatTurn(text, undefined, undefined, props.surface as ChatSurface);
    }
    setDraft("");
  };

  return (
    <section className="assistant-surface" aria-label="Jarvis conversation">
      <div className="assistant-surface__thread">
        {props.localRows?.map((row) => (
          <div
            className={`assistant-surface__row assistant-surface__row--${row.role}`}
            key={row.id}
          >
            {row.role === "assistant" ? <JarvisIdentity /> : null}
            <div className={`jds-bubble jds-bubble--${row.role}`}>{row.content}</div>
          </div>
        ))}
        <Thread records={visibleRecords} />
        {props.typing ? <TypingRow /> : null}
        {props.activeControl ? (
          <div className="assistant-surface__row assistant-surface__row--control">
            <JarvisIdentity />
            {props.activeControl}
          </div>
        ) : null}
      </div>
      {props.composer ? (
        <form
          className="assistant-surface__composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={inputRef}
            aria-label="Message Jarvis"
            placeholder={props.composer.placeholder ?? "Message Jarvis…"}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button className="jds-btn jds-btn--primary" type="submit">
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}

function TypingRow() {
  return (
    <div className="assistant-surface__row assistant-surface__row--assistant assistant-surface__typing-row">
      <JarvisIdentity />
      <div className="assistant-surface__typing" aria-label="Jarvis is typing" aria-live="polite">
        <span className="jds-typing-dot" />
        <span className="jds-typing-dot" />
        <span className="jds-typing-dot" />
      </div>
    </div>
  );
}

function JarvisIdentity() {
  return (
    <span className="assistant-surface__identity">
      <BrandMark size={14} />
      <span>Jarvis</span>
    </span>
  );
}
