import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Globe,
  KeyRound,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  Unlink,
  X
} from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  createAiModel,
  createAiProvider,
  deleteWebSearchKey,
  discoverAiModels,
  getWebSearchKey,
  getCapabilityTierPreferences,
  getChatModelOverrideSettings,
  listAiModels,
  listAiProviders,
  lookupAiCapabilityRoute,
  patchCapabilityTierPreference,
  putAdminChatModelOverrideEnabled,
  putWebSearchKey,
  revokeAiProvider,
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
import { ChatLockGroup } from "./settings-ai-chat-lock-group";
import type {
  AiAuthMethod,
  AiConfiguredModelDto,
  AiDiscoverModelsItemDto,
  AiDiscoverModelsResponse,
  AiModelCapability,
  AiModelTier,
  AiProviderConfigDto,
  AiProviderExecutionMode,
  AiProviderKind
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
  summarization: "Summary"
};

const ALL_CAPABILITIES: readonly AiModelCapability[] = [
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
];

const TIERS: Record<AiModelTier, { label: string; hint: string }> = {
  reasoning: { label: "Reasoning", hint: "Deepest and slowest. Hard planning and judgment." },
  interactive: { label: "Interactive", hint: "Fast and balanced. The everyday default." },
  economy: { label: "Economy", hint: "Cheapest and quickest. Light, high-volume work." }
};

const MODEL_TIERS: readonly AiModelTier[] = ["reasoning", "interactive", "economy"];

const ROUTER_CAPABILITIES: readonly { k: AiModelCapability; name: string; desc: string }[] = [
  {
    k: "chat",
    name: "Chat & briefing",
    desc: "Everyday conversation and the daily reading voice."
  },
  {
    k: "tool-use",
    name: "Tool use",
    desc: "Calling tools — calendar, tasks, search — and acting."
  },
  {
    k: "json",
    name: "Structured output",
    desc: "Reliable JSON for commitments, parsing and extraction."
  },
  { k: "vision", name: "Vision", desc: "Reading screenshots, photos and scanned documents." },
  { k: "summarization", name: "Summarization", desc: "Condensing long threads, notes and context." }
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

function AddModelForm(props: { readonly providerConfigId: string; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [providerModelId, setProviderModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState<AiModelTier>("interactive");
  const [capabilities, setCapabilities] = useState<readonly AiModelCapability[]>(["chat"]);

  const createMutation = useMutation({
    mutationFn: () =>
      createAiModel({
        providerConfigId: props.providerConfigId,
        providerModelId,
        displayName,
        tier,
        capabilities
      }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Model added", { icon: <Sparkles size={17} /> });
      props.onClose();
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providerModelId.trim() || !displayName.trim()) return;
    createMutation.mutate();
  };

  return (
    <form className="ai-model-form" onSubmit={submit}>
      <Note icon={<Sparkles size={13} />}>
        Auto-detecting a provider's models on connect is coming. For now, register them here.
      </Note>
      <Field label="Model id">
        <input
          className="jds-input"
          value={providerModelId}
          onChange={(e) => setProviderModelId(e.target.value)}
          placeholder="provider-model-id"
          aria-label="Model id"
        />
      </Field>
      <Field label="Display name">
        <input
          className="jds-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Claude Sonnet"
          aria-label="Display name"
        />
      </Field>
      <Field label="Tier">
        <Segmented<AiModelTier>
          value={tier}
          options={MODEL_TIERS}
          ariaLabel="Model tier"
          onChange={setTier}
        />
      </Field>
      <div className="cap-list" aria-label="Model capabilities">
        {ALL_CAPABILITIES.map((capability) => (
          <label className="cap-list__item" key={capability}>
            <input
              type="checkbox"
              checked={capabilities.includes(capability)}
              onChange={(e) =>
                setCapabilities((cur) =>
                  e.target.checked ? [...cur, capability] : cur.filter((x) => x !== capability)
                )
              }
            />
            {CAP_SHORT[capability]}
          </label>
        ))}
      </div>
      <button
        type="submit"
        className="jds-btn jds-btn--primary jds-btn--sm"
        disabled={!providerModelId.trim() || !displayName.trim()}
      >
        <span className="jds-btn__icon">
          <Plus size={15} />
        </span>
        Add model
      </button>
    </form>
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
  readonly onRemove: () => void;
}) {
  const { provider } = props;
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [discovered, setDiscovered] = useState<AiDiscoverModelsResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const testMutation = useMutation({
    mutationFn: () => testAiProvider(provider.id),
    onSuccess: ({ result }) =>
      toast(result.message, {
        tone: result.ok ? "ready" : "drift",
        icon: <Activity size={17} />
      }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const discoverMutation = useMutation({
    mutationFn: () => discoverAiModels(provider.id),
    onSuccess: (response) => {
      setDiscovered(response);
      setSelectedIds(new Set());
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const addSelectedMutation = useMutation({
    mutationFn: (models: readonly AiDiscoverModelsItemDto[]) =>
      Promise.all(
        models.map((model) =>
          createAiModel({
            providerConfigId: provider.id,
            providerModelId: model.providerModelId,
            displayName: model.displayName,
            capabilities: model.capabilities,
            tier: model.tier
          })
        )
      ),
    onSuccess: () => {
      setSelectedIds(new Set());
      setDiscovered(null);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Models added", { icon: <Sparkles size={17} /> });
    },
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
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            <span className="jds-btn__icon">
              <Activity size={14} />
            </span>
            {testMutation.isPending ? "Testing" : "Test"}
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
          <div className="prov__acts">
            <button
              type="button"
              className="prov__sync"
              disabled={discoverMutation.isPending}
              onClick={() => discoverMutation.mutate()}
            >
              <RefreshCw size={12} aria-hidden="true" />
              {discoverMutation.isPending ? "Discovering" : discovered ? "Re-discover" : "Discover"}
            </button>
            <button type="button" className="prov__sync" onClick={() => setAddOpen((o) => !o)}>
              <Plus size={12} aria-hidden="true" />
              {addOpen ? "Close" : "Add"}
            </button>
          </div>
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
              No models registered yet — add one to bring this provider online.
            </div>
          )}
        </div>
        {discovered ? (
          <div className="prov__discover" aria-label="Discovered models">
            {discovered.fromFallback ? (
              <div className="prov__discover-warn">
                Could not reach the provider&apos;s model list — showing known models. Check your
                API key.
              </div>
            ) : null}
            <div className="prov__modellist">
              {discovered.models.map((model) => {
                const alreadyConfigured = props.models.some(
                  (m) => m.providerModelId === model.providerModelId
                );
                const isChecked = alreadyConfigured || selectedIds.has(model.providerModelId);
                return (
                  <label className="mdl mdl--discover" key={model.providerModelId}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={alreadyConfigured || addSelectedMutation.isPending}
                      onChange={(e) =>
                        setSelectedIds((cur) => {
                          const next = new Set(cur);
                          if (e.target.checked) next.add(model.providerModelId);
                          else next.delete(model.providerModelId);
                          return next;
                        })
                      }
                    />
                    <div className="mdl__id">{model.providerModelId}</div>
                    <span className={`tier tier--${model.tier}`}>{TIERS[model.tier].label}</span>
                    <div className="mdl__caps">
                      {model.capabilities.map((capability) => (
                        <span className="cap" key={capability}>
                          {CAP_SHORT[capability] ?? capability}
                        </span>
                      ))}
                    </div>
                  </label>
                );
              })}
            </div>
            {selectedIds.size > 0 ? (
              <button
                type="button"
                className="jds-btn jds-btn--primary jds-btn--sm"
                disabled={addSelectedMutation.isPending}
                onClick={() => {
                  const toAdd = discovered.models.filter((m) => selectedIds.has(m.providerModelId));
                  addSelectedMutation.mutate(toAdd);
                }}
              >
                <span className="jds-btn__icon">
                  <Plus size={15} />
                </span>
                {addSelectedMutation.isPending ? "Adding…" : `Add selected (${selectedIds.size})`}
              </button>
            ) : null}
          </div>
        ) : null}
        {addOpen ? (
          <AddModelForm providerConfigId={provider.id} onClose={() => setAddOpen(false)} />
        ) : null}
        {props.models.length ? (
          <div className="prov__synced">
            <RefreshCw size={11} aria-hidden="true" />
            Registered for {provider.displayName}.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Capability router */

function RouterRow(props: {
  readonly capability: { k: AiModelCapability; name: string; desc: string };
  readonly tierPreference: AiModelTier | undefined;
}) {
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const routeQuery = useQuery({
    queryKey: queryKeys.ai.capability(props.capability.k),
    queryFn: () => lookupAiCapabilityRoute(props.capability.k),
    retry: false
  });
  const tierMutation = useMutation({
    mutationFn: (tier: AiModelTier) =>
      patchCapabilityTierPreference({ capability: props.capability.k, tier }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.tierPreferences }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capability(props.capability.k) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Tier updated", { icon: <Sparkles size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const resolvedModel = routeQuery.data?.route?.model ?? null;
  const currentTier: AiModelTier = props.tierPreference ?? "interactive";

  return (
    <div className="rt">
      <div className="rt__main">
        <div className="rt__name">{props.capability.name}</div>
        <div className="rt__desc">{props.capability.desc}</div>
      </div>
      <div className="rt__pick">
        <Select
          value={currentTier}
          aria-label={`Tier for ${props.capability.name}`}
          disabled={tierMutation.isPending}
          onChange={(event) => tierMutation.mutate(event.target.value as AiModelTier)}
        >
          {MODEL_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {TIERS[tier].label}
            </option>
          ))}
        </Select>
        {resolvedModel ? (
          <div className="rt__resolved">{resolvedModel.providerModelId}</div>
        ) : (
          <span className="rt__none">
            <MinusCircle size={13} aria-hidden="true" />
            No model for this tier
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Web search */

function WebSearchKeyGroup() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [apiKey, setApiKey] = useState("");

  const statusQuery = useQuery({
    queryKey: queryKeys.ai.webSearchKey,
    queryFn: getWebSearchKey,
    retry: false
  });
  const status = statusQuery.data?.status;
  const configured = status?.configured ?? false;
  const fromEnv = status?.source === "env";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.webSearchKey });

  const saveMutation = useMutation({
    mutationFn: (key: string) => putWebSearchKey({ apiKey: key }),
    onSuccess: () => {
      setApiKey("");
      void invalidate();
      toast("Web search key saved", { icon: <Globe size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const revokeMutation = useMutation({
    mutationFn: () => deleteWebSearchKey(),
    onSuccess: () => {
      void invalidate();
      toast("Web search key removed", { tone: "drift", icon: <Trash2 size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  return (
    <Group
      title="Web search"
      desc="Jarvis searches the live web through Brave Search. Add an instance-wide API key to turn it on for everyone."
    >
      <Field
        label="Brave Search API key"
        hint="Stored encrypted. Never shown in chat, briefings or logs."
      >
        <input
          className="jds-input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={configured ? "•••••••• (stored)" : "BSA…"}
          aria-label="Brave Search API key"
        />
        <button
          type="button"
          className="jds-btn jds-btn--secondary jds-btn--sm"
          disabled={!apiKey.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate(apiKey.trim())}
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </button>
        {configured && !fromEnv ? (
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            disabled={revokeMutation.isPending}
            onClick={() =>
              confirm({
                title: "Remove web search key?",
                description: "Jarvis stops searching the web until a new key is added.",
                confirmLabel: "Remove",
                danger: true,
                onConfirm: () => revokeMutation.mutate()
              })
            }
          >
            Revoke
          </button>
        ) : null}
      </Field>
      <Note icon={<Globe size={13} />}>
        {fromEnv ? (
          <>
            Using a key from the <code>JARVIS_BRAVE_SEARCH_API_KEY</code> environment variable.
            Saving a key here overrides it; the env key can&apos;t be revoked from this screen.
          </>
        ) : configured ? (
          <>Web search is on. Get or manage keys at the Brave Search API dashboard.</>
        ) : (
          <>
            Web search is off until a key is added. Get one at{" "}
            <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer">
              brave.com/search/api
            </a>
            .
          </>
        )}
      </Note>
    </Group>
  );
}

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
  const tierPrefsQuery = useQuery({
    queryKey: queryKeys.ai.tierPreferences,
    queryFn: getCapabilityTierPreferences,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.tierPreferences }),
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
    ]);

  const createMutation = useMutation({
    mutationFn: (option: { label: string; kind: AiProviderKind }) =>
      createAiProvider({ providerKind: option.kind, displayName: option.label, authMethod: "cli" }),
    onSuccess: (_data, option) => {
      setPick(false);
      void invalidate();
      toast(`Added ${option.label}`, { icon: <Sparkles size={17} /> });
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
      toast("Chat override setting updated", { icon: <Sparkles size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const modelOverrideMutation = useMutation({
    mutationFn: (input: { model: AiConfiguredModelDto; allowed: boolean }) =>
      updateAiModel(input.model.id, { allowUserOverride: input.allowed }),
    onSuccess: (_data, input) => {
      void invalidate();
      toast(`${input.model.displayName} override access updated`, {
        icon: <Sparkles size={17} />
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
        desc="Add provider accounts for the whole instance. Jarvis reads each one's models — registered here until auto-detect on connect lands."
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
              <Sparkles size={20} aria-hidden="true" />
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
              Jarvis will read the available models from the provider once auto-detect lands — for
              now, register them on the provider card.
            </div>
          </div>
        ) : null}
      </Group>

      {providers.length ? (
        <Group
          title="Capability routing"
          desc="Send each kind of work to the model that's best for it — the right tool for the job, instead of one model for everything. This applies instance-wide."
        >
          {ROUTER_CAPABILITIES.map((capability) => (
            <RouterRow
              key={capability.k}
              capability={capability}
              tierPreference={tierPrefsQuery.data?.preferences[capability.k]}
            />
          ))}
        </Group>
      ) : null}
      <ChatLockGroup />
      <EmbeddingConfigGroup />
      <WebSearchKeyGroup />
      <Note icon={<Sparkles size={13} />}>
        Each person can override which model powers their own chat under{" "}
        <b>Personal → Assistant &amp; AI</b>. Everything else follows the routing above.
      </Note>
    </>
  );
}
