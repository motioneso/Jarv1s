import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, MessageSquareText, Sparkles, SquarePen, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import {
  clearChat,
  listCalendarEvents,
  listChatThreadMessages,
  listChatThreads,
  listTasks,
  sendChatTurn
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type { ChatMessageDto } from "@jarv1s/shared";
import { ActionRequestCard } from "./action-request-card";
import { buildChatSeeds } from "./seeds";
import type { ChatRecordKind, TranscriptRecord } from "./use-chat-stream";
import "../styles/kit-chat.css";

/**
 * Live chat drawer, styled to the Jarvis Design System (`chatd-*`). A global slide-out
 * panel mounted in the app shell. Sends user turns to POST /api/chat/turn; the SSE stream
 * (use-chat-stream, lifted to the shell) is the single source of truth for rendered
 * records, so Send only POSTs the turn — it does NOT append the POST response.
 *
 * Non-modal by design: no full-screen scrim, so the rest of the app (including nav) stays
 * interactive and the chat keeps following the user across pages.
 */
export function ChatDrawer(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly records: readonly TranscriptRecord[];
  readonly clearRecords: () => void;
}) {
  const [reviewThreadId, setReviewThreadId] = useState<string | null>(null);
  const threadsQuery = useQuery({
    queryKey: queryKeys.chat.threads,
    queryFn: () => listChatThreads(),
    enabled: props.open
  });
  const messagesQuery = useQuery({
    queryKey: queryKeys.chat.messages(reviewThreadId ?? ""),
    queryFn: () => listChatThreadMessages(reviewThreadId ?? ""),
    enabled: props.open && reviewThreadId !== null
  });

  if (!props.open) {
    return null;
  }

  const startNewChat = () => {
    setReviewThreadId(null);
    void clearChat();
    props.clearRecords();
  };
  const reviewing = reviewThreadId !== null;
  const displayRecords = reviewing
    ? recordsFromMessages(messagesQuery.data?.messages ?? [])
    : props.records;
  const selectedThread = (threadsQuery.data?.threads ?? []).find(
    (item) => item.id === reviewThreadId
  );

  return (
    <aside className="chatd" role="dialog" aria-label="Chat with Jarvis">
      <div className="chatd__head">
        <span className="chatd__mark">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="chatd__id">
          <div className="chatd__name">Jarvis</div>
          <div className="chatd__status">Here when you need me</div>
        </div>
        <button
          aria-label="New chat"
          className="chatd__hbtn"
          title="New chat"
          type="button"
          onClick={startNewChat}
        >
          <SquarePen size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="Close chat"
          className="chatd__hbtn"
          title="Close"
          type="button"
          onClick={props.onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="chatd__body">
        <HistoryList
          selectedThreadId={reviewThreadId}
          threads={threadsQuery.data?.threads ?? []}
          onSelect={setReviewThreadId}
        />
        {reviewing ? (
          <div className="chatd-review">Reviewing {selectedThread?.title ?? "past chat"}</div>
        ) : null}
        {displayRecords.length > 0 ? (
          <Thread records={displayRecords} />
        ) : reviewing ? (
          <ReviewEmptyState />
        ) : (
          <EmptyState />
        )}
      </div>

      <Composer readOnly={reviewing} />
    </aside>
  );
}

function HistoryList(props: {
  readonly threads: readonly {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: string;
  }[];
  readonly selectedThreadId: string | null;
  readonly onSelect: (threadId: string) => void;
}) {
  if (props.threads.length === 0) return null;
  return (
    <div className="chatd-sess">
      <div className="chatd-sess__hd">History</div>
      {props.threads.map((thread) => (
        <button
          className={`chatd-sess__row${props.selectedThreadId === thread.id ? " is-selected" : ""}`}
          key={thread.id}
          type="button"
          onClick={() => props.onSelect(thread.id)}
        >
          <span className="chatd-sess__ic">
            <MessageSquareText size={14} aria-hidden="true" />
          </span>
          <span className="chatd-sess__main">
            <span className="chatd-sess__title">{thread.title}</span>
          </span>
          <span className="chatd-sess__when">{formatShortDate(thread.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

/** The live conversation. Consecutive behind-the-scenes records (thinking/tool/status and
 *  resolved action results) collapse into one peek; replies and pending action requests
 *  stay front-and-centre. */
function Thread(props: { readonly records: readonly TranscriptRecord[] }) {
  return (
    <div className="chatd-thread" aria-live="polite">
      {groupRecords(props.records).map((item, index) =>
        item.type === "activity" ? (
          <ActivityPeek key={index} records={item.records} />
        ) : (
          <RecordRow key={index} record={item.record} />
        )
      )}
    </div>
  );
}

const ACTIVITY_KINDS: ReadonlySet<ChatRecordKind> = new Set<ChatRecordKind>([
  "thinking",
  "tool",
  "status",
  "action_result"
]);

type RenderItem =
  | { readonly type: "record"; readonly record: TranscriptRecord }
  | { readonly type: "activity"; readonly records: readonly TranscriptRecord[] };

/** Coalesce runs of behind-the-scenes records into a single collapsible group. A pending
 *  action_request (interactive) flushes the run so it always renders visibly. */
function groupRecords(records: readonly TranscriptRecord[]): RenderItem[] {
  const items: RenderItem[] = [];
  let buffer: TranscriptRecord[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      items.push({ type: "activity", records: buffer });
      buffer = [];
    }
  };

  for (const record of records) {
    if (ACTIVITY_KINDS.has(record.kind) && record.kind !== "action_request") {
      buffer.push(record);
    } else {
      flush();
      items.push({ type: "record", record });
    }
  }
  flush();
  return items;
}

function ActivityPeek(props: { readonly records: readonly TranscriptRecord[] }) {
  const count = props.records.length;
  return (
    <details className="chatd-peek">
      <summary className="chatd-peek__summary">
        <Sparkles size={13} aria-hidden="true" />
        <span className="chatd-peek__label">Behind the scenes</span>
        <span className="chatd-peek__count">
          {count} {count === 1 ? "step" : "steps"}
        </span>
        <ChevronDown className="chatd-peek__chev" size={14} aria-hidden="true" />
      </summary>
      <div className="chatd-peek__body">
        {props.records.map((record, index) => (
          <div className="chatd-peek__line" key={index}>
            <span className="chatd-peek__kind">{activityVerb(record)}</span>
            {record.text}
          </div>
        ))}
      </div>
    </details>
  );
}

function activityVerb(record: TranscriptRecord): string {
  if (record.kind === "action_result") {
    return record.outcome === "executed" ? "Executed" : "Denied";
  }
  return `${record.kind} ·`;
}

function RecordRow(props: { readonly record: TranscriptRecord }) {
  const { kind, text } = props.record;

  if (kind === "action_request" && props.record.actionRequestId) {
    return (
      <ActionRequestCard
        actionRequestId={props.record.actionRequestId}
        summary={props.record.summary ?? text}
        toolName={props.record.toolName ?? kind}
      />
    );
  }

  if (kind === "user") {
    return (
      <div className="chatd-msg chatd-msg--me">
        <div className="chatd-bubble">{text}</div>
      </div>
    );
  }

  if (kind === "error") {
    return <p className="form-error">{text}</p>;
  }

  // reply (and any unforeseen non-activity kind) — assistant bubble.
  return (
    <div className="chatd-msg">
      <span className="chatd-msg__av">
        <Sparkles size={14} aria-hidden="true" />
      </span>
      <div className="chatd-bubble">{text}</div>
    </div>
  );
}

function recordsFromMessages(messages: readonly ChatMessageDto[]): TranscriptRecord[] {
  return messages.flatMap((message) => [
    ...message.activity.map((event) => ({
      kind: safeActivityKind(event.kind),
      text: event.text
    })),
    ...message.tools.map((tool) => ({
      kind: "tool" as const,
      text: tool.name
    })),
    {
      kind:
        message.role === "user"
          ? ("user" as const)
          : message.status === "error"
            ? ("error" as const)
            : ("reply" as const),
      text: message.body
    }
  ]);
}

function safeActivityKind(kind: string): ChatRecordKind {
  if (kind === "thinking" || kind === "tool" || kind === "status" || kind === "action_result") {
    return kind;
  }
  return "status";
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EmptyState() {
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const eventsQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });

  const seeds = buildChatSeeds(tasksQuery.data?.tasks ?? [], eventsQuery.data?.events ?? []);

  return (
    <div className="chatd-empty">
      <span className="chatd-empty__mark">
        <Sparkles size={22} aria-hidden="true" />
      </span>
      <div className="chatd-empty__title">What can I help with?</div>
      <div className="chatd-empty__sub">
        Ask about your day, your tasks, or anything you&apos;ve told me.
      </div>
      <div className="chatd-sugg">
        {seeds.map((seed) => (
          <button
            className="chatd-sugg__btn"
            key={seed}
            type="button"
            onClick={() => void sendChatTurn(seed)}
          >
            {seed}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewEmptyState() {
  return (
    <div className="chatd-empty chatd-empty--review">
      <div className="chatd-empty__title">No stored messages</div>
    </div>
  );
}

function Composer(props: { readonly readOnly: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (props.readOnly) return;
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setText("");
    setError(null);
    try {
      // Fire-and-render: the user echo and the assistant reply both arrive over the SSE
      // stream (the single source of truth), so we do not append the POST response here.
      await sendChatTurn(trimmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send message");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="chatd__composer">
      {error ? <p className="form-error">{error}</p> : null}
      <div className={`chatd-input${props.readOnly ? " is-readonly" : ""}`}>
        <textarea
          aria-label="Message Jarvis"
          disabled={props.readOnly}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.readOnly ? "Read-only history" : "Message Jarvis…"}
          rows={1}
          value={text}
        />
        <button
          aria-label="Send"
          className="chatd-send"
          disabled={props.readOnly || !text.trim()}
          type="button"
          onClick={() => void send()}
        >
          <ArrowUp size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
