/**
 * Priority settings pane.
 *
 * User-editable priority model: mode, anchors, muted sources.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { PriorityModelPreferenceV1, PriorityAnchor } from "@jarv1s/priority";
import { Badge, Field, Group, Note, PaneHead, Row, Select, Switch } from "../index.js";

const VALID_KINDS = ["project", "person", "domain", "goal", "obligation"] as const;
const VALID_SOURCES = ["tasks", "calendar", "email", "notes", "memory", "wellness"] as const;
/**
 * Sources no active consumer feeds into priority ranking. Muting them is stored
 * but has no effect yet.
 */
const UNWIRED_SOURCES: ReadonlySet<string> = new Set(["memory", "wellness"]);
const VALID_WEIGHTS = [-2, -1, 0, 1, 2] as const;

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

  if (isLoading) {
    return (
      <>
        <PaneHead title="Priorities" desc="Teach Jarvis what deserves attention first." />
        <Group title="Priority model">
          <Row name="Loading priority settings" desc="Fetching your current priority model." />
        </Group>
      </>
    );
  }

  if (!model) {
    return (
      <>
        <PaneHead title="Priorities" desc="Teach Jarvis what deserves attention first." />
        <Group title="Priority model">
          <Row name="Unavailable" desc="Failed to load priority settings." />
        </Group>
      </>
    );
  }

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

  const toggleMutedSource = (source: (typeof VALID_SOURCES)[number]) => {
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
    <>
      <PaneHead
        title="Priorities"
        desc="Tune the model Jarvis uses to rank projects, people, domains, goals, and obligations."
      />

      <Group
        title="Priority mode"
        desc="Choose the default weighting style Jarvis uses before anchors and muted sources are applied."
      >
        <Field label="Mode">
          <Select
            value={model.mode}
            aria-label="Priority mode"
            disabled={mutation.isPending}
            onChange={(event) => {
              mutation.mutate({
                ...model,
                mode: event.currentTarget.value as PriorityModelPreferenceV1["mode"],
                updatedAt: new Date().toISOString()
              });
            }}
          >
            <option value="balanced">Balanced</option>
            <option value="deadline_first">Deadline first</option>
            <option value="energy_protective">Energy protective</option>
          </Select>
        </Field>
      </Group>

      <Group
        title="Anchors"
        desc="Entities and patterns that should consistently move work up or down."
        action={
          <button
            type="button"
            onClick={addAnchor}
            className="jds-btn jds-btn--secondary jds-btn--sm"
            disabled={mutation.isPending}
          >
            <span className="jds-btn__icon">
              <Plus size={16} aria-hidden="true" />
            </span>
            Add anchor
          </button>
        }
      >
        {model.anchors.length === 0 ? (
          <Row
            name="No anchors"
            desc="Add one when a project, person, domain, goal, or obligation needs a standing bias."
          />
        ) : (
          model.anchors.map((anchor, index) => (
            <div key={anchor.id} className="set-row">
              <div className="set-row__main">
                <div className="set-row__name">
                  {anchor.label || "Untitled anchor"}{" "}
                  <Badge tone={anchor.enabled ? "pine" : "steel"}>
                    {anchor.enabled ? "Enabled" : "Muted"}
                  </Badge>
                </div>
                <div className="set-row__desc">
                  Configure how this anchor influences priority scoring.
                </div>
                <div className="fld">
                  <div className="fld__row">
                    <Switch
                      ariaLabel={`Enable ${anchor.label || "anchor"}`}
                      checked={anchor.enabled}
                      disabled={mutation.isPending}
                      onChange={(enabled) => updateAnchor(index, { enabled })}
                    />
                    <Select
                      value={anchor.kind}
                      aria-label="Anchor kind"
                      disabled={mutation.isPending}
                      onChange={(event) =>
                        updateAnchor(index, {
                          kind: event.currentTarget.value as PriorityAnchor["kind"]
                        })
                      }
                    >
                      {VALID_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {titleCase(kind)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={anchor.weight}
                      aria-label="Anchor weight"
                      disabled={mutation.isPending}
                      onChange={(event) =>
                        updateAnchor(index, {
                          weight: Number(event.currentTarget.value) as PriorityAnchor["weight"]
                        })
                      }
                    >
                      {VALID_WEIGHTS.map((weight) => (
                        <option key={weight} value={weight}>
                          {weight > 0 ? `+${weight}` : weight}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <Field label="Label">
                  <input
                    className="jds-input"
                    type="text"
                    placeholder="Label"
                    value={anchor.label}
                    disabled={mutation.isPending}
                    onChange={(event) => updateAnchor(index, { label: event.currentTarget.value })}
                    maxLength={120}
                  />
                </Field>
                <Field label="Aliases">
                  <input
                    className="jds-input"
                    type="text"
                    placeholder="Comma-separated aliases"
                    value={anchor.aliases.join(", ")}
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      updateAnchor(index, {
                        aliases: event.currentTarget.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </Field>
              </div>
              <div className="set-row__control">
                <button
                  type="button"
                  onClick={() => removeAnchor(index)}
                  className="jds-iconbtn jds-iconbtn--sm"
                  aria-label="Remove anchor"
                  disabled={mutation.isPending}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </Group>

      <Group
        title="Muted sources"
        desc="Sources excluded from priority ranking until turned back on."
      >
        {VALID_SOURCES.map((source) => (
          <Row
            key={source}
            name={titleCase(source)}
            desc={
              UNWIRED_SOURCES.has(source)
                ? "Nothing feeds this source into ranking yet, so muting has no effect."
                : "Exclude this source from priority ranking."
            }
            control={
              <Switch
                ariaLabel={`Mute ${source}`}
                checked={model.mutedSources.includes(source)}
                disabled={mutation.isPending}
                onChange={() => toggleMutedSource(source)}
              />
            }
          />
        ))}
      </Group>

      {mutation.isPending ? <Note>Saving priority settings...</Note> : null}
      {mutation.error ? <Note>{mutation.error.message}</Note> : null}
    </>
  );
}
