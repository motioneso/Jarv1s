import { useQuery } from "@tanstack/react-query";
import type { EmailMessageDto } from "@jarv1s/shared";
import { Inbox, LoaderCircle, Mail } from "lucide-react";

import { listEmailMessages } from "../api/client";
import { queryKeys } from "../api/query-keys";

interface EmailPageProps {
  readonly activeWorkspaceId: string | null;
}

export function EmailPage(props: EmailPageProps) {
  const messagesQuery = useQuery({
    queryKey: queryKeys.email.list(props.activeWorkspaceId),
    queryFn: () => listEmailMessages(props.activeWorkspaceId)
  });
  const messages = messagesQuery.data?.messages ?? [];

  return (
    <section className="page-stack" aria-labelledby="email-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Email</p>
          <h1 id="email-title">Email</h1>
        </div>
      </div>

      <section className="task-list" aria-live="polite">
        {messagesQuery.isLoading ? (
          <EmptyState loading title="Loading messages" />
        ) : messagesQuery.error ? (
          <EmptyState title={messagesQuery.error.message} />
        ) : messages.length === 0 ? (
          <EmptyState title="No messages" />
        ) : (
          messages.map((message) => <EmailMessageRow key={message.id} message={message} />)
        )}
      </section>
    </section>
  );
}

function EmailMessageRow(props: { readonly message: EmailMessageDto }) {
  return (
    <article className="task-row">
      <div className="task-status-icon" aria-hidden="true">
        <Mail size={22} />
      </div>
      <div className="task-row-main">
        <strong>{props.message.subject}</strong>
        <p>{props.message.snippet ?? props.message.bodyExcerpt ?? props.message.sender}</p>
        <div className="task-meta">
          <span>{props.message.sender}</span>
          {props.message.recipients.length > 0 ? (
            <span>To {props.message.recipients.join(", ")}</span>
          ) : null}
          <span>{formatMessageDate(props.message.receivedAt)}</span>
          <span>{props.message.visibility}</span>
        </div>
      </div>
    </article>
  );
}

function EmptyState(props: { readonly loading?: boolean; readonly title: string }) {
  return (
    <div className="empty-state">
      {props.loading ? (
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      ) : (
        <Inbox size={22} aria-hidden="true" />
      )}
      <p>{props.title}</p>
    </div>
  );
}

function formatMessageDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
