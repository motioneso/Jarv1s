import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, X } from "lucide-react";

import { getMemorySettings, patchMemorySettings } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function MemoryPanel(props: { readonly onClose: () => void }) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings
  });

  const patchSettings = useMutation({
    mutationFn: patchMemorySettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memorySettings })
  });

  const settings = settingsQuery.data;

  return (
    <div className="memory-panel">
      <div className="memory-panel-header">
        <div className="panel-heading">
          <Brain size={16} aria-hidden="true" />
          <h3>My Memory</h3>
        </div>
        <button
          aria-label="Close memory panel"
          className="icon-button"
          type="button"
          onClick={props.onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <section className="memory-settings">
        <label className="memory-toggle">
          <input
            type="checkbox"
            checked={settings?.recallEnabled ?? true}
            onChange={(e) => patchSettings.mutate({ recallEnabled: e.target.checked })}
          />
          Recall past conversations
        </label>
        <label className="memory-toggle">
          <input disabled type="checkbox" checked={false} />
          Remember facts about me (coming soon)
        </label>
      </section>

      <section className="memory-facts">
        <h4>What Jarvis knows about you</h4>
        <p className="muted-text">Fact extraction coming in Phase 3.</p>
      </section>
    </div>
  );
}
