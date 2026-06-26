import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Group, Note, PaneHead, Row, Switch } from "@jarv1s/settings-ui";
import type {
  GetCalendarBriefingSettingsResponse,
  ListSourceBehaviorsResponse,
  PutSourceBehaviorResponse,
  UpdateCalendarBriefingSettingsRequest,
  UpdateCalendarBriefingSettingsResponse
} from "@jarv1s/shared";

const CALENDAR_BEHAVIOR_ID = "calendar.briefings";
const SOURCE_BEHAVIORS_KEY = ["settings", "source-behaviors"] as const;
const CALENDAR_SETTINGS_KEY = ["calendar", "briefing-settings"] as const;

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
    `/api/me/source-behaviors/${encodeURIComponent(CALENDAR_BEHAVIOR_ID)}`,
    { method: "PUT", body: { enabled } }
  );
}

function getCalendarSettings() {
  return requestJson<GetCalendarBriefingSettingsResponse>("/api/calendar/briefing-settings");
}

function patchCalendarSettings(body: UpdateCalendarBriefingSettingsRequest) {
  return requestJson<UpdateCalendarBriefingSettingsResponse>("/api/calendar/briefing-settings", {
    method: "PATCH",
    body
  });
}

export default function CalendarSettings() {
  const queryClient = useQueryClient();
  const sourceBehaviors = useQuery({ queryKey: SOURCE_BEHAVIORS_KEY, queryFn: getSourceBehaviors });
  const settingsQuery = useQuery({ queryKey: CALENDAR_SETTINGS_KEY, queryFn: getCalendarSettings });
  const behaviorMutation = useMutation({
    mutationFn: putSourceBehavior,
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: SOURCE_BEHAVIORS_KEY
      })
  });
  const settingsMutation = useMutation({
    mutationFn: patchCalendarSettings,
    onSuccess: (data) => queryClient.setQueryData(CALENDAR_SETTINGS_KEY, data)
  });

  const behaviorEnabled =
    sourceBehaviors.data?.sources
      .flatMap((source) => source.behaviors)
      .find((behavior) => behavior.id === CALENDAR_BEHAVIOR_ID)?.enabled ?? true;
  const settings = (settingsMutation.data ?? settingsQuery.data)?.settings;
  const disabled =
    sourceBehaviors.isLoading ||
    settingsQuery.isLoading ||
    behaviorMutation.isPending ||
    settingsMutation.isPending;

  return (
    <>
      <PaneHead
        title="Calendar"
        desc="How calendar-derived signals show up in briefings, without bypassing normal task or time-block governance."
      />
      <Group title="Briefing signal">
        <Row
          name="Include calendar signal in briefings"
          desc="Use calendar-derived readiness signals instead of replaying the whole agenda."
          control={
            <Switch
              ariaLabel="Include calendar signal in briefings"
              checked={behaviorEnabled}
              disabled={disabled}
              onChange={(value) => behaviorMutation.mutate(value)}
            />
          }
        />
        <Row
          name="Look ahead two days"
          desc="Let the briefing flag prep-needed meetings coming up soon."
          control={
            <Switch
              ariaLabel="Look ahead two days"
              checked={(settings?.lookaheadDays ?? 2) === 2}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ lookaheadDays: value ? 2 : 0 })}
            />
          }
        />
      </Group>
      <Group title="Follow-through">
        <Row
          name="Suggest prep tasks"
          desc="Allow the briefing to recommend a task when a meeting likely needs prep."
          control={
            <Switch
              ariaLabel="Suggest prep tasks"
              checked={settings?.suggestTasks ?? true}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ suggestTasks: value })}
            />
          }
        />
        <Row
          name="Create prep tasks automatically"
          desc="Only affects the normal action loop; briefings still do not bypass approval policy."
          control={
            <Switch
              ariaLabel="Create prep tasks automatically"
              checked={settings?.createTasks ?? false}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ createTasks: value })}
            />
          }
        />
        <Row
          name="Suggest time blocks"
          desc="Allow the briefing to recommend buffer or work blocks when the schedule is tight."
          control={
            <Switch
              ariaLabel="Suggest time blocks"
              checked={settings?.suggestTimeBlocks ?? true}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ suggestTimeBlocks: value })}
            />
          }
        />
        <Row
          name="Block time automatically"
          desc="Still routes through the normal calendar action policy; this does not create a briefing bypass."
          control={
            <Switch
              ariaLabel="Block time automatically"
              checked={settings?.blockTime ?? false}
              disabled={disabled}
              onChange={(value) => settingsMutation.mutate({ blockTime: value })}
            />
          }
        />
      </Group>
      {sourceBehaviors.isError ||
      settingsQuery.isError ||
      behaviorMutation.isError ||
      settingsMutation.isError ? (
        <Note>Could not save calendar briefing settings. Try again.</Note>
      ) : null}
    </>
  );
}
