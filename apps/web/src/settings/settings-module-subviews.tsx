import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, MessageSquare, MessagesSquare, MoonStar, Sunrise } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ChatResponseStyle } from "@jarv1s/shared";

import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_SENSITIVITY_HINT,
  type NotificationSensitivity,
  type NotificationsSettings
} from "./settings-sample-data";
import {
  createBriefingDefinition,
  getChatSettings,
  getNotificationPreferences,
  getLocaleSettings,
  listSourceBehaviors,
  listAiAssistantTools,
  listBriefingDefinitions,
  putChatSettings,
  putNotificationPreference,
  putSourceBehavior,
  updateBriefingDefinition
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import {
  createDefinitionRequest,
  findDefinition,
  readSourceLabels,
  readToolNames,
  sourceListDescription,
  targetTimeFor,
  updateDefinitionRequest
} from "../briefings/briefing-settings-model";
import { Badge, Choice, Field, Group, NotWired, Note, Row, Segmented, Switch } from "./settings-ui";
import {
  BRIEFING_SOURCE_BEHAVIORS,
  findSourceBehaviorEnabled,
  writeSourceBehaviorCache
} from "./settings-source-behaviors";

// BACKEND-TODO: persist + apply Notifications sensitivity.

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
  const sourceBehaviorsQuery = useQuery({
    queryKey: queryKeys.settings.sourceBehaviors,
    queryFn: listSourceBehaviors,
    retry: false
  });
  const localeQuery = useQuery({
    queryKey: queryKeys.settings.locale,
    queryFn: getLocaleSettings
  });
  const localTimezone = localeQuery.data?.locale.timezone;
  const definitions = definitionsQuery.data?.definitions ?? [];
  const selectedToolNames = readToolNames(toolsQuery.data?.tools ?? []);
  const sourceLabels = readSourceLabels(toolsQuery.data?.tools ?? []);
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
          selectedToolNames,
          timezone: localTimezone
        })
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.briefings.definitions });
    }
  });
  const sourceBehaviorMutation = useMutation({
    mutationFn: (input: { readonly id: string; readonly enabled: boolean }) =>
      putSourceBehavior(input.id, { enabled: input.enabled }),
    onSuccess: (data) => writeSourceBehaviorCache(queryClient, data)
  });
  const busy =
    definitionsQuery.isLoading ||
    toolsQuery.isLoading ||
    sourceBehaviorsQuery.isLoading ||
    mutation.isPending ||
    sourceBehaviorMutation.isPending ||
    selectedToolNames.length === 0;
  const error =
    definitionsQuery.error ??
    toolsQuery.error ??
    sourceBehaviorsQuery.error ??
    mutation.error ??
    sourceBehaviorMutation.error;

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
        <Row name="Read tools" desc={sourceListDescription(sourceLabels)} />
        {BRIEFING_SOURCE_BEHAVIORS.map((behavior) => (
          <Row
            key={behavior.id}
            name={behavior.label}
            desc={behavior.description}
            control={
              <Switch
                ariaLabel={behavior.label}
                checked={findSourceBehaviorEnabled(
                  sourceBehaviorsQuery.data?.sources ?? [],
                  behavior.id
                )}
                disabled={busy}
                onChange={(enabled) => sourceBehaviorMutation.mutate({ id: behavior.id, enabled })}
              />
            }
          />
        ))}
      </Group>
    </ModuleSub>
  );
}

export function ChatSettingsView(props: { readonly onBack: () => void }) {
  const queryClient = useQueryClient();
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.settings,
    queryFn: getChatSettings
  });
  const mutation = useMutation({
    mutationFn: putChatSettings,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.settings, data)
  });
  const style = settingsQuery.data?.chat.responseStyle ?? "balanced";
  const error = settingsQuery.error ?? mutation.error;

  return (
    <ModuleSub
      icon={<MessagesSquare size={21} aria-hidden="true" />}
      name="Chat"
      sub="How Jarvis talks with you"
      onBack={props.onBack}
    >
      {error ? <NotWired>{readError(error)}</NotWired> : null}
      <Group title="Replies">
        <Choice
          key={style}
          label="Response style"
          hint="Saved default for generated chat answers."
          value={cap(style)}
          options={["Concise", "Balanced", "Detailed"]}
          onChange={(v) =>
            mutation.mutate({ chat: { responseStyle: v.toLowerCase() as ChatResponseStyle } })
          }
        />
      </Group>

      <Group title="Input">
        <Row
          name="Voice input"
          desc="Tracked for #738. Voice capture is not enabled in Chat settings yet."
          control={<Badge tone="steel">Coming soon</Badge>}
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
  readonly onModuleSettings?: (id: "briefings") => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<NotificationsSettings>(DEFAULT_NOTIFICATIONS);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NotificationsSettings>) => setState((s) => ({ ...s, ...patch }));
  const preferencesQuery = useQuery({
    queryKey: queryKeys.settings.notificationPreferences,
    queryFn: getNotificationPreferences,
    retry: false
  });
  const mutation = useMutation({
    mutationFn: (input: {
      readonly moduleId: string;
      readonly enabled: boolean;
      readonly clearUnread?: boolean;
    }) =>
      putNotificationPreference(input.moduleId, {
        enabled: input.enabled,
        clearUnread: input.clearUnread
      }),
    onSuccess: (data) => {
      setError(null);
      queryClient.setQueryData(queryKeys.settings.notificationPreferences, (current) => {
        const existing = current as
          | Awaited<ReturnType<typeof getNotificationPreferences>>
          | undefined;
        return {
          preferences: (existing?.preferences ?? []).map((preference) =>
            preference.moduleId === data.preference.moduleId ? data.preference : preference
          )
        };
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list });
    },
    onError: (err) => setError(readError(err))
  });
  const toggleModule = (moduleId: string, enabled: boolean) => {
    const clearUnread =
      !enabled && window.confirm("Mark existing unread notifications from this module as read?");
    mutation.mutate({ moduleId, enabled, clearUnread });
  };
  const preferences = preferencesQuery.data?.preferences ?? [];

  return (
    <ModuleSub
      icon={<Bell size={21} aria-hidden="true" />}
      name="Notifications"
      sub="What's worth surfacing, and how loudly"
      onBack={props.onBack}
    >
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
        <Row
          name="In-app"
          desc="The notification center inside Jarvis."
          control={<Badge tone="pine">Enabled</Badge>}
        />
        <Row name="Push" desc="System notifications on this device. Tracked in #743." coming />
        <Row
          name="Email digest"
          desc="A once-daily summary, instead of live alerts. Tracked in #742."
          coming
        />
      </Group>

      <Group title="Modules" desc="Mute a module without changing its own settings.">
        {error ? <NotWired>{error}</NotWired> : null}
        {preferences.length ? (
          preferences.map((preference) => (
            <Row
              key={preference.moduleId}
              name={preference.moduleName}
              desc={
                preference.moduleId === "briefings" ? (
                  <>
                    Briefing-ready notifications.{" "}
                    <button
                      type="button"
                      className="note__link"
                      onClick={() => props.onModuleSettings?.("briefings")}
                    >
                      Configure
                    </button>
                  </>
                ) : (
                  "Module notifications."
                )
              }
              control={
                <Switch
                  ariaLabel={`Notify from ${preference.moduleName}`}
                  checked={preference.enabled}
                  disabled={mutation.isPending}
                  onChange={(enabled) => toggleModule(preference.moduleId, enabled)}
                />
              }
            />
          ))
        ) : (
          <Row
            name={preferencesQuery.isLoading ? "Loading modules..." : "No module notifications"}
            desc={
              preferencesQuery.isLoading
                ? "Checking enabled modules."
                : "Enabled notification-capable modules will appear here."
            }
          />
        )}
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
