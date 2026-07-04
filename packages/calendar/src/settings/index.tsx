import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Group, Note, PaneHead, Row, Select, Switch } from "@jarv1s/settings-ui";
import type {
  AiActionPolicyTier,
  CalendarAutomationMode,
  GetCalendarBriefingSettingsResponse,
  GetAiActionPoliciesResponse,
  ListSourceBehaviorsResponse,
  PatchAiActionPolicyResponse,
  PutSourceBehaviorResponse,
  UpdateCalendarBriefingSettingsRequest,
  UpdateCalendarBriefingSettingsResponse
} from "@jarv1s/shared";

const CALENDAR_BEHAVIOR_ID = "calendar.briefings";
const CALENDAR_MODULE_ID = "calendar";
const CALENDAR_WRITEBACK_FAMILY_ID = "calendar_writeback";
const SOURCE_BEHAVIORS_KEY = ["settings", "source-behaviors"] as const;
const CALENDAR_SETTINGS_KEY = ["calendar", "briefing-settings"] as const;
const ACTION_POLICY_KEY = ["ai", "action-policy"] as const;

export const CALENDAR_MODE_OPTIONS: ReadonlyArray<{
  readonly value: CalendarAutomationMode;
  readonly label: string;
  readonly desc: string;
}> = [
  { value: "off", label: "Off", desc: "Do not create suggestions or actions." },
  { value: "suggest", label: "Suggest", desc: "Show a governed suggestion for review." },
  { value: "auto", label: "Auto", desc: "Run the scoped action without asking again." }
];

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

function getActionPolicies() {
  return requestJson<GetAiActionPoliciesResponse>("/api/ai/action-policy");
}

function patchWritebackPolicy(tier: AiActionPolicyTier) {
  return requestJson<PatchAiActionPolicyResponse>(
    `/api/ai/action-policy/${encodeURIComponent(CALENDAR_MODULE_ID)}/${encodeURIComponent(CALENDAR_WRITEBACK_FAMILY_ID)}`,
    { method: "PATCH", body: { tier } }
  );
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
  const policiesQuery = useQuery({ queryKey: ACTION_POLICY_KEY, queryFn: getActionPolicies });
  const writebackPolicyMutation = useMutation({
    mutationFn: patchWritebackPolicy,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACTION_POLICY_KEY })
  });

  const behaviorEnabled =
    sourceBehaviors.data?.sources
      .flatMap((source) => source.behaviors)
      .find((behavior) => behavior.id === CALENDAR_BEHAVIOR_ID)?.enabled ?? true;
  const settings = (settingsMutation.data ?? settingsQuery.data)?.settings;
  const prepTaskMode = settings?.prepTaskMode ?? "suggest";
  const timeBlockMode = settings?.timeBlockMode ?? "suggest";
  const commitmentMode = settings?.commitmentMode ?? "off";
  const prepTaskModeOption = CALENDAR_MODE_OPTIONS.find((option) => option.value === prepTaskMode);
  const timeBlockModeOption = CALENDAR_MODE_OPTIONS.find(
    (option) => option.value === timeBlockMode
  );
  const commitmentModeOption = CALENDAR_MODE_OPTIONS.find(
    (option) => option.value === commitmentMode
  );
  const disabled =
    sourceBehaviors.isLoading ||
    settingsQuery.isLoading ||
    behaviorMutation.isPending ||
    settingsMutation.isPending;
  const writebackPolicyDisabled = policiesQuery.isLoading || writebackPolicyMutation.isPending;

  function updateTimeBlockMode(mode: CalendarAutomationMode) {
    settingsMutation.mutate({ timeBlockMode: mode });
    writebackPolicyMutation.mutate(mode === "auto" ? "trusted_auto" : "ask_each_time");
  }

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
          name="Prep tasks"
          desc={prepTaskModeOption?.desc ?? "How meeting prep becomes tasks."}
          control={
            <Select
              aria-label="Prep tasks"
              value={prepTaskMode}
              disabled={disabled}
              onChange={(event) =>
                settingsMutation.mutate({
                  prepTaskMode: event.currentTarget.value as CalendarAutomationMode
                })
              }
            >
              {CALENDAR_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          }
        />
        <Row
          name="Time blocks"
          desc={timeBlockModeOption?.desc ?? "How calendar signals become time blocks."}
          control={
            <Select
              aria-label="Time blocks"
              value={timeBlockMode}
              disabled={disabled || writebackPolicyDisabled}
              onChange={(event) =>
                updateTimeBlockMode(event.currentTarget.value as CalendarAutomationMode)
              }
            >
              {CALENDAR_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          }
        />
        <Row
          name="Commitment detection"
          desc={commitmentModeOption?.desc ?? "How meeting commitments become tracked commitments."}
          control={
            <Select
              aria-label="Commitment detection"
              value={commitmentMode}
              disabled={disabled}
              onChange={(event) =>
                settingsMutation.mutate({
                  commitmentMode: event.currentTarget.value as CalendarAutomationMode
                })
              }
            >
              {CALENDAR_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          }
        />
      </Group>
      {sourceBehaviors.isError ||
      settingsQuery.isError ||
      behaviorMutation.isError ||
      settingsMutation.isError ||
      policiesQuery.isError ||
      writebackPolicyMutation.isError ? (
        <Note>Could not save calendar briefing settings. Try again.</Note>
      ) : null}
    </>
  );
}
