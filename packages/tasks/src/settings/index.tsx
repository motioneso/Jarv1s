import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Group, Note, PaneHead, Row, Switch } from "@jarv1s/settings-ui";
import type {
  TaskAgencyAutoExecuteResponse,
  UpdateTaskAgencyAutoExecuteRequest
} from "@jarv1s/shared";

const AGENCY_AUTO_EXECUTE_KEY = ["tasks", "agency-auto-execute"] as const;

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

function getAgencyAutoExecute(): Promise<TaskAgencyAutoExecuteResponse> {
  return requestJson<TaskAgencyAutoExecuteResponse>("/api/tasks/agency-auto-execute");
}

function patchAgencyAutoExecute(enabled: boolean): Promise<TaskAgencyAutoExecuteResponse> {
  return requestJson<TaskAgencyAutoExecuteResponse>("/api/tasks/agency-auto-execute", {
    method: "PATCH",
    body: { enabled } satisfies UpdateTaskAgencyAutoExecuteRequest
  });
}

export default function TasksSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: AGENCY_AUTO_EXECUTE_KEY, queryFn: getAgencyAutoExecute });
  const mutation = useMutation({
    mutationFn: patchAgencyAutoExecute,
    onSuccess: (data) => queryClient.setQueryData(AGENCY_AUTO_EXECUTE_KEY, data)
  });

  const enabled = (mutation.data ?? query.data)?.enabled ?? false;
  const disabled = query.isLoading || mutation.isPending;
  const error = query.isError || mutation.isError;

  return (
    <>
      <PaneHead title="Tasks" desc="How Jarvis handles task changes from chat." />
      <Group title="Jarvis actions">
        <Row
          name="Let Jarvis create and update tasks without asking"
          desc="When off, Jarvis asks before creating, updating, scheduling, or completing tasks from chat."
          control={
            <Switch
              ariaLabel="Let Jarvis create and update tasks without asking"
              checked={enabled}
              disabled={disabled}
              onChange={(value) => mutation.mutate(value)}
            />
          }
        />
      </Group>
      {error ? <Note>Could not save task action preference. Try again.</Note> : null}
    </>
  );
}
