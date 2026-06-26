import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Group, Note, PaneHead, Row, Switch } from "@jarv1s/settings-ui";
import type {
  GetEmailBriefingSettingsResponse,
  ListSourceBehaviorsResponse,
  PutSourceBehaviorResponse,
  UpdateEmailBriefingSettingsRequest,
  UpdateEmailBriefingSettingsResponse
} from "@jarv1s/shared";

const EMAIL_BEHAVIOR_ID = "email.briefings";
const SOURCE_BEHAVIORS_KEY = ["settings", "source-behaviors"] as const;
const EMAIL_SETTINGS_KEY = ["email", "briefing-settings"] as const;

async function requestJson<T>(path: string, init?: RequestInit & { body?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "include",
    headers
  });
  if (!response.ok) throw new Error(response.statusText || "Request failed");
  return (await response.json()) as T;
}

function getSourceBehaviors() {
  return requestJson<ListSourceBehaviorsResponse>("/api/me/source-behaviors");
}

function putSourceBehavior(enabled: boolean) {
  return requestJson<PutSourceBehaviorResponse>(
    `/api/me/source-behaviors/${encodeURIComponent(EMAIL_BEHAVIOR_ID)}`,
    { method: "PUT", body: { enabled } }
  );
}

function getEmailSettings() {
  return requestJson<GetEmailBriefingSettingsResponse>("/api/email/briefing-settings");
}

function patchEmailSettings(body: UpdateEmailBriefingSettingsRequest) {
  return requestJson<UpdateEmailBriefingSettingsResponse>("/api/email/briefing-settings", {
    method: "PATCH",
    body
  });
}

export default function EmailSettings() {
  const queryClient = useQueryClient();
  const sourceBehaviors = useQuery({ queryKey: SOURCE_BEHAVIORS_KEY, queryFn: getSourceBehaviors });
  const settingsQuery = useQuery({ queryKey: EMAIL_SETTINGS_KEY, queryFn: getEmailSettings });
  const behaviorMutation = useMutation({
    mutationFn: putSourceBehavior,
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: SOURCE_BEHAVIORS_KEY
      })
  });
  const settingsMutation = useMutation({
    mutationFn: patchEmailSettings,
    onSuccess: (data) => queryClient.setQueryData(EMAIL_SETTINGS_KEY, data)
  });

  const behaviorEnabled =
    sourceBehaviors.data?.sources
      .flatMap((source) => source.behaviors)
      .find((behavior) => behavior.id === EMAIL_BEHAVIOR_ID)?.enabled ?? true;
  const settings = (settingsMutation.data ?? settingsQuery.data)?.settings;
  const disabled =
    sourceBehaviors.isLoading ||
    settingsQuery.isLoading ||
    behaviorMutation.isPending ||
    settingsMutation.isPending;

  return (
    <>
      <PaneHead
        title="Email"
        desc="How briefing-worthy email turns into signal, suggestions, and governed follow-through."
      />
      <Group title="Briefing signal">
        <Row
          name="Include email signal in briefings"
          desc="Surface the specific threads that matter instead of inbox volume."
          control={
            <Switch
              ariaLabel="Include email signal in briefings"
              checked={behaviorEnabled}
              disabled={disabled}
              onChange={(value) => behaviorMutation.mutate(value)}
            />
          }
        />
      </Group>
      <Group title="Follow-through">
        <Row
          name="Create tasks from email signals"
          desc="Allow briefing-worthy email to become task proposals through the normal task action loop."
          control={
            <Switch
              ariaLabel="Create tasks from email signals"
              checked={settings?.createTasks ?? true}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ createTasks: value })}
            />
          }
        />
        <Row
          name="Suggest replies"
          desc="Let the briefing call out the specific thread that likely needs a reply."
          control={
            <Switch
              ariaLabel="Suggest replies"
              checked={settings?.suggestReplies ?? true}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ suggestReplies: value })}
            />
          }
        />
        <Row
          name="Draft replies"
          desc="Permit draft generation through normal email tooling when that path is available."
          control={
            <Switch
              ariaLabel="Draft replies"
              checked={settings?.draftReplies ?? true}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ draftReplies: value })}
            />
          }
        />
        <Row
          name="Auto-send replies"
          desc="High-governance option. Still requires the normal send policy and never creates a briefing-only bypass."
          control={
            <Switch
              ariaLabel="Auto-send replies"
              checked={settings?.autoSend ?? false}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ autoSend: value })}
            />
          }
        />
      </Group>
      {sourceBehaviors.isError ||
      settingsQuery.isError ||
      behaviorMutation.isError ||
      settingsMutation.isError ? (
        <Note>Could not save email briefing settings. Try again.</Note>
      ) : null}
    </>
  );
}
