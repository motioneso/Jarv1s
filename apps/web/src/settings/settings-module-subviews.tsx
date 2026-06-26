import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, MessageSquare, MessagesSquare, MoonStar, Sunrise } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DEFAULT_CHAT,
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_SENSITIVITY_HINT,
  type ChatSettings,
  type NotificationSensitivity,
  type NotificationsSettings
} from "./settings-sample-data";
import {
  createBriefingDefinition,
  listAiAssistantTools,
  listBriefingDefinitions,
  updateBriefingDefinition
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import {
  createDefinitionRequest,
  findDefinition,
  readToolNames,
  targetTimeFor,
  updateDefinitionRequest
} from "../briefings/briefing-settings-model";
import { Choice, Field, Group, NotWired, Note, Row, Segmented, Switch } from "./settings-ui";

// BACKEND-TODO: persist + apply the Chat / Notifications settings objects.
// Those sub-views are controlled local state only — nothing is saved or fed into behavior yet.

/* Shared takeover chrome for a settings-only module. */
function ModuleSub(props: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly sub: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="gflow">
      <button type="button" className="gflow__back" onClick={props.onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        All modules
      </button>
      <div className="gflow__intro">
        <span className="msub__mark">{props.icon}</span>
        <div className="gflow__introtx">
          <div className="gflow__title">{props.name}</div>
          <div className="gflow__sub">{props.sub}</div>
        </div>
      </div>
      {props.children}
    </div>
  );
}

function ToggleRow(props: {
  readonly name: string;
  readonly desc: string;
  readonly on: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <Row
      name={props.name}
      desc={props.desc}
      control={<Switch ariaLabel={props.name} checked={props.on} onChange={props.onChange} />}
    />
  );
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not update settings";
}

export function BriefingSettings(props: { readonly onBack: () => void }) {
  const queryClient = useQueryClient();
  const definitionsQuery = useQuery({
    queryKey: queryKeys.briefings.definitions,
    queryFn: listBriefingDefinitions
  });
  const toolsQuery = useQuery({
    queryKey: queryKeys.ai.assistantTools,
    queryFn: listAiAssistantTools
  });
  const definitions = definitionsQuery.data?.definitions ?? [];
  const selectedToolNames = readToolNames(toolsQuery.data?.tools ?? []);
  const morning = findDefinition(definitions, "morning");
  const evening = findDefinition(definitions, "evening");
  const mutation = useMutation({
    mutationFn: async (input: {
      readonly type: "morning" | "evening";
      readonly enabled?: boolean;
      readonly targetTime?: string;
    }) => {
      const current = findDefinition(definitions, input.type);
      if (current) {
        return updateBriefingDefinition(
          current.id,
          updateDefinitionRequest(current, {
            enabled: input.enabled,
            targetTime: input.targetTime
          })
        );
      }
      if (selectedToolNames.length === 0) {
        throw new Error("No read tools available for briefings");
      }
      return createBriefingDefinition(
        createDefinitionRequest({
          briefingType: input.type,
          enabled: input.enabled,
          targetTime: input.targetTime,
          selectedToolNames
        })
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.briefings.definitions });
    }
  });
  const busy =
    definitionsQuery.isLoading ||
    toolsQuery.isLoading ||
    mutation.isPending ||
    selectedToolNames.length === 0;
  const error = definitionsQuery.error ?? toolsQuery.error ?? mutation.error;

  return (
    <ModuleSub
      icon={<Sunrise size={21} aria-hidden="true" />}
      name="Briefings"
      sub="Your daily reading ritual"
      onBack={props.onBack}
    >
      {error ? <NotWired>{readError(error)}</NotWired> : null}
      <Group
        title="Cadence"
        desc="When Jarvis prepares your reading. It waits for you — nothing is pushed before this."
      >
        <Field
          label="Morning briefing"
          hint="Ready when you wake. Tone follows your assistant persona."
        >
          <input
            className="jds-input"
            type="time"
            value={targetTimeFor(morning, "morning")}
            disabled={busy}
            onChange={(e) => mutation.mutate({ type: "morning", targetTime: e.target.value })}
            aria-label="Morning briefing time"
          />
        </Field>
        <Row
          name="Evening wind-down"
          desc="A short look back, and a glance at tomorrow."
          control={
            <Switch
              ariaLabel="Evening wind-down"
              checked={evening?.enabled ?? false}
              onChange={(v) => mutation.mutate({ type: "evening", enabled: v })}
              disabled={busy}
            />
          }
        />
        {evening?.enabled ? (
          <Field label="Evening time">
            <input
              className="jds-input"
              type="time"
              value={targetTimeFor(evening, "evening")}
              disabled={busy}
              onChange={(e) => mutation.mutate({ type: "evening", targetTime: e.target.value })}
              aria-label="Evening time"
            />
          </Field>
        ) : null}
      </Group>

      <Group title="Sources">
        <Row
          name="Read tools"
          desc={`${selectedToolNames.length} read-only sources available for scheduled synthesis.`}
        />
      </Group>
    </ModuleSub>
  );
}

export function ChatSettingsView(props: { readonly onBack: () => void }) {
  const [state, setState] = useState<ChatSettings>(DEFAULT_CHAT);
  const set = (patch: Partial<ChatSettings>) => setState((s) => ({ ...s, ...patch }));
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

  return (
    <ModuleSub
      icon={<MessagesSquare size={21} aria-hidden="true" />}
      name="Chat"
      sub="How Jarvis talks with you"
      onBack={props.onBack}
    >
      <NotWired>Chat settings aren't saved or applied yet.</NotWired>
      <Group title="Replies">
        <Choice
          label="Response length"
          hint="Jarvis's default. It still expands when something genuinely needs it."
          value={cap(state.length)}
          options={["Concise", "Balanced", "Thorough"]}
          onChange={(v) => set({ length: v.toLowerCase() as ChatSettings["length"] })}
        />
        <ToggleRow
          name="Stream responses"
          desc="Show words as they're written, instead of all at once."
          on={state.streaming}
          onChange={(v) => set({ streaming: v })}
        />
        <ToggleRow
          name="Suggested actions"
          desc="Offer quick follow-ups beneath replies — turn into a task, add to calendar."
          on={state.suggestions}
          onChange={(v) => set({ suggestions: v })}
        />
      </Group>

      <Group title="Memory & input">
        <ToggleRow
          name="Remember across conversations"
          desc="Carry context between chats. Turn off for one-shot, stateless replies."
          on={state.crossSession}
          onChange={(v) => set({ crossSession: v })}
        />
        <ToggleRow
          name="Voice input"
          desc="Hold to talk instead of typing. Audio is transcribed on this server and never leaves it."
          on={state.voice}
          onChange={(v) => set({ voice: v })}
        />
      </Group>
      <Note icon={<MessageSquare size={13} />}>
        Jarvis's voice and directness are set once in <b>Assistant &amp; AI</b> — these only shape
        the chat surface.
      </Note>
    </ModuleSub>
  );
}

export function NotificationSettings(props: {
  readonly onBack: () => void;
  readonly onCat?: (id: string) => void;
}) {
  const [state, setState] = useState<NotificationsSettings>(DEFAULT_NOTIFICATIONS);
  const set = (patch: Partial<NotificationsSettings>) => setState((s) => ({ ...s, ...patch }));
  const setCh = (k: keyof NotificationsSettings["channels"], v: boolean) =>
    set({ channels: { ...state.channels, [k]: v } });
  const toggleType = (k: string, on: boolean) =>
    set({ types: state.types.map((t) => (t.k === k ? { ...t, on } : t)) });

  return (
    <ModuleSub
      icon={<Bell size={21} aria-hidden="true" />}
      name="Notifications"
      sub="What's worth surfacing, and how loudly"
      onBack={props.onBack}
    >
      <NotWired>Notification settings aren't saved or applied yet.</NotWired>
      <Group title="Sensitivity" desc="How readily Jarvis interrupts you.">
        <div className="nsens">
          <Segmented<NotificationSensitivity>
            value={state.sensitivity}
            options={[
              { value: "quiet", label: "Quiet" },
              { value: "balanced", label: "Balanced" },
              { value: "proactive", label: "Proactive" }
            ]}
            ariaLabel="Sensitivity"
            onChange={(v) => set({ sensitivity: v })}
          />
          <div className="nsens__hint">{NOTIFICATION_SENSITIVITY_HINT[state.sensitivity]}</div>
        </div>
      </Group>

      <Group title="Channels" desc="Where notifications reach you.">
        <ToggleRow
          name="In-app"
          desc="The notification center inside Jarvis."
          on={state.channels.app}
          onChange={(v) => setCh("app", v)}
        />
        <ToggleRow
          name="Push"
          desc="System notifications on this device."
          on={state.channels.push}
          onChange={(v) => setCh("push", v)}
        />
        <ToggleRow
          name="Email digest"
          desc="A once-daily summary, instead of live alerts."
          on={state.channels.email}
          onChange={(v) => setCh("email", v)}
        />
      </Group>

      <Group
        title="What you hear about"
        desc="Mute a whole category without changing your sensitivity."
      >
        {state.types.map((t) => (
          <ToggleRow
            key={t.k}
            name={t.name}
            desc={t.desc}
            on={t.on}
            onChange={(v) => toggleType(t.k, v)}
          />
        ))}
      </Group>
      <Note icon={<MoonStar size={13} />}>
        Quiet hours always win — Jarvis stays silent then unless something is urgent. Set them in{" "}
        <button type="button" className="note__link" onClick={() => props.onCat?.("general")}>
          General
        </button>
        .
      </Note>
    </ModuleSub>
  );
}
