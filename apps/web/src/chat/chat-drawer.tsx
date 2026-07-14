import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Clock,
  BookmarkPlus,
  GitCommitHorizontal,
  MessageSquareText,
  MoreHorizontal,
  ShieldOff,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  X
} from "lucide-react";
import { type UIEvent, useCallback, useEffect, useRef, useState } from "react";

import { BrandMark } from "../shell/brand-mark";

import { maybeCapturePageContext } from "./page-context";
import {
  cancelChatTurn,
  beaconEndPrivateChat,
  clearChat,
  endPrivateChat,
  getChatPrivacyState,
  getOnboardingStatus,
  listCalendarEvents,
  listChatThreadMessages,
  listChatThreads,
  listTasks,
  lookupAiCapabilityRoute,
  resumeChat,
  sendChatTurn
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import {
  createUsefulnessFeedback,
  undoUsefulnessFeedback
} from "../api/usefulness-feedback-client";
import type {
  ChatMessageDto,
  LocaleSettingsDto,
  UsefulnessFeedbackDto,
  UsefulnessFeedbackKind
} from "@jarv1s/shared";
import { formatDate, useUserLocale } from "../locale/locale-format";
import { ActionRequestCard } from "./action-request-card";
import { ChatModelPill } from "./chat-model-pill";
import { Composer } from "./composer";
import { ConnectProviderEmpty } from "./connect-provider-empty";
import { MarkdownMessage } from "./markdown-message";
import { buildChatSeeds } from "./seeds";
import { hasConnectedProvider, isNoActiveChatModelError } from "../onboarding/chat-availability";
import type { SourceFreshnessEntry, SourceFreshnessV1 } from "@jarv1s/shared";
import {
  shouldEndPrivateChatOnStreamDisconnect,
  type ChatRecordKind,
  type TranscriptRecord
} from "./use-chat-stream";
import "../styles/kit-chat.css";
import "../styles/kit-chat-skills.css";

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
  readonly streamErrorCount: number;
  /** #369: the founder set the instance up — tailors the empty-chat connect copy. */
  readonly isFounder: boolean;
  /**
   * #368: optional pre-filled composer text (the onboarding "Ask Jarvis" setup-check starter).
   * Seeds the input on mount only; it is NEVER auto-sent — the user reviews and presses send.
   */
  readonly initialText?: string;
  readonly focusActionRequestId?: string | null;
  readonly onActionRequestFocused?: () => void;
}) {
  const queryClient = useQueryClient();
  const [reviewThreadId, setReviewThreadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const [privateEnded, setPrivateEnded] = useState(false);
  const [activatingPrivate, setActivatingPrivate] = useState(false);
  const [privateActivationError, setPrivateActivationError] = useState<string | null>(null);

  const privacyStateQuery = useQuery({
    queryKey: queryKeys.chat.privacy,
    queryFn: () => getChatPrivacyState(),
    enabled: props.open
  });

  useEffect(() => {
    if (!privacyStateQuery.isSuccess) return;
    setPrivateMode(privacyStateQuery.data.incognito);
  }, [privacyStateQuery.isSuccess, privacyStateQuery.data]);

  // #633: autoscroll to the newest message by default; pause it the moment the user scrolls
  // away from the bottom, and resume (jumping straight to the latest record) on demand.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const AUTOSCROLL_THRESHOLD_PX = 48;

  const handleBodyScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceFromBottom <= AUTOSCROLL_THRESHOLD_PX);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const jumpToLatest = useCallback(() => {
    setStickToBottom(true);
    scrollToLatest("smooth");
  }, [scrollToLatest]);

  const resumeMutation = useMutation({
    mutationFn: (threadId: string) => resumeChat(threadId),
    onSuccess: () => {
      props.clearRecords();
      setShowHistory(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
    },
    onError: () => {
      setReviewThreadId(null);
      setShowHistory(true);
    }
  });

  // Lifted send state — shared by both the Composer and EmptyState seed buttons (#400).
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [needsProvider, setNeedsProvider] = useState(false);
  const [drainAfterStopText, setDrainAfterStopText] = useState<string | null>(null);

  // Optimistic user record — shown immediately on send until the SSE stream confirms (#399).
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [fallbackRecords, setFallbackRecords] = useState<readonly TranscriptRecord[]>([]);

  useEffect(() => {
    if (!privateMode) return;
    const endPrivate = () => beaconEndPrivateChat();
    window.addEventListener("beforeunload", endPrivate);
    return () => window.removeEventListener("beforeunload", endPrivate);
  }, [privateMode]);

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
  const chatRouteQuery = useQuery({
    queryKey: queryKeys.ai.capability("chat"),
    queryFn: () => lookupAiCapabilityRoute("chat"),
    enabled: props.open,
    retry: false
  });
  const lockedModelUnavailable = chatRouteQuery.data?.route?.reason === "admin-pin-unavailable";
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
  const historyActivationPending =
    reviewThreadId !== null && (resumeMutation.isPending || !messagesQuery.isSuccess);

  /**
   * Unified send path for both the seed buttons and the manual composer (#400).
   * The IIFE keeps the function signature synchronous so call sites need no `void`/`async`.
   * try/finally guarantees isSending is ALWAYS cleared — this is the core wedge fix.
   */
  const sendMessage = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isSending || privateEnded || activatingPrivate || historyActivationPending) {
        return;
      }
      if (reviewThreadId !== null) {
        setFallbackRecords(recordsFromMessages(messagesQuery.data?.messages ?? []));
        setReviewThreadId(null);
      }
      setSendError(null);
      setNeedsProvider(false);
      setIsSending(true);
      setPendingUserText(trimmed);
      void (async () => {
        try {
          const result = await sendChatTurn(trimmed, maybeCapturePageContext(trimmed)); // #679
          setPendingUserText(null);
          const postResponseRecords: readonly TranscriptRecord[] = [
            { kind: "user", text: trimmed, messageId: result.userMessageId },
            {
              kind: "reply",
              text: result.reply,
              messageId: result.assistantMessageId,
              sourceFreshness: result.sourceFreshness
            }
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
    [
      activatingPrivate,
      historyActivationPending,
      isSending,
      messagesQuery.data?.messages,
      privateEnded,
      props.records,
      queryClient,
      reviewThreadId
    ]
  );

  useEffect(() => {
    if (isSending || drainAfterStopText === null) return;
    const nextText = drainAfterStopText;
    setDrainAfterStopText(null);
    sendMessage(nextText);
  }, [drainAfterStopText, isSending, sendMessage]);

  const reviewing = reviewThreadId !== null;
  const displayRecords = reviewing
    ? recordsFromMessages(messagesQuery.data?.messages ?? [])
    : props.records;
  const visibleFallbackRecords = fallbackRecords.filter(
    (fallback) => !displayRecords.some((record) => sameTranscriptRecord(record, fallback))
  );

  // Merge the optimistic user record into the live feed (#399). Only applied in live mode —
  // history review uses the fetched messages directly. The optimistic pending record is the
  // NEWEST item, so it is appended AFTER the (older) fallback records — splicing it before
  // them made a just-sent message render above prior turns until SSE settled (#664).
  const effectiveRecords: readonly TranscriptRecord[] = reviewing
    ? displayRecords
    : [
        ...displayRecords,
        ...visibleFallbackRecords,
        ...(pendingUserText ? [{ kind: "user" as const, text: pendingUserText }] : [])
      ];

  const isWaiting = !reviewing && (isSending || pendingUserText !== null);

  useEffect(() => {
    if (
      shouldEndPrivateChatOnStreamDisconnect({
        privateMode,
        privateEnded,
        streamErrorCount: props.streamErrorCount
      })
    ) {
      setPrivateEnded(true);
      setIsSending(false);
      setPendingUserText(null);
      setDrainAfterStopText(null);
    }
  }, [privateEnded, privateMode, props.streamErrorCount]);

  // #633: switching what's displayed (new chat, opening a history row, toggling the history
  // list, or the drawer itself (re)opening — #638) always re-pins to the bottom of the
  // newly-shown content. Scrolls directly here (rather than relying solely on the effect below)
  // because the drawer renders null while closed — bodyRef only attaches once `open` flips back
  // to true, and the stickToBottom state set above wouldn't be visible to the other effect until
  // a subsequent render.
  useEffect(() => {
    setStickToBottom(true);
    if (props.open) {
      scrollToLatest("auto");
    }
  }, [reviewThreadId, showHistory, props.open, scrollToLatest]);

  // #633: jump straight to the bottom (no animation) whenever a new record/loading indicator
  // lands while the user hasn't scrolled away.
  useEffect(() => {
    if (stickToBottom) {
      scrollToLatest("auto");
    }
  }, [effectiveRecords.length, isWaiting, reviewThreadId, showHistory]);

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
    setPrivateMode(false);
    setPrivateEnded(false);
    void clearChat();
    props.clearRecords();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
  };

  const switchToNewModelChat = () => {
    startNewChat();
  };

  const startPrivateChat = () => {
    setReviewThreadId(null);
    setShowHistory(false);
    setIsSending(false);
    setSendError(null);
    setNeedsProvider(false);
    setDrainAfterStopText(null);
    setPendingUserText(null);
    setPrivateEnded(false);
    setPrivateActivationError(null);
    setActivatingPrivate(true);
    void (async () => {
      try {
        await clearChat({ incognito: true });
        setFallbackRecords([]);
        props.clearRecords();
        setPrivateMode(true);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads });
      } catch (caught) {
        setPrivateActivationError(
          caught instanceof Error ? caught.message : "Could not start a private chat"
        );
      } finally {
        setActivatingPrivate(false);
      }
    })();
  };

  const closePrivateChat = () => {
    setPrivateMode(false);
    setPrivateEnded(false);
    props.clearRecords();
    setFallbackRecords([]);
    void endPrivateChat();
  };

  /** #456 — stop the in-flight turn. The backend kills the engine + emits 'Stopped by user.' over
   *  SSE; the in-flight POST /turn then settles, clearing isSending in sendMessage's finally. */
  const stopSending = (queuedText: string | null): void => {
    if (queuedText !== null) {
      setDrainAfterStopText(queuedText);
    }
    void cancelChatTurn().catch(() => {
      // best-effort: the turn ends server-side regardless; a network error here just clears isSending.
    });
  };

  return (
    <aside className="chatd" role="dialog" aria-label="Chat with Jarvis">
      <div className="chatd__head">
        <span className="chatd__mark">
          <BrandMark size={16} />
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
          aria-label="Start private chat"
          aria-pressed={privateMode}
          className={`chatd__hbtn${privateMode ? " is-on" : ""}`}
          title="Private chat"
          type="button"
          onClick={startPrivateChat}
        >
          <ShieldOff size={16} aria-hidden="true" />
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

      <div className="chatd__body-wrap">
        <div className="chatd__body" ref={bodyRef} onScroll={handleBodyScroll}>
          {showHistory ? (
            <HistoryList
              selectedThreadId={reviewThreadId}
              threads={threadsQuery.data?.threads ?? []}
              onSelect={(id) => {
                setReviewThreadId(id);
                setShowHistory(false);
                resumeMutation.mutate(id);
              }}
              activating={resumeMutation.isPending}
            />
          ) : null}
          {!showHistory && activatingPrivate ? (
            <div className="chatd-private is-activating">
              <span>Starting private chat…</span>
            </div>
          ) : null}
          {!showHistory && privateActivationError ? (
            <div className="chatd-private is-error">
              <span>{privateActivationError}</span>
              <button type="button" onClick={() => setPrivateActivationError(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
          {!showHistory && privateMode && !reviewing ? (
            <div className={`chatd-private${privateEnded ? " is-ended" : ""}`}>
              <span>
                {privateEnded
                  ? "Private chat ended. Start a new chat to continue."
                  : "Private chat: not saved to history. Approved actions still keep records."}
              </span>
              <button type="button" onClick={closePrivateChat}>
                End
              </button>
            </div>
          ) : null}
          {showHistory ? null : effectiveRecords.length > 0 ? (
            <Thread
              records={effectiveRecords}
              focusActionRequestId={props.focusActionRequestId}
              onActionRequestFocused={props.onActionRequestFocused}
            />
          ) : onboardingStatusQuery.isSuccess && !chatAvailable ? (
            <ConnectProviderEmpty isFounder={props.isFounder} />
          ) : (
            <EmptyState
              onSend={sendMessage}
              isSending={isSending}
              lockedModelUnavailable={lockedModelUnavailable}
            />
          )}
          {isWaiting ? (
            <div className="chatd-loading" aria-live="polite" aria-label="Jarvis is thinking">
              <span className="chatd-msg__av">
                <BrandMark size={14} />
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
        {!stickToBottom ? (
          <button
            aria-label="Jump to latest message"
            className="chatd__jump"
            type="button"
            onClick={jumpToLatest}
          >
            <ChevronDown size={14} aria-hidden="true" />
            Jump to latest
          </button>
        ) : null}
      </div>

      <Composer
        modelSelector={
          <ChatModelPill
            disabled={privateEnded || isSending || historyActivationPending}
            privateMode={privateMode}
            onCrossProviderSwitch={switchToNewModelChat}
          />
        }
        readOnly={privateEnded || historyActivationPending}
        isFounder={props.isFounder}
        initialText={props.initialText}
        isSending={isSending}
        sendError={privateEnded ? "Private chat ended. Start a new chat to continue." : sendError}
        needsProvider={needsProvider}
        lockedModelUnavailable={lockedModelUnavailable}
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
  readonly activating: boolean;
}) {
  const locale = useUserLocale();
  if (props.threads.length === 0) {
    return <div className="chatd-sess chatd-sess--empty">No past conversations yet.</div>;
  }
  return (
    <div className="chatd-sess">
      <div className="chatd-sess__hd">History</div>
      {props.threads.map((thread) => (
        <button
          className={`chatd-sess__row${props.selectedThreadId === thread.id ? " is-selected" : ""}`}
          disabled={props.activating}
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
          <span className="chatd-sess__when">{formatShortDate(thread.updatedAt, locale)}</span>
        </button>
      ))}
    </div>
  );
}

/** The live conversation. Consecutive behind-the-scenes records (thinking/tool/status and
 *  resolved action results) collapse into one peek; replies and pending action requests
 *  stay front-and-centre. */
function Thread(props: {
  readonly records: readonly TranscriptRecord[];
  readonly focusActionRequestId?: string | null;
  readonly onActionRequestFocused?: () => void;
}) {
  return (
    <div className="chatd-thread" aria-live="polite">
      {groupRecords(props.records).map((item, index) =>
        item.type === "activity" ? (
          <ActivityPeek key={index} records={item.records} />
        ) : (
          <RecordRow
            key={index}
            record={item.record}
            focusActionRequestId={props.focusActionRequestId}
            onActionRequestFocused={props.onActionRequestFocused}
          />
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

export function ActivityPeek(props: { readonly records: readonly TranscriptRecord[] }) {
  const count = props.records.length;
  return (
    <details className="chatd-peek">
      <summary className="chatd-peek__summary">
        <GitCommitHorizontal size={13} aria-hidden="true" />
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

export function activityVerb(record: TranscriptRecord): string {
  if (record.kind === "action_result") {
    return record.outcome === "allowed"
      ? "Allowed by YOLO"
      : record.outcome === "executed"
        ? "Executed"
        : "Denied";
  }
  return `${record.kind} ·`;
}

function RecordRow(props: {
  readonly record: TranscriptRecord;
  readonly focusActionRequestId?: string | null;
  readonly onActionRequestFocused?: () => void;
}) {
  const { kind, text } = props.record;

  if (kind === "action_request" && props.record.actionRequestId) {
    return (
      <ActionRequestCard
        actionRequestId={props.record.actionRequestId}
        summary={props.record.summary ?? text}
        toolName={props.record.toolName ?? kind}
        preview={props.record.preview}
        focusRequested={props.record.actionRequestId === props.focusActionRequestId}
        onFocusComplete={props.onActionRequestFocused}
      />
    );
  }

  if (kind === "user") {
    return (
      <div className="chatd-msg chatd-msg--me">
        <div className="chatd-bubble">{text}</div>
        {props.record.messageId ? (
          <ChatFeedbackMenu messageId={props.record.messageId} canRemember />
        ) : null}
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
        <BrandMark size={14} />
      </span>
      <div className="chatd-bubble">
        <MarkdownMessage
          text={text}
          answerProvenance={props.record.answerProvenance}
          answerProvenanceCitedIds={props.record.answerProvenanceCitedIds}
        />
      </div>
      <ChatFreshnessFooter sourceFreshness={props.record.sourceFreshness} />
      {props.record.messageId ? (
        <ChatFeedbackMenu messageId={props.record.messageId} canRemember={false} />
      ) : null}
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
      text: message.body,
      messageId: message.id,
      answerProvenance: message.answerProvenance,
      answerProvenanceCitedIds: message.answerProvenanceCitedIds,
      sourceFreshness: message.role === "assistant" ? message.sourceFreshness : undefined
    }
  ]);
}

function chatFreshnessLabel(entry: SourceFreshnessEntry, capturedAt: string): string {
  if (entry.freshnessKind === "realtime") return "live";
  if (!entry.asOf) return "unknown";
  const ageMs = new Date(capturedAt).getTime() - new Date(entry.asOf).getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

const CHAT_SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  calendar: "Calendar",
  vault: "Notes",
  tasks: "Tasks",
  commitments: "Commitments",
  chats: "Chats",
  goals: "Goals"
};

export function ChatFreshnessFooter({
  sourceFreshness
}: {
  readonly sourceFreshness?: SourceFreshnessV1 | null;
}) {
  if (!sourceFreshness) return null;
  const summaryNames = sourceFreshness.sources
    .map((e) => CHAT_SOURCE_LABEL[e.source] ?? e.source)
    .join(", ");
  return (
    <details className="chatd-freshness chatd-peek">
      <summary className="chatd-peek__summary">
        <span className="chatd-peek__label">Sources</span>
        <span className="chatd-peek__count">{summaryNames}</span>
        <svg
          className="chatd-peek__chev"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <ul className="chatd-freshness__list chatd-peek__body">
        {sourceFreshness.sources.map((entry) => (
          <li key={entry.source} className="chatd-freshness__item chatd-peek__line">
            <span className="chatd-freshness__source">
              {CHAT_SOURCE_LABEL[entry.source] ?? entry.source}
            </span>
            <span className="chatd-freshness__age" title={entry.asOf ?? undefined}>
              {chatFreshnessLabel(entry, sourceFreshness.capturedAt)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ChatFeedbackMenu(props: { readonly messageId: string; readonly canRemember: boolean }) {
  const queryClient = useQueryClient();
  const [last, setLast] = useState<UsefulnessFeedbackDto | null>(null);
  const createMutation = useMutation({
    mutationFn: (kind: UsefulnessFeedbackKind) =>
      createUsefulnessFeedback({
        targetKind: "chat_message",
        targetRef: props.messageId,
        surface: "chat",
        kind
      }),
    onSuccess: (response) => {
      setLast(response.feedback);
      void queryClient.invalidateQueries({ queryKey: queryKeys.usefulnessFeedback.list });
    }
  });
  const undoMutation = useMutation({
    mutationFn: (id: string) => undoUsefulnessFeedback(id),
    onSuccess: () => {
      setLast(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.usefulnessFeedback.list });
    }
  });

  return (
    <div className="feedback-menu">
      <details className="feedback-menu__details">
        <summary className="feedback-menu__trigger" aria-label="Feedback" title="Feedback">
          <MoreHorizontal size={14} aria-hidden="true" />
        </summary>
        <div className="feedback-menu__list">
          <button
            type="button"
            onClick={() => createMutation.mutate("more_like_this")}
            disabled={createMutation.isPending}
          >
            <ThumbsUp size={13} aria-hidden="true" />
            More like this
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate("not_useful")}
            disabled={createMutation.isPending}
          >
            <ThumbsDown size={13} aria-hidden="true" />
            Not useful
          </button>
          {props.canRemember ? (
            <button
              type="button"
              onClick={() => createMutation.mutate("remember_this")}
              disabled={createMutation.isPending}
            >
              <BookmarkPlus size={13} aria-hidden="true" />
              Remember this
            </button>
          ) : null}
        </div>
      </details>
      {last ? (
        <span className="feedback-menu__status">
          Saved
          <button
            type="button"
            onClick={() => undoMutation.mutate(last.id)}
            disabled={undoMutation.isPending}
          >
            <Undo2 size={12} aria-hidden="true" />
            Undo
          </button>
        </span>
      ) : null}
    </div>
  );
}

function safeActivityKind(kind: string): ChatRecordKind {
  if (kind === "thinking" || kind === "tool" || kind === "status" || kind === "action_result") {
    return kind;
  }
  return "status";
}

function formatShortDate(value: string, locale: LocaleSettingsDto): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(value, locale, { month: "short", day: "numeric" });
}

function EmptyState(props: {
  readonly onSend: (text: string) => void;
  readonly isSending: boolean;
  readonly lockedModelUnavailable: boolean;
}) {
  const tasksQuery = useQuery({ queryKey: queryKeys.tasks.list, queryFn: () => listTasks() });
  const eventsQuery = useQuery({
    queryKey: queryKeys.calendar.list,
    queryFn: () => listCalendarEvents()
  });
  const locale = useUserLocale();

  const seeds = buildChatSeeds(
    tasksQuery.data?.tasks ?? [],
    eventsQuery.data?.events ?? [],
    locale
  );

  return (
    <div className="chatd-empty">
      <span className="chatd-empty__mark">
        <BrandMark size={22} />
      </span>
      <div className="chatd-empty__title">What can I help with?</div>
      <div className="chatd-empty__sub">
        Ask about your day, your tasks, or anything you&apos;ve told me.
      </div>
      <div className="chatd-sugg">
        {seeds.map((seed) => (
          <button
            className="chatd-sugg__btn"
            disabled={props.isSending || props.lockedModelUnavailable}
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
