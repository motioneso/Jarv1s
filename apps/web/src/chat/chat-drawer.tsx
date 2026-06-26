import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronDown,
  Clock,
  MessageSquareText,
  Sparkles,
  Square,
  SquarePen,
  X
} from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import {
  cancelChatTurn,
  clearChat,
  getOnboardingStatus,
  listCalendarEvents,
  listChatThreadMessages,
  listChatThreads,
  listTasks,
  sendChatTurn
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type { ChatMessageDto } from "@jarv1s/shared";
import { ActionRequestCard } from "./action-request-card";
import { ConnectProviderEmpty } from "./connect-provider-empty";
import { MarkdownMessage } from "./markdown-message";
import { buildChatSeeds } from "./seeds";
import { hasConnectedProvider, isNoActiveChatModelError } from "../onboarding/chat-availability";
import type { ChatRecordKind, TranscriptRecord } from "./use-chat-stream";
import "../styles/kit-chat.css";

/**
 * Live chat drawer, styled to the Jarvis Design System (`chatd-*`). A global slide-out
 * panel mounted in the app shell. Sends user turns to POST /api/chat/turn; the SSE stream
 * (use-chat-stream, lifted to the shell) is the single source of truth for rendered
 * records. Send also appends the POST reply as a fallback for browsers/environments where the
 * EventSource stream is unavailable.
 *
 * Non-modal by design: no full-screen scrim, so the rest of the app (including nav) stays
 * interactive and the chat keeps following the user across pages.
 */
export function ChatDrawer(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly records: readonly TranscriptRecord[];
  readonly clearRecords: () => void;
  /** #369: the founder set the instance up — tailors the empty-chat connect copy. */
  readonly isFounder: boolean;
  /**
   * #368: optional pre-filled composer text (the onboarding "Ask Jarvis" setup-check starter).
   * Seeds the input on mount only; it is NEVER auto-sent — the user reviews and presses send.
   */
  readonly initialText?: string;
}) {
  const queryClient = useQueryClient();
  const [reviewThreadId, setReviewThreadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Lifted send state — shared by both the Composer and EmptyState seed buttons (#400).
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [needsProvider, setNeedsProvider] = useState(false);
  const [drainAfterStopText, setDrainAfterStopText] = useState<string | null>(null);

  // Optimistic user record — shown immediately on send until the SSE stream confirms (#399).
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [fallbackRecords, setFallbackRecords] = useState<readonly TranscriptRecord[]>([]);

  // #399: clear the optimistic record once the SSE stream delivers the matching user record.
  // Text-based check handles the case where SSE events pre-arrive before send (count stays equal).
  // Safe to double-fire in StrictMode dev — setPendingUserText(null) is idempotent.
  useEffect(() => {
    if (
      pendingUserText !== null &&
      props.records.some((r) => r.kind === "user" && r.text === pendingUserText)
    ) {
      setPendingUserText(null);
    }
  }, [props.records, pendingUserText]);

  // If SSE is connected, remove any POST-response fallback once the stream delivers the same reply.
  useEffect(() => {
    setFallbackRecords((current) =>
      current.filter(
        (fallback) =>
          !props.records.some(
            (record) => record.kind === fallback.kind && record.text === fallback.text
          )
      )
    );
  }, [props.records]);

  // #369: derive chat availability from the SAME onboarding status #365 added. When no provider is
  // connected, the empty state shows the connect-a-provider explainer instead of the seed prompts.
  const onboardingStatusQuery = useQuery({
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    enabled: props.open,
    retry: false
  });
  const chatAvailable = hasConnectedProvider(onboardingStatusQuery.data);
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

  /**
   * Unified send path for both the seed buttons and the manual composer (#400).
   * The IIFE keeps the function signature synchronous so call sites need no `void`/`async`.
   * try/finally guarantees isSending is ALWAYS cleared — this is the core wedge fix.
   */
  const sendMessage = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;
      setSendError(null);
      setNeedsProvider(false);
      setIsSending(true);
      setPendingUserText(trimmed);
      void (async () => {
        try {
          const result = await sendChatTurn(trimmed);
          setPendingUserText(null);
          const postResponseRecords: readonly TranscriptRecord[] = [
            { kind: "user", text: trimmed },
            { kind: "reply", text: result.reply }
          ];
          setFallbackRecords((current) =>
            [...current, ...postResponseRecords].filter(
              (fallback) => !props.records.some((record) => sameTranscriptRecord(record, fallback))
            )
          );
          void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
        } catch (caught) {
          setPendingUserText(null);
          if (isNoActiveChatModelError(caught)) {
            setNeedsProvider(true);
            return;
          }
          setSendError(caught instanceof Error ? caught.message : "Could not send message");
        } finally {
          setIsSending(false);
        }
      })();
    },
    [isSending, props.records, queryClient]
  );

  useEffect(() => {
    if (isSending || drainAfterStopText === null) return;
    const nextText = drainAfterStopText;
    setDrainAfterStopText(null);
    sendMessage(nextText);
  }, [drainAfterStopText, isSending, sendMessage]);

  if (!props.open) {
    return null;
  }

  const startNewChat = () => {
    setReviewThreadId(null);
    setShowHistory(false);
    setIsSending(false);
    setSendError(null);
    setNeedsProvider(false);
    setDrainAfterStopText(null);
    setPendingUserText(null);
    setFallbackRecords([]);
    void clearChat();
    props.clearRecords();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
  };

  /** #456 — stop the in-flight turn. The backend kills the engine + emits 'Stopped by user.' over
   *  SSE; the in-flight POST /turn then settles, clearing isSending in sendMessage's finally. */
  const stopSending = (queuedText: string | null): void => {
    if (queuedText !== null) {
      setDrainAfterStopText(queuedText);
    }
    void cancelChatTurn().catch(() => {
      // best-effort: the turn ends server-side regardless; a network error here just means the
      // local isSending flag clears when the POST /turn promise settles.
    });
  };

  const reviewing = reviewThreadId !== null;
  const displayRecords = reviewing
    ? recordsFromMessages(messagesQuery.data?.messages ?? [])
    : props.records;
  const selectedThread = (threadsQuery.data?.threads ?? []).find(
    (item) => item.id === reviewThreadId
  );
  const visibleFallbackRecords = fallbackRecords.filter(
    (fallback) => !displayRecords.some((record) => sameTranscriptRecord(record, fallback))
  );

  // Merge the optimistic user record into the live feed (#399). Only applied in live mode —
  // history review uses the fetched messages directly.
  const effectiveRecords: readonly TranscriptRecord[] = reviewing
    ? displayRecords
    : [
        ...displayRecords,
        ...(pendingUserText ? [{ kind: "user" as const, text: pendingUserText }] : []),
        ...visibleFallbackRecords
      ];

  const isWaiting = !reviewing && (isSending || pendingUserText !== null);

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
          aria-label={showHistory ? "Hide chat history" : "Show chat history"}
          aria-pressed={showHistory}
          className={`chatd__hbtn${showHistory ? " is-on" : ""}`}
          title={showHistory ? "Hide history" : "History"}
          type="button"
          onClick={() => setShowHistory((prev) => !prev)}
        >
          <Clock size={16} aria-hidden="true" />
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
        {showHistory ? (
          <HistoryList
            selectedThreadId={reviewThreadId}
            threads={threadsQuery.data?.threads ?? []}
            onSelect={setReviewThreadId}
          />
        ) : null}
        {reviewing ? (
          <div className="chatd-review">Reviewing {selectedThread?.title ?? "past chat"}</div>
        ) : null}
        {effectiveRecords.length > 0 ? (
          <Thread records={effectiveRecords} />
        ) : reviewing ? (
          <ReviewEmptyState />
        ) : onboardingStatusQuery.isSuccess && !chatAvailable ? (
          <ConnectProviderEmpty isFounder={props.isFounder} />
        ) : (
          <EmptyState onSend={sendMessage} isSending={isSending} />
        )}
        {isWaiting ? (
          <div className="chatd-loading" aria-live="polite" aria-label="Jarvis is thinking">
            <span className="chatd-msg__av">
              <Sparkles size={14} aria-hidden="true" />
            </span>
            <svg
              className="chatd-loading__bar"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 14 32 4"
              fill="currentColor"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path opacity="0.8" transform="translate(0 0)" d="M2 14 V18 H6 V14z">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0; 24 0; 0 0"
                  dur="2s"
                  begin="0"
                  repeatCount="indefinite"
                  keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8"
                  calcMode="spline"
                />
              </path>
              <path opacity="0.5" transform="translate(0 0)" d="M0 14 V18 H8 V14z">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0; 24 0; 0 0"
                  dur="2s"
                  begin="0.1s"
                  repeatCount="indefinite"
                  keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8"
                  calcMode="spline"
                />
              </path>
              <path opacity="0.25" transform="translate(0 0)" d="M0 14 V18 H8 V14z">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0; 24 0; 0 0"
                  dur="2s"
                  begin="0.2s"
                  repeatCount="indefinite"
                  keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8"
                  calcMode="spline"
                />
              </path>
            </svg>
          </div>
        ) : null}
      </div>

      <Composer
        readOnly={reviewing}
        isFounder={props.isFounder}
        initialText={props.initialText}
        isSending={isSending}
        sendError={sendError}
        needsProvider={needsProvider}
        onSend={sendMessage}
        onStop={stopSending}
      />
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

function sameTranscriptRecord(a: TranscriptRecord, b: TranscriptRecord): boolean {
  return a.kind === b.kind && a.text === b.text;
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

  // reply (and any unforeseen non-activity kind) — assistant bubble, rendered as markdown.
  return (
    <div className="chatd-msg">
      <span className="chatd-msg__av">
        <Sparkles size={14} aria-hidden="true" />
      </span>
      <div className="chatd-bubble">
        <MarkdownMessage text={text} />
      </div>
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

function EmptyState(props: {
  readonly onSend: (text: string) => void;
  readonly isSending: boolean;
}) {
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
            disabled={props.isSending}
            key={seed}
            type="button"
            onClick={() => props.onSend(seed)}
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

function Composer(props: {
  readonly readOnly: boolean;
  readonly isFounder: boolean;
  readonly initialText?: string;
  readonly isSending: boolean;
  readonly sendError: string | null;
  readonly needsProvider: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: (queuedText: string | null) => void;
}) {
  // Lazy initializer: the starter seeds the input on mount only. After that, the user owns the
  // value — typing/sending clears it and we never re-seed from the prop (no useEffect that would
  // clobber edits or re-fire the chip on re-render).
  const [text, setText] = useState(() => props.initialText ?? "");
  const [queuedText, setQueuedText] = useState<string | null>(null);

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

  return (
    <div className="chatd__composer">
      {props.needsProvider ? <ConnectProviderEmpty isFounder={props.isFounder} /> : null}
      {props.sendError ? <p className="form-error">{props.sendError}</p> : null}
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
          aria-label={props.isSending ? "Stop generating" : "Send"}
          className="chatd-send"
          disabled={props.readOnly || (!props.isSending && !text.trim())}
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
