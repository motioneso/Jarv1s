import { useQuery } from "@tanstack/react-query";
import { Bot, LoaderCircle, Plus, Send, UserCircle, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { clearChat, listChatThreads, sendChatTurn } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { type TranscriptRecord, useChatStream } from "./use-chat-stream";

/**
 * Live chat drawer: a simple slide-in panel over the Chat route. Sends user turns to
 * POST /api/chat/turn and renders the live transcript that arrives over the SSE stream
 * (use-chat-stream). The user's message is rendered optimistically on send, and the
 * reply from the POST response is also appended directly so the conversation is visible
 * even when the SSE stream is unavailable (e.g. mocked E2E environments).
 */
export function ChatDrawer(props: { readonly open: boolean; readonly onClose: () => void }) {
  const { records, clearRecords, appendRecord } = useChatStream();

  if (!props.open) {
    return null;
  }

  return (
    <>
      <button
        aria-label="Close live chat"
        className="chat-drawer-scrim"
        type="button"
        onClick={props.onClose}
      />
      <aside className="chat-drawer" aria-label="Live chat">
        <div className="chat-drawer-header">
          <div className="panel-heading">
            <Bot size={20} aria-hidden="true" />
            <h2>Live chat</h2>
          </div>
          <span className="provider-indicator" aria-label="Active provider">
            CLI
          </span>
          <button
            aria-label="Close live chat"
            className="icon-button"
            type="button"
            onClick={props.onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <NewChatButton onCleared={clearRecords} />
        <RecordLog records={records} />
        <ThreadHistory />
        <DrawerComposer
          onReply={(text) => appendRecord({ kind: "reply", text })}
          onUserText={(text) => appendRecord({ kind: "user", text })}
        />
      </aside>
    </>
  );
}

function NewChatButton(props: { readonly onCleared: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);
    try {
      await clearChat();
      props.onCleared();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start a new chat");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="chat-drawer-actions">
      <button
        className="ghost-button"
        disabled={pending}
        type="button"
        onClick={() => void handleClick()}
      >
        {pending ? (
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
        New chat
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

function RecordLog(props: { readonly records: readonly TranscriptRecord[] }) {
  if (props.records.length === 0) {
    return <div className="empty-state">Send a message to start chatting</div>;
  }

  return (
    <div className="chat-messages" aria-live="polite">
      {props.records.map((record, index) => (
        <RecordRow key={index} record={record} />
      ))}
    </div>
  );
}

function RecordRow(props: { readonly record: TranscriptRecord }) {
  const { kind, text } = props.record;

  if (kind === "user") {
    return (
      <article className="chat-message user">
        <div className="chat-message-icon" aria-hidden="true">
          <UserCircle size={18} />
        </div>
        <div>
          <p>{text}</p>
        </div>
      </article>
    );
  }

  if (kind === "reply") {
    return (
      <article className="chat-message assistant">
        <div className="chat-message-icon" aria-hidden="true">
          <Bot size={18} />
        </div>
        <div>
          <p>{text}</p>
        </div>
      </article>
    );
  }

  if (kind === "error") {
    return <p className="form-error">{text}</p>;
  }

  // thinking / tool / status — muted activity lines
  return (
    <p className="muted-text chat-activity-line">
      {kind}: {text}
    </p>
  );
}

function ThreadHistory() {
  const threadsQuery = useQuery({
    queryKey: queryKeys.chat.threads,
    queryFn: () => listChatThreads()
  });
  const threads = threadsQuery.data?.threads ?? [];

  if (threads.length === 0) {
    return null;
  }

  return (
    <details className="chat-history">
      <summary>History ({threads.length})</summary>
      <div className="chat-thread-list">
        {threads.map((thread) => (
          <div className="chat-thread-button" key={thread.id}>
            <span>{thread.title}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function DrawerComposer(props: {
  readonly onUserText: (text: string) => void;
  readonly onReply: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) {
      return;
    }

    setPending(true);
    setError(null);
    props.onUserText(trimmed);
    setText("");

    try {
      const { reply } = await sendChatTurn(trimmed);
      // The reply also arrives over the SSE stream; appending it here keeps the
      // conversation visible when the stream is unavailable (e.g. mocked tests).
      if (reply) {
        props.onReply(reply);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send message");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="chat-composer" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        Message
        <input
          aria-label="Message"
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a message"
          type="text"
          value={text}
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Send size={18} aria-hidden="true" />
        )}
        Send
      </button>
    </form>
  );
}
