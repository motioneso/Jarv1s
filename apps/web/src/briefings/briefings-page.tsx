import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Newspaper, Play, Plus, Save } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createBriefingDefinition,
  listAiAssistantTools,
  listBriefingDefinitions,
  listBriefingRuns,
  runBriefingDefinition,
  updateBriefingDefinition
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type {
  AiAssistantToolDto,
  BriefingCadence,
  BriefingDefinitionDto,
  BriefingRunDto,
  BriefingVisibility
} from "@jarv1s/shared";

interface BriefingsPageProps {
  readonly activeWorkspaceId: string | null;
}

export function BriefingsPage(props: BriefingsPageProps) {
  const [activeDefinitionId, setActiveDefinitionId] = useState<string | null>(null);
  const definitionsQuery = useQuery({
    queryKey: queryKeys.briefings.definitions(props.activeWorkspaceId),
    queryFn: () => listBriefingDefinitions(props.activeWorkspaceId)
  });
  const toolsQuery = useQuery({
    queryKey: queryKeys.ai.assistantTools(props.activeWorkspaceId),
    queryFn: () => listAiAssistantTools(props.activeWorkspaceId)
  });
  const definitions = definitionsQuery.data?.definitions ?? [];
  const activeDefinition = useMemo(
    () => definitions.find((definition) => definition.id === activeDefinitionId) ?? null,
    [activeDefinitionId, definitions]
  );
  const runsQuery = useQuery({
    enabled: activeDefinitionId !== null,
    queryKey: queryKeys.briefings.runs(activeDefinitionId, props.activeWorkspaceId),
    queryFn: () => listBriefingRuns(activeDefinitionId ?? "", props.activeWorkspaceId)
  });
  const readTools = useMemo(
    () => (toolsQuery.data?.tools ?? []).filter((tool) => tool.risk === "read"),
    [toolsQuery.data?.tools]
  );

  useEffect(() => {
    if (!activeDefinitionId && definitions[0]) {
      setActiveDefinitionId(definitions[0].id);
    }
  }, [activeDefinitionId, definitions]);

  return (
    <section className="page-stack" aria-labelledby="briefings-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Briefings</p>
          <h1 id="briefings-title">Briefings</h1>
        </div>
      </div>

      <section className="chat-layout">
        <aside className="panel chat-sidebar" aria-label="Briefing definitions">
          <div className="panel-heading">
            <Newspaper size={20} aria-hidden="true" />
            <h2>Definitions</h2>
          </div>
          <CreateBriefingForm
            activeWorkspaceId={props.activeWorkspaceId}
            readTools={readTools}
            onCreated={setActiveDefinitionId}
          />
          <DefinitionList
            activeDefinitionId={activeDefinitionId}
            definitions={definitions}
            error={definitionsQuery.error}
            isLoading={definitionsQuery.isLoading}
            onSelect={setActiveDefinitionId}
          />
        </aside>

        <section className="panel chat-main" aria-label="Briefing detail">
          <div className="panel-heading">
            <Newspaper size={20} aria-hidden="true" />
            <h2>{activeDefinition?.title ?? "Runs"}</h2>
          </div>
          <DefinitionEditor
            activeWorkspaceId={props.activeWorkspaceId}
            definition={activeDefinition}
            readTools={readTools}
          />
          <RunList
            error={runsQuery.error}
            isLoading={runsQuery.isLoading}
            runs={runsQuery.data?.runs ?? []}
          />
        </section>
      </section>
    </section>
  );
}

function CreateBriefingForm(props: {
  readonly activeWorkspaceId: string | null;
  readonly readTools: readonly AiAssistantToolDto[];
  readonly onCreated: (definitionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<BriefingVisibility>("private");
  const [cadence, setCadence] = useState<BriefingCadence>("manual");
  const [selectedToolNames, setSelectedToolNames] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () => {
      if (visibility === "workspace" && !props.activeWorkspaceId) {
        throw new Error("Select a workspace first");
      }
      if (selectedToolNames.length === 0) {
        throw new Error("Select at least one read tool");
      }

      return createBriefingDefinition(
        {
          title,
          visibility,
          workspaceId: visibility === "workspace" ? props.activeWorkspaceId : null,
          cadence,
          scheduleMetadata: {},
          enabled: true,
          selectedToolNames
        },
        props.activeWorkspaceId
      );
    },
    onSuccess: async (response) => {
      setTitle("");
      setSelectedToolNames([]);
      setFormError(null);
      props.onCreated(response.definition.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.briefings.definitions(props.activeWorkspaceId)
      });
    },
    onError: (error) => setFormError(readError(error, "Unable to create briefing"))
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="chat-thread-form" onSubmit={handleSubmit}>
      <label>
        New briefing title
        <input
          onChange={(event) => setTitle(event.target.value)}
          required
          type="text"
          value={title}
        />
      </label>
      <label>
        Cadence
        <select
          onChange={(event) => setCadence(event.target.value as BriefingCadence)}
          value={cadence}
        >
          <option value="manual">Manual</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <div className="segmented-control" aria-label="Briefing visibility">
        <button
          className={visibility === "private" ? "active" : ""}
          type="button"
          onClick={() => setVisibility("private")}
        >
          Private
        </button>
        <button
          className={visibility === "workspace" ? "active" : ""}
          type="button"
          onClick={() => setVisibility("workspace")}
        >
          Workspace
        </button>
      </div>
      <ToolCheckboxes
        label="New briefing sources"
        readTools={props.readTools}
        selectedToolNames={selectedToolNames}
        onChange={setSelectedToolNames}
      />
      {formError ? <p className="form-error">{formError}</p> : null}
      <button className="primary-button" disabled={createMutation.isPending} type="submit">
        {createMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        Create briefing
      </button>
    </form>
  );
}

function DefinitionList(props: {
  readonly activeDefinitionId: string | null;
  readonly definitions: readonly BriefingDefinitionDto[];
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly onSelect: (definitionId: string) => void;
}) {
  if (props.isLoading) {
    return <p className="muted-text">Loading briefings</p>;
  }
  if (props.error) {
    return <p className="form-error">{props.error.message}</p>;
  }
  if (props.definitions.length === 0) {
    return <p className="muted-text">No briefing definitions</p>;
  }

  return (
    <div className="chat-thread-list">
      {props.definitions.map((definition) => (
        <button
          className={`chat-thread-button ${
            definition.id === props.activeDefinitionId ? "active" : ""
          }`}
          key={definition.id}
          type="button"
          onClick={() => props.onSelect(definition.id)}
        >
          <span>{definition.title}</span>
          <small>
            {definition.cadence} - {definition.enabled ? "enabled" : "disabled"}
          </small>
        </button>
      ))}
    </div>
  );
}

function DefinitionEditor(props: {
  readonly activeWorkspaceId: string | null;
  readonly definition: BriefingDefinitionDto | null;
  readonly readTools: readonly AiAssistantToolDto[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<BriefingCadence>("manual");
  const [enabled, setEnabled] = useState(true);
  const [selectedToolNames, setSelectedToolNames] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const definitionId = props.definition?.id ?? null;

  useEffect(() => {
    const definition = props.definition;

    if (!definition) {
      setTitle("");
      setCadence("manual");
      setEnabled(true);
      setSelectedToolNames([]);
      return;
    }

    setTitle(definition.title);
    setCadence(definition.cadence);
    setEnabled(definition.enabled);
    setSelectedToolNames(definition.selectedToolNames);
    setFormError(null);
    setRunMessage(null);
  }, [definitionId]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!props.definition) {
        throw new Error("Select a briefing first");
      }
      if (selectedToolNames.length === 0) {
        throw new Error("Select at least one read tool");
      }

      return updateBriefingDefinition(
        props.definition.id,
        {
          title,
          cadence,
          enabled,
          selectedToolNames
        },
        props.activeWorkspaceId
      );
    },
    onSuccess: async () => {
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.briefings.definitions(props.activeWorkspaceId)
      });
    },
    onError: (error) => setFormError(readError(error, "Unable to save briefing"))
  });
  const runMutation = useMutation({
    mutationFn: () => {
      if (!props.definition) {
        throw new Error("Select a briefing first");
      }

      return runBriefingDefinition(
        props.definition.id,
        {
          idempotencyKey: `web:${props.definition.id}:${Date.now()}`
        },
        props.activeWorkspaceId
      );
    },
    onSuccess: async (response) => {
      setRunMessage(`Queued ${response.runId}`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.briefings.definitions(props.activeWorkspaceId)
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.briefings.runs(props.definition?.id ?? null, props.activeWorkspaceId)
        })
      ]);
    },
    onError: (error) => setFormError(readError(error, "Unable to run briefing"))
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    updateMutation.mutate();
  };

  if (!props.definition) {
    return <div className="empty-state">No briefing selected</div>;
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <label>
        Edit briefing title
        <input
          onChange={(event) => setTitle(event.target.value)}
          required
          type="text"
          value={title}
        />
      </label>
      <label>
        Cadence
        <select
          onChange={(event) => setCadence(event.target.value as BriefingCadence)}
          value={cadence}
        >
          <option value="manual">Manual</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label className="checkbox-row">
        <input
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
        Enabled
      </label>
      <ToolCheckboxes
        label="Edit briefing sources"
        readTools={props.readTools}
        selectedToolNames={selectedToolNames}
        onChange={setSelectedToolNames}
      />
      <div className="task-row-actions">
        <button className="primary-button" disabled={updateMutation.isPending} type="submit">
          {updateMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Save size={18} aria-hidden="true" />
          )}
          Save briefing
        </button>
        <button
          className="secondary-button"
          disabled={runMutation.isPending}
          type="button"
          onClick={() => runMutation.mutate()}
        >
          {runMutation.isPending ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
          Run briefing
        </button>
      </div>
      {formError ? <p className="form-error">{formError}</p> : null}
      {runMessage ? <p className="muted-text">{runMessage}</p> : null}
    </form>
  );
}

function ToolCheckboxes(props: {
  readonly label: string;
  readonly readTools: readonly AiAssistantToolDto[];
  readonly selectedToolNames: readonly string[];
  readonly onChange: (selectedToolNames: readonly string[]) => void;
}) {
  if (props.readTools.length === 0) {
    return <p className="muted-text">No read tools available</p>;
  }

  return (
    <fieldset className="checkbox-group" aria-label={props.label}>
      <legend>Sources</legend>
      {props.readTools.map((tool) => (
        <label className="checkbox-row" key={`${tool.moduleId}:${tool.name}`}>
          <input
            checked={props.selectedToolNames.includes(tool.name)}
            onChange={(event) =>
              props.onChange(
                event.target.checked
                  ? [...props.selectedToolNames, tool.name]
                  : props.selectedToolNames.filter((name) => name !== tool.name)
              )
            }
            type="checkbox"
          />
          {tool.name}
        </label>
      ))}
    </fieldset>
  );
}

function RunList(props: {
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly runs: readonly BriefingRunDto[];
}) {
  if (props.isLoading) {
    return <div className="empty-state">Loading runs</div>;
  }
  if (props.error) {
    return <div className="empty-state">{props.error.message}</div>;
  }
  if (props.runs.length === 0) {
    return <div className="empty-state">No runs</div>;
  }

  return (
    <div className="chat-messages" aria-live="polite">
      {props.runs.map((run) => (
        <article className="chat-message assistant" key={run.id}>
          <div className="chat-message-icon" aria-hidden="true">
            <Newspaper size={18} />
          </div>
          <div>
            <div className="task-meta">
              <span>{run.status}</span>
              <span>{run.runKind}</span>
              <span>{formatDate(run.createdAt)}</span>
            </div>
            <p>{run.summaryText}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
