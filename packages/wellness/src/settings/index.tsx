import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Group, Note, PaneHead, Row, Switch } from "@jarv1s/settings-ui";
import type { PutWellnessAiConsentRequest, WellnessAiConsentResponse } from "@jarv1s/shared";

const AI_CONSENT_KEY = ["wellness", "ai-consent"] as const;

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

function getWellnessAiConsent(): Promise<WellnessAiConsentResponse> {
  return requestJson<WellnessAiConsentResponse>("/api/wellness/ai-consent");
}

function putWellnessAiConsent(granted: boolean): Promise<WellnessAiConsentResponse> {
  return requestJson<WellnessAiConsentResponse>("/api/wellness/ai-consent", {
    method: "PUT",
    body: { granted } satisfies PutWellnessAiConsentRequest
  });
}

export default function WellnessSettings() {
  const queryClient = useQueryClient();
  const consentQuery = useQuery({
    queryKey: AI_CONSENT_KEY,
    queryFn: getWellnessAiConsent
  });
  const consentMutation = useMutation({
    mutationFn: putWellnessAiConsent,
    onSuccess: (data) => queryClient.setQueryData(AI_CONSENT_KEY, data)
  });

  const consent = consentMutation.data ?? consentQuery.data;
  const checked = consent?.effective ?? true;
  const disabled = consentQuery.isLoading || consentMutation.isPending;
  const error = consentQuery.isError || consentMutation.isError;

  return (
    <>
      <PaneHead title="Wellness" desc="What Jarvis can read from your Wellness data." />
      <Group title="AI access">
        <Row
          name="Allow Jarvis to read your wellness data"
          desc="When on, Jarvis can read your mood check-ins and medication adherence to reference them in briefings and answer questions about them. Counts only - never a medication list. Turn off anytime; Jarvis will explain how to re-enable if asked."
          control={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {consent?.explicit === null ? <Badge tone="neutral">Inherited</Badge> : null}
              <Switch
                ariaLabel="Allow Jarvis to read your wellness data"
                checked={checked}
                disabled={disabled}
                onChange={(value) => consentMutation.mutate(value)}
              />
            </span>
          }
        />
      </Group>
      {error ? <Note>Could not save Wellness AI access. Try again.</Note> : null}
      <Note>
        Disabling this does not turn off the Wellness module itself - you'll still log check-ins and
        meds; Jarvis just won't see them.
      </Note>
    </>
  );
}
