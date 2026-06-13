import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EmailMessageDto } from "@jarv1s/shared";
import {
  AlertTriangle,
  CalendarClock,
  CheckSquare,
  Inbox,
  LoaderCircle,
  Receipt,
  RefreshCw
} from "lucide-react";

import { listEmailMessages, syncGoogleConnector } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { Badge } from "../ui/badge";
import { Card, SectionHeader, Stack } from "../ui/card";
import { ProvisionalRegion } from "../ui/provisional-region";

import "./email.css";

/**
 * Triage view for cached email. Renders the LLM-derived summary + structured
 * signals (bills due, action items, deadlines, may-get-lost flag, importance,
 * confidence) inside the ProvisionalRegion governor. The raw email body is NEVER
 * persisted and is NOT present in the DTO — there is nothing to render here, by
 * design (privacy posture, spec §6).
 */

interface EmailBill {
  readonly description?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly dueDate?: string;
}
interface EmailActionItem {
  readonly text?: string;
  readonly dueDate?: string;
}
interface EmailDeadline {
  readonly text?: string;
  readonly date?: string;
}
interface EmailSignals {
  readonly billsDue?: readonly EmailBill[];
  readonly actionItems?: readonly EmailActionItem[];
  readonly deadlines?: readonly EmailDeadline[];
  readonly mayGetLostInShuffle?: boolean;
  readonly importance?: string;
  readonly confidence?: number;
}

export function EmailPage() {
  const queryClient = useQueryClient();
  const emailQuery = useQuery({
    queryKey: queryKeys.email.list,
    queryFn: () => listEmailMessages()
  });
  const syncMutation = useMutation({
    mutationFn: () => syncGoogleConnector(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.list });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.list });
    }
  });

  const messages = emailQuery.data?.messages ?? [];

  return (
    <section className="page-stack" aria-labelledby="email-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Email</p>
          <h1 id="email-title">Email</h1>
        </div>

        <button
          className="secondary-button"
          disabled={syncMutation.isPending}
          type="button"
          onClick={() => syncMutation.mutate()}
        >
          {syncMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <RefreshCw size={18} aria-hidden="true" />
          )}
          Sync now
        </button>
      </div>

      <section className="email-feed" aria-live="polite">
        {emailQuery.isLoading ? (
          <EmptyState loading title="Loading email" />
        ) : emailQuery.error ? (
          <EmptyState title={emailQuery.error.message} />
        ) : messages.length === 0 ? (
          <EmptyState title="No email messages" />
        ) : (
          messages.map((message) => <EmailTriageCard key={message.id} message={message} />)
        )}
      </section>
    </section>
  );
}

function EmailTriageCard(props: { readonly message: EmailMessageDto }) {
  const { message } = props;
  const signals = (message.signals ?? {}) as EmailSignals;
  const importance = signals.importance ?? "normal";

  return (
    <Card className="email-card">
      <Stack gap={0.75}>
        <SectionHeader
          eyebrow={message.sender}
          title={message.subject || "(no subject)"}
          trailing={
            <Stack align="flex-end" gap={0.35}>
              <span className="email-received">{formatReceived(message.receivedAt)}</span>
              <Badge tone={importanceTone(importance)}>{importanceLabel(importance)}</Badge>
            </Stack>
          }
        />

        {hasProvisionalContent(message, signals) ? (
          <ProvisionalRegion label="AI summary — provisional">
            <Stack gap={0.6}>
              {message.summary ? <p className="email-summary">{message.summary}</p> : null}

              {signals.mayGetLostInShuffle ? (
                <Badge tone="attention">
                  <AlertTriangle size={13} aria-hidden="true" />
                  May get lost in the shuffle
                </Badge>
              ) : null}

              {signals.billsDue && signals.billsDue.length > 0 ? (
                <SignalGroup
                  icon={<Receipt size={14} aria-hidden="true" />}
                  title="Bills due"
                  items={signals.billsDue.map(formatBill)}
                />
              ) : null}

              {signals.actionItems && signals.actionItems.length > 0 ? (
                <SignalGroup
                  icon={<CheckSquare size={14} aria-hidden="true" />}
                  title="Action items"
                  items={signals.actionItems.map(formatActionItem)}
                />
              ) : null}

              {signals.deadlines && signals.deadlines.length > 0 ? (
                <SignalGroup
                  icon={<CalendarClock size={14} aria-hidden="true" />}
                  title="Deadlines"
                  items={signals.deadlines.map(formatDeadline)}
                />
              ) : null}

              {typeof signals.confidence === "number" ? (
                <span className="email-confidence">
                  Confidence {Math.round(signals.confidence * 100)}%
                </span>
              ) : null}
            </Stack>
          </ProvisionalRegion>
        ) : (
          <p className="email-summary email-summary--empty">No summary available yet.</p>
        )}
      </Stack>
    </Card>
  );
}

function SignalGroup(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly items: readonly string[];
}) {
  return (
    <div className="email-signal-group">
      <p className="email-signal-title">
        {props.icon}
        {props.title}
      </p>
      <ul className="email-signal-list">
        {props.items.map((item, index) => (
          <li key={`${props.title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
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

function hasProvisionalContent(message: EmailMessageDto, signals: EmailSignals): boolean {
  return Boolean(
    message.summary ||
    signals.mayGetLostInShuffle ||
    (signals.billsDue && signals.billsDue.length > 0) ||
    (signals.actionItems && signals.actionItems.length > 0) ||
    (signals.deadlines && signals.deadlines.length > 0) ||
    typeof signals.confidence === "number"
  );
}

function importanceTone(importance: string): "neutral" | "accent" | "attention" {
  if (importance === "high") {
    return "attention";
  }
  if (importance === "low") {
    return "neutral";
  }
  return "accent";
}

function importanceLabel(importance: string): string {
  return `${importance.charAt(0).toUpperCase()}${importance.slice(1)} priority`;
}

function formatBill(bill: EmailBill): string {
  const amount =
    typeof bill.amount === "number"
      ? `${bill.currency ? `${bill.currency} ` : ""}${bill.amount}`
      : null;
  const parts = [
    bill.description ?? "Bill",
    amount,
    bill.dueDate ? `due ${formatDay(bill.dueDate)}` : null
  ];
  return parts.filter(Boolean).join(" — ");
}

function formatActionItem(item: EmailActionItem): string {
  const parts = [item.text ?? "Action", item.dueDate ? `by ${formatDay(item.dueDate)}` : null];
  return parts.filter(Boolean).join(" — ");
}

function formatDeadline(deadline: EmailDeadline): string {
  const parts = [deadline.text ?? "Deadline", deadline.date ? formatDay(deadline.date) : null];
  return parts.filter(Boolean).join(" — ");
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatReceived(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
