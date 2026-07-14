import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  KeyRound,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  GitCommitHorizontal,
  Terminal,
  Trash2,
  Unlink,
  X
} from "lucide-react";
import { useState } from "react";

import {
  createAiProvider,
  getChatModelOverrideSettings,
  listAiModels,
  listAiProviders,
  listAiServiceBindings,
  lookupAiCapabilityRoute,
  putAdminChatModelOverrideEnabled,
  putAiServiceBinding,
  revokeAiProvider,
  setInstanceDefaultProvider,
  testAiProvider,
  updateAiModel,
  updateAiProvider
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { EmbeddingConfigGroup } from "./settings-embedding-config-group";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Badge, Field, Group, Note, PaneHead, Row, Segmented, Select, Switch } from "./settings-ui";
import { EditModelForm } from "./settings-ai-edit-model-form";
import { TerminalModal } from "./terminal-modal";
import { ChatLockGroup } from "./settings-ai-chat-lock-group";
import { YoloAdminGroup } from "./settings-yolo-admin-group";
import { WebSearchKeyGroup } from "./settings-web-search-key-group";
import { VoiceConfigGroup } from "./settings-voice-config-group";
import {
  type AiAuthMethod,
  type AiConfiguredModelDto,
  type AiModelCapability,
  type AiModelTier,
  type AiProviderConfigDto,
  type AiProviderExecutionMode,
  type AiProviderKind,
  type AiServiceBinding
} from "@jarv1s/shared";

const PROVIDER_CATALOG: readonly { readonly label: string; readonly kind: AiProviderKind }[] = [
  { label: "Anthropic", kind: "anthropic" },
  { label: "OpenAI", kind: "openai-compatible" },
  { label: "Google", kind: "google" },
  { label: "Mistral", kind: "openai-compatible" },
  { label: "Local (Ollama)", kind: "ollama" },
  { label: "OpenAI-compatible", kind: "openai-compatible" }
];

const CAP_SHORT: Record<AiModelCapability, string> = {
  chat: "Chat",
  "tool-use": "Tools",
  json: "JSON",
  vision: "Vision",
  summarization: "Summary",
  transcription: "Voice"
};

const TIERS: Record<AiModelTier, { label: string; hint: string }> = {
  reasoning: { label: "Reasoning", hint: "Deepest and slowest. Hard planning and judgment." },
  interactive: { label: "Interactive", hint: "Fast and balanced. The everyday default." },
  economy: { label: "Economy", hint: "Cheapest and quickest. Light, high-volume work." }
};

const MODEL_TIERS: readonly AiModelTier[] = ["reasoning", "interactive", "economy"];

// #870 Slice 1 / #874 HIGH-2: Chat is the only bindable user-facing service here. Voice (STT) moved
// to its own dedicated endpoint (see VoiceConfigGroup) and is NO longer a per-service binding.
// Worker capabilities (tool-use / json / vision / summarization) stay cross-provider automatic and
// are not surfaced as knobs; embeddings are out of scope (M3). Chat binds to EITHER a "mode" (a tier
// resolved inside the instance-default provider) OR a specific model.
const SERVICE_ROWS: readonly { k: AiModelCapability; name: string; desc: string }[] = [
  {
    k: "chat",
    name: "Chat & briefing",
    desc: "Everyday conversation and the daily reading voice."
  }
];

/* ----------------------------------------------------------- Provider card */

function ModelLine(props: {
  readonly model: AiConfiguredModelDto;
  readonly isEditing: boolean;
  readonly onEdit: () => void;
  readonly onOverrideChange: (model: AiConfiguredModelDto, allowed: boolean) => void;
  readonly onStatusChange: (model: AiConfiguredModelDto, status: "active" | "disabled") => void;
}) {
  const { model } = props;
  const tier = TIERS[model.tier];
  const isChatModel = model.capabilities.includes("chat");
  const isDisabled = model.status === "disabled";
  return (
    <div className={`mdl${isDisabled ? " mdl--disabled" : ""}`}>
      <div className="mdl__id">
        {model.providerModelId}
        {isDisabled ? <span className="mdl__off">off</span> : null}
      </div>
      <span className={`tier tier--${model.tier}`} title={tier.hint}>
        {tier.label}
      </span>
      <div className="mdl__caps">
        {model.capabilities.map((c) => (
          <span className="cap" key={c}>
            {CAP_SHORT[c] ?? c}
          </span>
        ))}
      </div>
      {isChatModel ? (
        <Switch
          ariaLabel={`${model.displayName} available for user chat override`}
          checked={model.allowUserOverride}
          onChange={(allowed) => props.onOverrideChange(model, allowed)}
        />
      ) : null}
      <button
        type="button"
        className={`mdl__edit-btn${props.isEditing ? " is-active" : ""}`}
        title="Edit model"
        aria-label={`Edit ${model.displayName}`}
        onClick={props.onEdit}
      >
        <Pencil size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mdl__toggle-btn"
        title={isDisabled ? "Enable model" : "Disable model"}
        aria-label={isDisabled ? `Enable ${model.displayName}` : `Disable ${model.displayName}`}
        onClick={() => props.onStatusChange(model, isDisabled ? "active" : "disabled")}
      >
        <MinusCircle size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

function ProviderCard(props: {
  readonly provider: AiProviderConfigDto;
  readonly models: readonly AiConfiguredModelDto[];
  readonly editing: boolean;
  readonly onEdit: (id: string | null) => void;
  readonly onAuth: (id: string, method: AiAuthMethod) => void;
  readonly onExecutionMode: (id: string, executionMode: AiProviderExecutionMode) => void;
  readonly onCredential: (id: string, input: { baseUrl: string; apiKey: string }) => void;
  readonly onModelOverride: (model: AiConfiguredModelDto, allowed: boolean) => void;
  readonly onModelStatusChange: (
    model: AiConfiguredModelDto,
    status: "active" | "disabled"
  ) => void;
  // #870/H1 Slice 1: instance-default flag + setter. The default provider is the one that resolves
  // the model for every mode-bound service; exactly one provider carries it instance-wide.
  readonly isInstanceDefault: boolean;
  readonly onSetInstanceDefault: () => void;
  readonly onRemove: () => void;
}) {
  const { provider } = props;
  const { toast } = useFeedback();
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  // #1059 — a CLI-auth provider has no API key to credential-test; its Test action opens
  // a live owner-gated terminal onto the CLI instead of calling testMutation.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const testMutation = useMutation({
    mutationFn: () => testAiProvider(provider.id),
    onSuccess: ({ result }) =>
      toast(result.message, {
        tone: result.ok ? "ready" : "drift",
        icon: <Activity size={17} />
      }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  return (
    <div className="prov">
      <div className="prov__head">
        <span className="prov__mark">{provider.displayName[0]?.toUpperCase()}</span>
        <div className="prov__id">
          <div className="prov__name">
            {provider.displayName}
            <Badge tone="pine" dot>
              Connected
            </Badge>
            {/* #870/H1: one provider is the instance default that feeds mode-bound services. */}
            {props.isInstanceDefault ? (
              <Badge tone="amber" dot>
                Default
              </Badge>
            ) : (
              <button
                type="button"
                className="jds-btn jds-btn--quiet jds-btn--sm"
                onClick={props.onSetInstanceDefault}
              >
                Set as default
              </button>
            )}
          </div>
          <div className="prov__auth">
            {provider.authMethod === "cli" ? (
              <Terminal size={12} aria-hidden="true" />
            ) : (
              <KeyRound size={12} aria-hidden="true" />
            )}
            {provider.authMethod === "cli"
              ? `${provider.displayName} CLI`
              : provider.hasCredential
                ? "API key stored"
                : "No credential"}
          </div>
        </div>
        <div className="prov__acts">
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            disabled={provider.authMethod === "cli" ? false : testMutation.isPending}
            onClick={() =>
              provider.authMethod === "cli" ? setTerminalOpen(true) : testMutation.mutate()
            }
          >
            <span className="jds-btn__icon">
              {provider.authMethod === "cli" ? <Terminal size={14} /> : <Activity size={14} />}
            </span>
            {provider.authMethod === "cli" ? "Terminal" : testMutation.isPending ? "Testing" : "Test"}
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={() => props.onEdit(props.editing ? null : provider.id)}
          >
            {props.editing ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            className="jds-iconbtn jds-iconbtn--sm"
            aria-label={`Remove ${provider.displayName}`}
            onClick={props.onRemove}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {props.editing ? (
        <div className="prov__edit">
          <Field
            label="Authentication"
            hint="CLI uses an existing subscription — no key to manage. API key bills usage directly to the provider."
          >
            <Segmented<AiAuthMethod>
              value={provider.authMethod}
              options={[
                { value: "cli", label: "CLI subscription" },
                { value: "api_key", label: "API key" }
              ]}
              ariaLabel="Authentication method"
              onChange={(v) => props.onAuth(provider.id, v)}
            />
          </Field>
          <Field label="Execution mode">
            <Segmented<AiProviderExecutionMode>
              value={provider.executionMode}
              options={[
                { value: "interactive", label: "Interactive" },
                { value: "non_interactive", label: "Non-interactive" }
              ]}
              ariaLabel="Execution mode"
              onChange={(v) => props.onExecutionMode(provider.id, v)}
            />
          </Field>
          {provider.authMethod === "cli" ? (
            <div className="provcfg__cli">
              <span className="provcfg__cli-ic">
                <Terminal size={16} aria-hidden="true" />
              </span>
              <div className="provcfg__cli-main">
                <div className="provcfg__cli-t">Signed in via the {provider.displayName} CLI</div>
                <div className="provcfg__cli-d">
                  Routes through your authenticated subscription. No key stored.
                </div>
              </div>
              <button
                type="button"
                className="jds-btn jds-btn--quiet jds-btn--sm"
                onClick={() =>
                  toast(`Re-authenticated with the ${provider.displayName} CLI`, {
                    icon: <Terminal size={17} />
                  })
                }
              >
                Re-authenticate
              </button>
            </div>
          ) : (
            <>
              <Field label="Base URL" hint="Leave blank to use the provider's default endpoint.">
                <input
                  className="jds-input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  aria-label="Base URL"
                />
              </Field>
              <Field label="API key" hint="Stored encrypted. Never shown in briefings or logs.">
                <input
                  className="jds-input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.hasCredential ? "•••••••• (stored)" : "sk-…"}
                  aria-label="API key"
                />
                <button
                  type="button"
                  className="jds-btn jds-btn--secondary jds-btn--sm"
                  disabled={!apiKey.trim() && !baseUrl.trim()}
                  onClick={() => {
                    props.onCredential(provider.id, {
                      baseUrl: baseUrl.trim(),
                      apiKey: apiKey.trim()
                    });
                    setApiKey("");
                  }}
                >
                  Save
                </button>
              </Field>
            </>
          )}
        </div>
      ) : null}

      <div className="prov__models">
        <div className="prov__modelshd">
          <span>Models · {props.models.length}</span>
        </div>
        <div className="prov__modellist">
          {props.models.length ? (
            props.models.map((m) => (
              <div key={m.id}>
                <ModelLine
                  model={m}
                  isEditing={editingModelId === m.id}
                  onEdit={() => setEditingModelId((cur) => (cur === m.id ? null : m.id))}
                  onOverrideChange={props.onModelOverride}
                  onStatusChange={props.onModelStatusChange}
                />
                {editingModelId === m.id ? (
                  <EditModelForm model={m} onClose={() => setEditingModelId(null)} />
                ) : null}
              </div>
            ))
          ) : (
            <div className="prov__synced" style={{ marginTop: 0 }}>
              Models appear here automatically when the provider connects.
            </div>
          )}
        </div>
        {/* #982/#869 Lane B: discovery is automatic; manual REST escape hatches remain server-side. */}
        {props.models.length ? (
          <div className="prov__synced">
            <RefreshCw size={11} aria-hidden="true" />
            Registered for {provider.displayName}.
          </div>
        ) : null}
      </div>
      {/* #1059 — rendered outside .prov__edit so opening the terminal never depends on the
          card's edit-mode toggle; ProviderCard already destructures `provider` at the top. */}
      {terminalOpen ? (
        <TerminalModal provider={provider} onClose={() => setTerminalOpen(false)} />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- Service bindings */

// #870 Slice 1: one row per user-facing service (Chat / Voice). A binding is either a "mode" (tier,
// resolved inside the instance-default provider) or a specific model. The row shows the resolved
// model id — or an explicit "needs configuration" prompt when the resolver returns `needs-config`.
function ServiceRow(props: {
  readonly service: { k: AiModelCapability; name: string; desc: string };
  readonly binding: AiServiceBinding | undefined;
  readonly models: readonly AiConfiguredModelDto[];
}) {
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const routeQuery = useQuery({
    queryKey: queryKeys.ai.capability(props.service.k),
    queryFn: () => lookupAiCapabilityRoute(props.service.k),
    retry: false
  });

  const mutation = useMutation({
    mutationFn: (binding: AiServiceBinding) => putAiServiceBinding(props.service.k, { binding }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.serviceBindings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capability(props.service.k) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Service updated", { icon: <GitCommitHorizontal size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  // Active models that can actually serve this service (a "model" binding must be capability-valid).
  const capableModels = props.models.filter(
    (model) =>
      model.status === "active" &&
      model.providerStatus === "active" &&
      model.capabilities.includes(props.service.k)
  );

  // The <select> value encodes the binding kind: `mode:<tier>` or `model:<id>`.
  const binding = props.binding;
  const currentValue =
    binding?.kind === "model"
      ? `model:${binding.modelId}`
      : `mode:${binding?.tier ?? "interactive"}`;

  const onChange = (raw: string) => {
    if (raw.startsWith("model:")) {
      mutation.mutate({ kind: "model", modelId: raw.slice("model:".length) });
    } else {
      mutation.mutate({ kind: "mode", tier: raw.slice("mode:".length) as AiModelTier });
    }
  };

  const route = routeQuery.data?.route;
  const needsConfig = route ? route.reason === "needs-config" : false;
  const resolvedModel = route?.model ?? null;

  return (
    <div className="rt">
      <div className="rt__main">
        <div className="rt__name">{props.service.name}</div>
        <div className="rt__desc">{props.service.desc}</div>
      </div>
      <div className="rt__pick">
        <Select
          value={currentValue}
          aria-label={`Binding for ${props.service.name}`}
          disabled={mutation.isPending}
          onChange={(event) => onChange(event.target.value)}
        >
          <optgroup label="Mode (uses the default provider)">
            {MODEL_TIERS.map((tier) => (
              <option key={tier} value={`mode:${tier}`}>
                {TIERS[tier].label}
              </option>
            ))}
          </optgroup>
          {capableModels.length ? (
            <optgroup label="Specific model">
              {capableModels.map((model) => (
                <option key={model.id} value={`model:${model.id}`}>
                  {model.displayName}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
        {needsConfig ? (
          <span className="rt__none">
            <MinusCircle size={13} aria-hidden="true" />
            Needs configuration
          </span>
        ) : resolvedModel ? (
          <div className="rt__resolved">{resolvedModel.providerModelId}</div>
        ) : (
          <span className="rt__none">
            <MinusCircle size={13} aria-hidden="true" />
            No model resolved
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Web search */

/* ----------------------------------------------------------------- Pane */

export function AiProvidersPane() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [pick, setPick] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: listAiProviders,
    retry: false
  });
  const modelsQuery = useQuery({
    queryKey: queryKeys.ai.models,
    queryFn: listAiModels,
    retry: false
  });
  const serviceBindingsQuery = useQuery({
    queryKey: queryKeys.ai.serviceBindings,
    queryFn: listAiServiceBindings,
    retry: false
  });
  const overrideQuery = useQuery({
    queryKey: queryKeys.ai.chatModelOverride,
    queryFn: getChatModelOverrideSettings,
    retry: false
  });
  const providers = (providersQuery.data?.providers ?? []).filter((p) => p.status !== "revoked");
  const models = modelsQuery.data?.models ?? [];
  const connected = providers.map((p) => p.displayName);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.chatModelOverride }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.serviceBindings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
    ]);

  const createMutation = useMutation({
    mutationFn: (option: { label: string; kind: AiProviderKind }) =>
      createAiProvider({ providerKind: option.kind, displayName: option.label, authMethod: "cli" }),
    onSuccess: (_data, option) => {
      setPick(false);
      void invalidate();
      toast(`Added ${option.label}`, { icon: <GitCommitHorizontal size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift", icon: <X size={17} /> })
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeAiProvider(id),
    onSuccess: () => {
      setEditId(null);
      void invalidate();
      toast("Provider removed", { tone: "drift", icon: <Unlink size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const updateMutation = useMutation({
    mutationFn: (input: {
      id: string;
      patch: Parameters<typeof updateAiProvider>[1];
      message?: string;
    }) => updateAiProvider(input.id, input.patch),
    onSuccess: (_data, input) => {
      void invalidate();
      if (input.message) toast(input.message, { icon: <KeyRound size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const overrideToggleMutation = useMutation({
    mutationFn: (enabled: boolean) => putAdminChatModelOverrideEnabled({ enabled }),
    onSuccess: () => {
      void invalidate();
      toast("Chat override setting updated", { icon: <GitCommitHorizontal size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const modelOverrideMutation = useMutation({
    mutationFn: (input: { model: AiConfiguredModelDto; allowed: boolean }) =>
      updateAiModel(input.model.id, { allowUserOverride: input.allowed }),
    onSuccess: (_data, input) => {
      void invalidate();
      toast(`${input.model.displayName} override access updated`, {
        icon: <GitCommitHorizontal size={17} />
      });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const modelStatusMutation = useMutation({
    mutationFn: (input: { model: AiConfiguredModelDto; status: "active" | "disabled" }) =>
      updateAiModel(input.model.id, { status: input.status }),
    onSuccess: (_data, input) => {
      void invalidate();
      const label = input.status === "disabled" ? "Model disabled" : "Model enabled";
      toast(label, { icon: <MinusCircle size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  // #870/H1 Slice 1: the instance-default provider supplies the model for every mode-bound service
  // (Chat/Voice on a tier). Exactly one provider holds the flag instance-wide — the backend clears
  // any prior default in the same statement (partial unique index enforces the singleton), so the
  // UI just fires the set and re-reads.
  const instanceDefaultMutation = useMutation({
    mutationFn: (providerId: string) => setInstanceDefaultProvider(providerId),
    onSuccess: () => {
      void invalidate();
      toast("Default provider updated", { icon: <GitCommitHorizontal size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  return (
    <>
      <PaneHead
        title="Assistant & AI"
        desc="The AI providers this instance runs on, and which model handles each kind of work. Everyone's Jarvis draws from what you set up here."
      />
      <Group
        title="User chat override"
        desc="Let each person choose which allowed chat-capable model answers their own conversations."
      >
        <Row
          name="Allow user override"
          desc="When off, Personal → Assistant & AI shows the instance default as read-only."
          control={
            <Switch
              ariaLabel="Allow users to override their chat model"
              checked={overrideQuery.data?.settings.overrideEnabled ?? false}
              disabled={overrideQuery.isLoading || overrideToggleMutation.isPending}
              onChange={(enabled) => overrideToggleMutation.mutate(enabled)}
            />
          }
        />
      </Group>
      <Group
        title="Providers"
        desc="Add provider accounts for the whole instance. Jarvis reads each one's models automatically the moment it connects."
        action={
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => setPick((x) => !x)}
          >
            <span className="jds-btn__icon">
              <Plus size={15} />
            </span>
            Add provider
          </button>
        }
      >
        {providers.length === 0 ? (
          <div className="ai-empty">
            <div className="ai-empty__ic">
              <GitCommitHorizontal size={20} aria-hidden="true" />
            </div>
            <div className="ai-empty__main">
              <div className="ai-empty__t">No providers yet</div>
              <div className="ai-empty__d">
                Jarvis can't chat until at least one provider is added. Connect one to bring its
                models online for everyone on this instance.
              </div>
            </div>
          </div>
        ) : (
          <div className="prov-list">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                models={models.filter((m) => m.providerConfigId === provider.id)}
                editing={editId === provider.id}
                onEdit={setEditId}
                onAuth={(id, method) =>
                  updateMutation.mutate({ id, patch: { authMethod: method } })
                }
                onExecutionMode={(id, executionMode) =>
                  updateMutation.mutate({ id, patch: { executionMode } })
                }
                onCredential={(id, { baseUrl, apiKey }) =>
                  updateMutation.mutate({
                    id,
                    patch: {
                      baseUrl: baseUrl || null,
                      ...(apiKey ? { credentialPayload: { apiKey } } : {})
                    },
                    message: `Credentials updated for ${provider.displayName}`
                  })
                }
                onModelOverride={(model, allowed) =>
                  modelOverrideMutation.mutate({ model, allowed })
                }
                onModelStatusChange={(model, status) =>
                  modelStatusMutation.mutate({ model, status })
                }
                isInstanceDefault={provider.isInstanceDefault}
                onSetInstanceDefault={() => instanceDefaultMutation.mutate(provider.id)}
                onRemove={() =>
                  confirm({
                    title: `Remove ${provider.displayName}?`,
                    description:
                      "Jarvis stops using its models. Any work routed to them falls back to another added model.",
                    confirmLabel: "Remove",
                    danger: true,
                    onConfirm: () => revokeMutation.mutate(provider.id)
                  })
                }
              />
            ))}
          </div>
        )}
        {pick ? (
          <div className="provpick">
            <div className="provpick__hd">Add a provider</div>
            <div className="provpick__grid">
              {PROVIDER_CATALOG.map((option) => {
                const has = connected.includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    className="provpick__item"
                    disabled={has}
                    onClick={() => createMutation.mutate(option)}
                  >
                    <span className="provpick__dot" />
                    {option.label}
                    {has ? <span className="provpick__on">Added</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="provpick__foot">
              Jarvis reads the available models from the provider automatically when it connects.
            </div>
          </div>
        ) : null}
      </Group>

      {providers.length ? (
        <Group
          title="Services"
          desc="Bind each person-facing service to a mode (the default provider picks the model for that tier) or to a specific model. Everything else — tools, structured output, vision, summaries — is routed automatically."
        >
          {SERVICE_ROWS.map((service) => (
            <ServiceRow
              key={service.k}
              service={service}
              binding={serviceBindingsQuery.data?.bindings[service.k]}
              models={models}
            />
          ))}
        </Group>
      ) : null}
      {/* #874: Voice (STT) is its own dedicated admin section, independent of the chat providers. */}
      <VoiceConfigGroup />
      <ChatLockGroup />
      <EmbeddingConfigGroup />
      <WebSearchKeyGroup />
      <YoloAdminGroup />
      <Note icon={<GitCommitHorizontal size={13} />}>
        Each person can override which model powers their own chat under{" "}
        <b>Personal → Assistant &amp; AI</b>. Everything else follows the services above.
      </Note>
    </>
  );
}
