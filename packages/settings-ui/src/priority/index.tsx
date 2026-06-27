/**
 * Priority settings pane.
 *
 * User-editable priority model: mode, anchors, muted sources.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { PriorityModelPreferenceV1, PriorityAnchor } from "@jarv1s/priority";

const VALID_KINDS = ["project", "person", "domain", "goal", "obligation"] as const;
const VALID_SOURCES = ["tasks", "calendar", "email", "notes", "memory", "wellness"] as const;
const VALID_WEIGHTS = [-2, -1, 0, 1, 2] as const;

interface PrioritySettingsProps {
  readonly onError?: (message: string) => void;
  readonly onSuccess?: () => void;
}

export function PrioritySettings({ onError, onSuccess }: PrioritySettingsProps) {
  const queryClient = useQueryClient();
  const { data: model, isLoading } = useQuery<PriorityModelPreferenceV1>({
    queryKey: ["priority-model"],
    queryFn: async () => {
      const res = await fetch("/api/me/priority-model");
      if (!res.ok) throw new Error("Failed to fetch priority model");
      return res.json();
    }
  });

  const mutation = useMutation({
    mutationFn: async (updated: PriorityModelPreferenceV1) => {
      const res = await fetch("/api/me/priority-model", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save priority model");
      }
      return res.json() as Promise<PriorityModelPreferenceV1>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["priority-model"] });
      onSuccess?.();
    },
    onError: (err) => {
      onError?.(err instanceof Error ? err.message : "Unknown error");
    }
  });

  if (isLoading) return <div className="loading">Loading priority settings...</div>;
  if (!model) return <div className="error">Failed to load priority settings</div>;

  const addAnchor = () => {
    const newAnchor: PriorityAnchor = {
      id: crypto.randomUUID(),
      kind: "project",
      label: "",
      aliases: [],
      weight: 1,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mutation.mutate({
      ...model,
      anchors: [...model.anchors, newAnchor],
      updatedAt: new Date().toISOString()
    });
  };
    const newAnchor: PriorityAnchor = {
      id: crypto.randomUUID(),
      kind: "project",
      label: "",
      aliases: [],
      weight: 1,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mutation.mutate({
      ...model,
      anchors: [...model.anchors, newAnchor],
      updatedAt: new Date().toISOString()
    });
  };

  const updateAnchor = (index: number, updates: Partial<PriorityAnchor>) => {
    const updated = [...model.anchors];
    updated[index] = { ...updated[index]!, ...updates, updatedAt: new Date().toISOString() };
    mutation.mutate({
      ...model,
      anchors: updated,
      updatedAt: new Date().toISOString()
    });
  };

  const removeAnchor = (index: number) => {
    mutation.mutate({
      ...model,
      anchors: model.anchors.filter((_, i) => i !== index),
      updatedAt: new Date().toISOString()
    });
  };

  const addAnchor = () => {
    const newAnchor: PriorityAnchor = {
      id: crypto.randomUUID(),
      kind: "project",
      label: "",
      aliases: [],
      weight: 1,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mutation.mutate({
      ...model,
      anchors: [...model.anchors, newAnchor],
      updatedAt: new Date().toISOString()
    });
  };

  const updateAnchor = (index: number, updates: Partial<PriorityAnchor>) => {
    const updated = [...model.anchors];
    updated[index] = { ...updated[index]!, ...updates, updatedAt: new Date().toISOString() };
    mutation.mutate({
      ...model,
      anchors: updated,
      updatedAt: new Date().toISOString()
    });
  };

  const removeAnchor = (index: number) => {
    mutation.mutate({
      ...model,
      anchors: model.anchors.filter((_, i) => i !== index),
      updatedAt: new Date().toISOString()
    });
  };

  const toggleMutedSource = (source: typeof VALID_SOURCES[number]) => {
    const updated = model.mutedSources.includes(source)
      ? model.mutedSources.filter((s) => s !== source)
      : [...model.mutedSources, source];
    mutation.mutate({
      ...model,
      mutedSources: updated,
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <div className="priority-settings">
      <div className="priority-mode">
        <label>Priority Mode</label>
        <select
          value={model.mode}
          onChange={(e) => {
            mutation.mutate({
              ...model,
              mode: e.target.value as PriorityModelPreferenceV1["mode"],
              updatedAt: new Date().toISOString()
            });
          }}
        >
          <option value="balanced">Balanced</option>
          <option value="deadline_first">Deadline First</option>
          <option value="energy_protective">Energy Protective</option>
        </select>
      </div>

      <div className="priority-anchors">
        <div className="anchors-header">
          <label>Anchors</label>
          <button type="button" onClick={addAnchor} className="add-anchor">
            <Plus size={16} />
            Add Anchor
          </button>
        </div>
        {model.anchors.map((anchor, index) => (
          <div key={anchor.id} className="anchor-row">
            <input
              type="checkbox"
              checked={anchor.enabled}
              onChange={(e) => updateAnchor(index, { enabled: e.target.checked })}
            />
            <select
              value={anchor.kind}
              onChange={(e) => updateAnchor(index, { kind: e.target.value as PriorityAnchor["kind"] })}
            >
              {VALID_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0).toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Label"
              value={anchor.label}
              onChange={(e) => updateAnchor(index, { label: e.target.value })}
              maxLength={120}
            />
            <input
              type="text"
              placeholder="Aliases (comma-separated)"
              value={anchor.aliases.join(", ")}
              onChange={(e) =>
                updateAnchor(index, {
                  aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                })
              }
            />
            <select
              value={anchor.weight}
              onChange={(e) => updateAnchor(index, { weight: Number(e.target.value) as PriorityAnchor["weight"] })}
            >
              {VALID_WEIGHTS.map((weight) => (
                <option key={weight} value={weight}>
                  {weight > 0 ? `+${weight}` : weight}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeAnchor(index)}
              className="remove-anchor"
              aria-label="Remove anchor"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="priority-muted-sources">
        <label>Muted Sources</label>
        {VALID_SOURCES.map((source) => (
          <label key={source} className="source-checkbox">
            <input
              type="checkbox"
              checked={model.mutedSources.includes(source)}
              onChange={() => toggleMutedSource(source)}
            />
            {source.charAt(0).toUpperCase() + source.slice(1)}
          </label>
        ))}
      </div>

      <div className="priority-muted-sources">
        <label>Muted Sources</label>
        {VALID_SOURCES.map((source) => (
          <label key={source} className="source-checkbox">
            <input
              type="checkbox"
              checked={model.mutedSources.includes(source)}
              onChange={() => toggleMutedSource(source)}
            />
            {source.charAt(0).toUpperCase() + source.slice(1)}
          </label>
        ))}
      </div>

      {mutation.isPending && <div className="saving">Saving...</div>}
      {mutation.error && <div className="error">{mutation.error.message}</div>}
    </div>
  );
}
