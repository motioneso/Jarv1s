import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getMemorySettings, patchMemorySettings, type MemorySettings } from "../api/memory-client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError, type PaneProps } from "./settings-types";
import { Group, PaneHead, Row, Segmented, Switch } from "./settings-ui";
import { MemoryDashboardPane } from "./settings-memory-dashboard";
import { SettingsPeoplePane } from "./settings-people-pane";

type MemoryTab = "memory" | "people";

const TAB_OPTIONS: readonly { value: MemoryTab; label: string }[] = [
  { value: "memory", label: "Memory" },
  { value: "people", label: "People & context" }
];

export function MemoryPane(_props: PaneProps) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<MemoryTab>("memory");

  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings,
    retry: false
  });
  const patchMutation = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => patchMemorySettings(patch),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.memorySettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const settings = settingsQuery.data;

  return (
    <>
      <PaneHead
        title="Memory & context"
        desc="Everything Jarvis remembers, believes, and infers: in the open, and yours to correct."
      />

      <Segmented value={tab} options={TAB_OPTIONS} onChange={setTab} ariaLabel="Memory section" />

      {tab === "memory" ? (
        <>
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
              desc="Always show where a belief came from: what you said, or what was inferred."
            />
          </Group>

          <MemoryDashboardPane />
        </>
      ) : (
        <SettingsPeoplePane />
      )}
    </>
  );
}
