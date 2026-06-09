import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, X } from "lucide-react";

import {
  deleteMemoryFact,
  getMemoryFacts,
  getMemorySettings,
  patchMemorySettings,
  type MemoryFact
} from "../api/client";
import { queryKeys } from "../api/query-keys";

export function MemoryPanel(props: { readonly onClose: () => void }) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings
  });

  const factsQuery = useQuery({
    queryKey: queryKeys.chat.memoryFacts,
    queryFn: getMemoryFacts
  });

  const patchSettings = useMutation({
    mutationFn: patchMemorySettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memorySettings })
  });

  const deleteFact = useMutation({
    mutationFn: deleteMemoryFact,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.memoryFacts })
  });

  const settings = settingsQuery.data;
  const facts = factsQuery.data?.facts ?? [];

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
          <input
            type="checkbox"
            checked={settings?.factsEnabled ?? true}
            onChange={(e) => patchSettings.mutate({ factsEnabled: e.target.checked })}
          />
          Remember facts about me
        </label>
      </section>

      <section className="memory-facts">
        <h4>What Jarvis knows about you</h4>
        {facts.length === 0 ? (
          <p className="muted-text">No facts stored yet.</p>
        ) : (
          <ul className="memory-fact-list">
            {facts.map((fact: MemoryFact) => (
              <li key={fact.id} className="memory-fact-item">
                <span className="memory-fact-category">{fact.category}</span>
                <span className="memory-fact-content">{fact.content}</span>
                <button
                  aria-label={`Delete fact: ${fact.content}`}
                  className="icon-button"
                  type="button"
                  onClick={() => deleteFact.mutate(fact.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
