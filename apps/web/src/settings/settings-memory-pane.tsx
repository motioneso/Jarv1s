import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMemoryFacts,
  getMemorySettings,
  patchMemorySettings,
  type MemorySettings
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError, type PaneProps } from "./settings-types";
import { Group, PaneHead, Row, Switch } from "./settings-ui";

export function MemoryPane(_props: PaneProps) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings,
    retry: false
  });
  const factsQuery = useQuery({
    queryKey: queryKeys.chat.memoryFacts,
    queryFn: getMemoryFacts,
    retry: false
  });
  const patchMutation = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => patchMemorySettings(patch),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.memorySettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const settings = settingsQuery.data;
  const factCount = factsQuery.data?.facts.length ?? 0;

  return (
    <>
      <PaneHead
        title="Memory & context"
        desc="Everything Jarvis remembers, believes and infers - in the open, and yours to correct."
      />

      <Group title="What Jarvis can use">
        <Row
          name="Conversation recall"
          desc="Remember past conversations so you don't have to repeat yourself."
          control={
            <Switch
              ariaLabel="Conversation recall"
              checked={settings?.recallEnabled ?? true}
              onChange={(value) => patchMutation.mutate({ recallEnabled: value })}
            />
          }
        />
        <Row
          name="Learn patterns"
          desc="Notice habits over time and offer them as inferred patterns you can confirm."
          control={
            <Switch
              ariaLabel="Learn patterns"
              checked={settings?.factsEnabled ?? true}
              onChange={(value) => patchMutation.mutate({ factsEnabled: value })}
            />
          }
        />
        <Row
          name="Show provenance"
          desc="Always show where a belief came from - what you said, or what was inferred."
          coming
        />
      </Group>

      <Group
        title="What Jarvis knows"
        desc="Confirmed facts stay until you change them. Inferred patterns decay on their own over time."
      >
        <Row
          name="Remembered facts"
          desc="Things you've told Jarvis, or it confirmed with you."
          control={<span className="memory-count">{factCount}</span>}
        />
        <Row
          name="Inferred patterns"
          desc="Guesses from your behaviour, awaiting your yes or no."
          coming
        />
        <Row
          name="Corrections"
          desc="Times you've put Jarvis right. It learns from every one."
          coming
        />
      </Group>

      <Group title="Forget">
        <Row
          name="Review & delete memories"
          desc="See everything Jarvis holds and remove anything you'd rather it forgot."
          coming
        />
        <Row
          name="Memory retention window"
          desc="Automatically forget low-value details after a set time."
          coming
        />
        <Row
          name="Per-topic memory controls"
          desc="Choose what Jarvis may remember, topic by topic."
          coming
        />
      </Group>
    </>
  );
}
