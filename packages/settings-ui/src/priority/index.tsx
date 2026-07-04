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

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Toggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="jds-switch">
      <input
        type="checkbox"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="jds-switch__track">
        <span className="jds-switch__thumb" />
      </span>
    </label>
  );
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

  if (isLoading) return <p className="set2-note">Loading priority settings...</p>;
  if (!model) return <p className="set2-note">Failed to load priority settings</p>;

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
      <div className="pane__head">
        <h2 className="pane__title">Priorities</h2>
        <p className="pane__desc">
          Tell Jarvis which projects, people, and sources should shape what rises to the top.
        </p>
      </div>

      <section className="pane__card">
        <header className="pane__cardhead">
          <div className="pane__cardheadmain">
            <div className="pane__cardtitle">Priority model</div>
            <div className="pane__carddesc">Choose the default bias Jarvis applies.</div>
          </div>
        </header>
        <div className="pane__cardbody">
          <div className="fld">
            <div className="fld__lbl">Mode</div>
            <div className="fld__row">
              <select
                className="jds-select"
                value={model.mode}
                disabled={mutation.isPending}
                onChange={(e) => {
                  mutation.mutate({
                    ...model,
                    mode: e.target.value as PriorityModelPreferenceV1["mode"],
                    updatedAt: new Date().toISOString()
                  });
                }}
              >
                <option value="balanced">Balanced</option>
                <option value="deadline_first">Deadline first</option>
                <option value="energy_protective">Energy protective</option>
              </select>
            </div>
            <div className="fld__hint">Balanced is the default for mixed workdays.</div>
          </div>
        </div>
      </section>

      <section className="pane__card">
        <header className="pane__cardhead">
          <div className="pane__cardheadmain">
            <div className="pane__cardtitle">Anchors</div>
            <div className="pane__carddesc">People, projects, goals, or obligations to weight.</div>
          </div>
          <div className="pane__cardaction">
            <button
              type="button"
              onClick={addAnchor}
              className="jds-btn jds-btn--secondary jds-btn--sm"
              disabled={mutation.isPending}
            >
              <span className="jds-btn__icon">
                <Plus size={15} aria-hidden="true" />
              </span>
              Add
            </button>
          </div>
        </header>
        <div className="pane__cardbody">
          {model.anchors.length === 0 ? <p className="set2-note">No anchors yet.</p> : null}
          {model.anchors.map((anchor, index) => (
            <div key={anchor.id} className="set-row">
              <div className="set-row__main">
                <div className="set-row__name">{anchor.label || "Untitled anchor"}</div>
                <div className="set-row__desc">
                  {titleCase(anchor.kind)} · Weight{" "}
                  {anchor.weight > 0 ? `+${anchor.weight}` : anchor.weight}
                </div>
                <div className="fld">
                  <div className="fld__lbl">Label</div>
                  <div className="fld__row">
                    <input
                      className="jds-input"
                      type="text"
                      placeholder="Project, person, goal..."
                      value={anchor.label}
                      disabled={mutation.isPending}
                      onChange={(e) => updateAnchor(index, { label: e.target.value })}
                      maxLength={120}
                    />
                  </div>
                </div>
                <div className="fld">
                  <div className="fld__lbl">Aliases</div>
                  <div className="fld__row">
                    <input
                      className="jds-input"
                      type="text"
                      placeholder="Comma-separated names"
                      value={anchor.aliases.join(", ")}
                      disabled={mutation.isPending}
                      onChange={(e) =>
                        updateAnchor(index, {
                          aliases: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="set-row__control">
                <div className="fld">
                  <div className="fld__lbl">Kind</div>
                  <div className="fld__row">
                    <select
                      className="jds-select"
                      value={anchor.kind}
                      disabled={mutation.isPending}
                      onChange={(e) =>
                        updateAnchor(index, { kind: e.target.value as PriorityAnchor["kind"] })
                      }
                    >
                      {VALID_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {titleCase(kind)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="fld">
                  <div className="fld__lbl">Weight</div>
                  <div className="fld__row">
                    <select
                      className="jds-select"
                      value={anchor.weight}
                      disabled={mutation.isPending}
                      onChange={(e) =>
                        updateAnchor(index, {
                          weight: Number(e.target.value) as PriorityAnchor["weight"]
                        })
                      }
                    >
                      {VALID_WEIGHTS.map((weight) => (
                        <option key={weight} value={weight}>
                          {weight > 0 ? `+${weight}` : weight}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Toggle
                  label={`${anchor.label || "Anchor"} enabled`}
                  checked={anchor.enabled}
                  disabled={mutation.isPending}
                  onChange={(checked) => updateAnchor(index, { enabled: checked })}
                />
                <button
                  type="button"
                  onClick={() => removeAnchor(index)}
                  className="jds-btn jds-btn--quiet jds-btn--sm"
                  aria-label="Remove anchor"
                  disabled={mutation.isPending}
                >
                  <span className="jds-btn__icon">
                    <Trash2 size={15} aria-hidden="true" />
                  </span>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pane__card">
        <header className="pane__cardhead">
          <div className="pane__cardheadmain">
            <div className="pane__cardtitle">Muted sources</div>
            <div className="pane__carddesc">
              Sources Jarvis should ignore when ranking priority.
            </div>
          </div>
        </header>
        <div className="pane__cardbody">
          {VALID_SOURCES.map((source) => (
            <div key={source} className="set-row">
              <div className="set-row__main">
                <div className="set-row__name">{titleCase(source)}</div>
              </div>
              <div className="set-row__control">
                <Toggle
                  label={`Mute ${source}`}
                  checked={model.mutedSources.includes(source)}
                  disabled={mutation.isPending}
                  onChange={() => toggleMutedSource(source)}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {mutation.isPending ? <p className="set2-note">Saving...</p> : null}
      {mutation.error ? <p className="set2-note">{mutation.error.message}</p> : null}
    </>
  );
}
