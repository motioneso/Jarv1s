import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BrainCircuit,
  CircleOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RotateCcw,
  SearchCheck
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createAiModel,
  createAiProvider,
  listAiAssistantTools,
  listAiModels,
  listAiProviders,
  lookupAiCapabilityRoute,
  revokeAiProvider,
  updateAiModel,
  updateAiProvider
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type {
  AiConfiguredModelDto,
  AiModelCapability,
  AiModelStatus,
  AiProviderConfigDto,
  AiProviderKind,
  AiProviderStatus
} from "@jarv1s/shared";

const AI_PROVIDER_KINDS: readonly AiProviderKind[] = [
  "openai-compatible",
  "anthropic",
  "google",
  "ollama",
  "custom"
];
const AI_CAPABILITIES: readonly AiModelCapability[] = [
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
];

export function AiSettingsPanel() {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: () => listAiProviders()
  });
  const modelsQuery = useQuery({
    queryKey: queryKeys.ai.models,
    queryFn: () => listAiModels()
  });
  const assistantToolsQuery = useQuery({
    queryKey: queryKeys.ai.assistantTools,
    queryFn: () => listAiAssistantTools()
  });
  const providers = providersQuery.data?.providers ?? [];
  const models = modelsQuery.data?.models ?? [];

  return (
    <>
      <section className="panel span-2" aria-labelledby="ai-providers-title">
        <div className="panel-heading">
          <BrainCircuit size={20} aria-hidden="true" />
          <h2 id="ai-providers-title">AI Providers</h2>
        </div>
        <CreateAiProviderForm onCreated={() => invalidateAiQueries(queryClient)} />
        <AiProviderList
          error={providersQuery.error}
          isLoading={providersQuery.isLoading}
          providers={providers}
        />
      </section>

      <section className="panel" aria-labelledby="ai-models-title">
        <div className="panel-heading">
          <Bot size={20} aria-hidden="true" />
          <h2 id="ai-models-title">AI Models</h2>
        </div>
        <CreateAiModelForm
          providers={providers}
          onCreated={() => invalidateAiQueries(queryClient)}
        />
        <AiModelList error={modelsQuery.error} isLoading={modelsQuery.isLoading} models={models} />
      </section>

      <section className="panel" aria-labelledby="ai-routing-title">
        <div className="panel-heading">
          <SearchCheck size={20} aria-hidden="true" />
          <h2 id="ai-routing-title">Capability Routing</h2>
        </div>
        <CapabilityLookup />
        <div className="compact-list">
          {(assistantToolsQuery.data?.tools ?? []).map((tool) => (
            <div className="compact-row" key={`${tool.moduleId}:${tool.name}`}>
              <span>{tool.name}</span>
              <strong>{tool.risk}</strong>
            </div>
          ))}
          {assistantToolsQuery.isLoading ? <p className="muted-text">Loading tools</p> : null}
          {assistantToolsQuery.error ? (
            <p className="form-error">{assistantToolsQuery.error.message}</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function CreateAiProviderForm(props: { readonly onCreated: () => Promise<void> }) {
  const [providerKind, setProviderKind] = useState<AiProviderKind>("openai-compatible");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialPayload, setCredentialPayload] = useState('{"apiKey":"placeholder"}');
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      createAiProvider({
        providerKind,
        displayName,
        baseUrl: baseUrl.trim() || null,
        credentialPayload: parseJsonObject(credentialPayload, "Credential JSON")
      }),
    onSuccess: async () => {
      setDisplayName("");
      setBaseUrl("");
      setCredentialPayload("{}");
      setFormError(null);
      await props.onCreated();
    },
    onError: (error) => setFormError(error.message)
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="ai-form" onSubmit={handleSubmit}>
      <label>
        Provider
        <select
          onChange={(event) => setProviderKind(event.target.value as AiProviderKind)}
          required
          value={providerKind}
        >
          {AI_PROVIDER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>

      <label>
        Display name
        <input
          onChange={(event) => setDisplayName(event.target.value)}
          required
          type="text"
          value={displayName}
        />
      </label>

      <label className="span-2">
        Base URL
        <input
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.test/v1"
          type="url"
          value={baseUrl}
        />
      </label>

      <label className="span-2">
        Credential JSON
        <textarea
          onChange={(event) => setCredentialPayload(event.target.value)}
          required
          rows={3}
          value={credentialPayload}
        />
      </label>

      {formError ? <p className="form-error span-2">{formError}</p> : null}

      <button className="primary-button span-2" disabled={createMutation.isPending} type="submit">
        {createMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        Add AI provider
      </button>
    </form>
  );
}

function CreateAiModelForm(props: {
  readonly providers: readonly AiProviderConfigDto[];
  readonly onCreated: () => Promise<void>;
}) {
  const availableProviders = useMemo(
    () => props.providers.filter((provider) => provider.status !== "revoked"),
    [props.providers]
  );
  const [providerConfigId, setProviderConfigId] = useState("");
  const [providerModelId, setProviderModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [capabilities, setCapabilities] = useState<readonly AiModelCapability[]>(["chat"]);
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      createAiModel({
        providerConfigId,
        providerModelId,
        displayName,
        capabilities
      }),
    onSuccess: async () => {
      setProviderModelId("");
      setDisplayName("");
      setCapabilities(["chat"]);
      setFormError(null);
      await props.onCreated();
    },
    onError: (error) => setFormError(error.message)
  });

  useEffect(() => {
    if (!providerConfigId && availableProviders[0]) {
      setProviderConfigId(availableProviders[0].id);
    }
  }, [availableProviders, providerConfigId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="ai-form" onSubmit={handleSubmit}>
      <label>
        Provider
        <select
          disabled={availableProviders.length === 0}
          onChange={(event) => setProviderConfigId(event.target.value)}
          required
          value={providerConfigId}
        >
          {availableProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.displayName}
            </option>
          ))}
        </select>
      </label>

      <label>
        Model id
        <input
          onChange={(event) => setProviderModelId(event.target.value)}
          placeholder="provider-model-id"
          required
          type="text"
          value={providerModelId}
        />
      </label>

      <label className="span-2">
        Display name
        <input
          onChange={(event) => setDisplayName(event.target.value)}
          required
          type="text"
          value={displayName}
        />
      </label>

      <fieldset className="checkbox-group span-2">
        <legend>Capabilities</legend>
        {AI_CAPABILITIES.map((capability) => (
          <label className="checkbox-row" key={capability}>
            <input
              checked={capabilities.includes(capability)}
              onChange={(event) => {
                setCapabilities((current) =>
                  event.target.checked
                    ? [...current, capability]
                    : current.filter((item) => item !== capability)
                );
              }}
              type="checkbox"
            />
            {capability}
          </label>
        ))}
      </fieldset>

      {formError ? <p className="form-error span-2">{formError}</p> : null}

      <button
        className="primary-button span-2"
        disabled={createMutation.isPending || availableProviders.length === 0}
        type="submit"
      >
        {createMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        Add model
      </button>
    </form>
  );
}

function AiProviderList(props: {
  readonly providers: readonly AiProviderConfigDto[];
  readonly isLoading: boolean;
  readonly error: Error | null;
}) {
  if (props.isLoading) {
    return <p className="muted-text">Loading AI providers</p>;
  }

  if (props.error) {
    return <p className="form-error">{props.error.message}</p>;
  }

  if (props.providers.length === 0) {
    return <p className="muted-text">No AI providers</p>;
  }

  return (
    <div className="ai-config-list">
      {props.providers.map((provider) => (
        <AiProviderRow key={provider.id} provider={provider} />
      ))}
    </div>
  );
}

function AiProviderRow(props: { readonly provider: AiProviderConfigDto }) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (status: Exclude<AiProviderStatus, "revoked">) =>
      updateAiProvider(props.provider.id, { status }),
    onSuccess: async () => invalidateAiQueries(queryClient)
  });
  const revokeMutation = useMutation({
    mutationFn: () => revokeAiProvider(props.provider.id),
    onSuccess: async () => invalidateAiQueries(queryClient)
  });
  const nextStatus = props.provider.status === "disabled" ? "active" : "disabled";

  return (
    <article className="ai-config-row">
      <div>
        <strong>{props.provider.displayName}</strong>
        <p>
          {props.provider.providerKind} - {props.provider.status} -{" "}
          {props.provider.hasCredential ? "credential stored" : "no credential"}
        </p>
        {props.provider.baseUrl ? <p>{props.provider.baseUrl}</p> : null}
      </div>
      <div className="connector-actions">
        {props.provider.status !== "revoked" ? (
          <>
            <button
              className="secondary-button"
              disabled={updateMutation.isPending}
              type="button"
              onClick={() => updateMutation.mutate(nextStatus)}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {nextStatus === "active" ? "Activate" : "Deactivate"}
            </button>
            <button
              className="secondary-button"
              disabled={revokeMutation.isPending}
              type="button"
              onClick={() => revokeMutation.mutate()}
            >
              <CircleOff size={16} aria-hidden="true" />
              Revoke
            </button>
          </>
        ) : (
          <span className="status-muted">Revoked</span>
        )}
      </div>
    </article>
  );
}

function AiModelList(props: {
  readonly models: readonly AiConfiguredModelDto[];
  readonly isLoading: boolean;
  readonly error: Error | null;
}) {
  if (props.isLoading) {
    return <p className="muted-text">Loading AI models</p>;
  }

  if (props.error) {
    return <p className="form-error">{props.error.message}</p>;
  }

  if (props.models.length === 0) {
    return <p className="muted-text">No AI models</p>;
  }

  return (
    <div className="ai-config-list">
      {props.models.map((model) => (
        <AiModelRow key={model.id} model={model} />
      ))}
    </div>
  );
}

function AiModelRow(props: { readonly model: AiConfiguredModelDto }) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (status: AiModelStatus) => updateAiModel(props.model.id, { status }),
    onSuccess: async () => invalidateAiQueries(queryClient)
  });
  const nextStatus = props.model.status === "disabled" ? "active" : "disabled";

  return (
    <article className="ai-config-row">
      <div>
        <strong>{props.model.displayName}</strong>
        <p>
          {props.model.providerDisplayName} - {props.model.providerModelId} - {props.model.status}
        </p>
        <p>{props.model.capabilities.join(", ")}</p>
      </div>
      <div className="connector-actions">
        <button
          className="secondary-button"
          disabled={updateMutation.isPending}
          type="button"
          onClick={() => updateMutation.mutate(nextStatus)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          {nextStatus === "active" ? "Activate" : "Deactivate"}
        </button>
      </div>
    </article>
  );
}

function CapabilityLookup() {
  const [capability, setCapability] = useState<AiModelCapability>("chat");
  const routeQuery = useQuery({
    queryKey: queryKeys.ai.capability(capability),
    queryFn: () => lookupAiCapabilityRoute(capability)
  });
  const route = routeQuery.data?.route;

  return (
    <div className="capability-lookup">
      <label>
        Capability
        <select
          onChange={(event) => setCapability(event.target.value as AiModelCapability)}
          value={capability}
        >
          {AI_CAPABILITIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <div className="capability-result">
        <KeyRound size={18} aria-hidden="true" />
        <span>
          {route?.model
            ? `${route.model.displayName} via ${route.model.providerDisplayName}`
            : routeQuery.isLoading
              ? "Checking"
              : "No active model"}
        </span>
      </div>
      {routeQuery.error ? <p className="form-error">{routeQuery.error.message}</p> : null}
    </div>
  );
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }

  return parsed as Record<string, unknown>;
}

async function invalidateAiQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
    queryClient.invalidateQueries({ queryKey: ["ai", "capability"] })
  ]);
}
