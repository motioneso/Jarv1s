import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, LoaderCircle, MessageSquare, Plus, Send, UserCircle, Zap } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { ChatMessageStatus } from "@jarv1s/shared";

import {
  appendChatUserMessage,
  createChatThread,
  listAiAssistantTools,
  listChatMessages,
  listChatThreads,
  lookupAiCapabilityRoute
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ChatDrawer } from "./chat-drawer";
import type { AiAssistantToolDto, ChatMessageDto, ChatThreadDto } from "@jarv1s/shared";

export function ChatPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const threadsQuery = useQuery({
    queryKey: queryKeys.chat.threads,
    queryFn: () => listChatThreads()
  });
  const messagesQuery = useQuery({
    enabled: activeThreadId !== null,
    queryKey: queryKeys.chat.messages(activeThreadId),
    queryFn: () => listChatMessages(activeThreadId ?? ""),
    refetchInterval: (query) => {
      const messages = query.state.data?.messages ?? [];
      const isLive = messages.some((m) => m.status === "pending" || m.status === "working");
      return isLive ? 1500 : false;
    }
  });
  const routeQuery = useQuery({
    queryKey: queryKeys.ai.capability("chat"),
    queryFn: () => lookupAiCapabilityRoute("chat")
  });
  const toolsQuery = useQuery({
    queryKey: queryKeys.ai.assistantTools,
    queryFn: () => listAiAssistantTools()
  });
  const threads = threadsQuery.data?.threads ?? [];
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  );

  useEffect(() => {
    if (!activeThreadId && threads[0]) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThreadId, threads]);

  return (
    <section className="page-stack" aria-labelledby="chat-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Chat</p>
          <h1 id="chat-title">Chat</h1>
        </div>
        <button className="primary-button" type="button" onClick={() => setDrawerOpen(true)}>
          <Zap size={18} aria-hidden="true" />
          Live chat
        </button>
      </div>

      <ChatDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <section className="chat-layout">
        <aside className="panel chat-sidebar" aria-label="Chat threads">
          <div className="panel-heading">
            <MessageSquare size={20} aria-hidden="true" />
            <h2>Threads</h2>
          </div>
          <CreateThreadForm onCreated={setActiveThreadId} />
          <ThreadList
            activeThreadId={activeThreadId}
            error={threadsQuery.error}
            isLoading={threadsQuery.isLoading}
            threads={threads}
            onSelect={setActiveThreadId}
          />
        </aside>

        <section className="panel chat-main" aria-label="Conversation">
          <div className="panel-heading">
            <Bot size={20} aria-hidden="true" />
            <h2>{activeThread?.title ?? "Messages"}</h2>
          </div>
          <RouteStatus route={routeQuery.data?.route ?? null} isLoading={routeQuery.isLoading} />
          <ToolSelector tools={toolsQuery.data?.tools ?? []} />
          <MessageList
            error={messagesQuery.error}
            isLoading={messagesQuery.isLoading}
            messages={messagesQuery.data?.messages ?? []}
          />
          <Composer
            activeThreadId={activeThreadId}
            tools={toolsQuery.data?.tools ?? []}
            onSent={async () => {
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.chat.threads
                }),
                queryClient.invalidateQueries({
                  queryKey: queryKeys.chat.messages(activeThreadId)
                })
              ]);
            }}
          />
        </section>
      </section>
    </section>
  );
}

function CreateThreadForm(props: { readonly onCreated: (threadId: string) => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () => {
      return createChatThread({ title });
    },
    onSuccess: async (response) => {
      setTitle("");
      setFormError(null);
      props.onCreated(response.thread.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.chat.threads
      });
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="chat-thread-form" onSubmit={handleSubmit}>
      <label>
        Thread title
        <input
          onChange={(event) => setTitle(event.target.value)}
          required
          type="text"
          value={title}
        />
      </label>
      {formError ? <p className="form-error">{formError}</p> : null}
      <button className="primary-button" disabled={createMutation.isPending} type="submit">
        {createMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        Create thread
      </button>
    </form>
  );
}

function ThreadList(props: {
  readonly activeThreadId: string | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly threads: readonly ChatThreadDto[];
  readonly onSelect: (threadId: string) => void;
}) {
  if (props.isLoading) {
    return <p className="muted-text">Loading chats</p>;
  }
  if (props.error) {
    return <p className="form-error">{props.error.message}</p>;
  }
  if (props.threads.length === 0) {
    return <p className="muted-text">No chat threads</p>;
  }

  return (
    <div className="chat-thread-list">
      {props.threads.map((thread) => (
        <button
          className={`chat-thread-button ${thread.id === props.activeThreadId ? "active" : ""}`}
          key={thread.id}
          type="button"
          onClick={() => props.onSelect(thread.id)}
        >
          <span>{thread.title}</span>
        </button>
      ))}
    </div>
  );
}

function RouteStatus(props: {
  readonly route: Awaited<ReturnType<typeof lookupAiCapabilityRoute>>["route"] | null;
  readonly isLoading: boolean;
}) {
  if (props.isLoading) {
    return <p className="capability-result">Loading chat route</p>;
  }
  if (!props.route?.model) {
    return <p className="capability-result">No active chat model</p>;
  }

  return (
    <p className="capability-result">
      {props.route.model.displayName} via {props.route.model.providerDisplayName}
    </p>
  );
}

function ToolSelector(props: { readonly tools: readonly AiAssistantToolDto[] }) {
  if (props.tools.length === 0) {
    return <p className="muted-text">No assistant tools declared</p>;
  }

  return (
    <div className="compact-list" aria-label="Assistant tool metadata">
      {props.tools.map((tool) => (
        <div className="compact-row" key={`${tool.moduleId}:${tool.name}`}>
          <span>{tool.name}</span>
          <strong>{tool.risk}</strong>
        </div>
      ))}
    </div>
  );
}

function MessageList(props: {
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly messages: readonly ChatMessageDto[];
}) {
  if (props.isLoading) {
    return <div className="empty-state">Loading messages</div>;
  }
  if (props.error) {
    return <div className="empty-state">{props.error.message}</div>;
  }
  if (props.messages.length === 0) {
    return <div className="empty-state">No messages</div>;
  }

  return (
    <div className="chat-messages" aria-live="polite">
      {props.messages.map((message) => (
        <article className={`chat-message ${message.role}`} key={message.id}>
          <div className="chat-message-icon" aria-hidden="true">
            {message.role === "assistant" ? <Bot size={18} /> : <UserCircle size={18} />}
          </div>
          <div>
            <div className="task-meta">
              <span>{message.role}</span>
              <span>{message.status}</span>
              {message.tools.map((tool) => (
                <span key={tool.name}>{tool.name}</span>
              ))}
            </div>
            <AssistantMessageBody
              status={message.status}
              body={message.body}
              activity={message.activity}
              role={message.role}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function AssistantMessageBody(props: {
  readonly role: string;
  readonly status: ChatMessageStatus;
  readonly body: string;
  readonly activity: readonly { readonly kind: string; readonly text: string }[];
}) {
  const isLive = props.status === "pending" || props.status === "working";
  const showActivity = props.activity.length > 0;

  if (props.role !== "assistant") {
    return <p>{props.body}</p>;
  }

  return (
    <div>
      {isLive && !showActivity ? <p className="muted-text">Working...</p> : null}
      {showActivity ? (
        <details className="activity-panel">
          <summary>
            {isLive ? "Working... " : ""}Agent activity ({props.activity.length} events)
          </summary>
          <ul className="activity-list">
            {props.activity.map((event, index) => (
              <li className="activity-item" key={index}>
                <strong>{event.kind}</strong> {event.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!isLive && props.body ? <p>{props.body}</p> : null}
      {props.status === "error" ? (
        <p className="form-error">An error occurred while generating the response.</p>
      ) : null}
    </div>
  );
}

function Composer(props: {
  readonly activeThreadId: string | null;
  readonly tools: readonly AiAssistantToolDto[];
  readonly onSent: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [selectedToolNames, setSelectedToolNames] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const appendMutation = useMutation({
    mutationFn: () => {
      if (!props.activeThreadId) {
        throw new Error("Create or select a chat thread first");
      }

      return appendChatUserMessage(props.activeThreadId, {
        body,
        selectedToolNames
      });
    },
    onSuccess: async () => {
      setBody("");
      setSelectedToolNames([]);
      setFormError(null);
      await props.onSent();
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    appendMutation.mutate();
  };

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <fieldset className="checkbox-group">
        <legend>Tool metadata</legend>
        {props.tools.map((tool) => (
          <label className="checkbox-row" key={`${tool.moduleId}:${tool.name}`}>
            <input
              checked={selectedToolNames.includes(tool.name)}
              onChange={(event) =>
                setSelectedToolNames((current) =>
                  event.target.checked
                    ? [...current, tool.name]
                    : current.filter((item) => item !== tool.name)
                )
              }
              type="checkbox"
            />
            {tool.name}
          </label>
        ))}
      </fieldset>
      <label>
        Message
        <textarea
          disabled={!props.activeThreadId}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={4}
          value={body}
        />
      </label>
      {formError ? <p className="form-error">{formError}</p> : null}
      <button
        className="primary-button"
        disabled={appendMutation.isPending || !props.activeThreadId}
        type="submit"
      >
        {appendMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Send size={18} aria-hidden="true" />
        )}
        Send message
      </button>
    </form>
  );
}
