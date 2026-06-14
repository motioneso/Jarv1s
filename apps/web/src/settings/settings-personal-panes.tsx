import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2, Sparkles, Terminal, X } from "lucide-react";
import { useState, type ComponentType } from "react";

import {
  createAiProvider,
  getMemoryFacts,
  getMemorySettings,
  listAiModels,
  listAiProviders,
  patchMemorySettings,
  revokeAiProvider,
  updateAiProvider,
  type MemorySettings
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import {
  ConnectedPane,
  GeneralPane,
  ModulesPane,
  SourcesPane
} from "./settings-personal-data-panes";
import { readError, type PaneProps } from "./settings-types";
import {
  Avatar,
  Badge,
  Choice,
  Field,
  Group,
  Note,
  PaneHead,
  Row,
  Segmented,
  Switch
} from "./settings-ui";
import type {
  AiAuthMethod,
  AiConfiguredModelDto,
  AiProviderConfigDto,
  AiProviderKind
} from "@jarv1s/shared";

/* ------------------------------------------------------------- Profile */

function ProfilePane({ me }: PaneProps) {
  const user = me.user;
  const role = user.isBootstrapOwner ? "Owner" : user.isInstanceAdmin ? "Admin" : "Member";
  const firstName = (user.name ?? "").split(/\s+/)[0] ?? "";
  return (
    <>
      <PaneHead
        title="Profile & account"
        desc="Who you are to Jarvis — your identity and account status. How Jarvis sounds and behaves lives in Assistant & AI."
      />
      <Group title="Identity">
        <div className="prof">
          <Avatar name={user.name || user.email} size="lg" />
          <div className="prof__main">
            <div className="prof__name">{user.name || "Unnamed"}</div>
            <div className="prof__email">{user.email}</div>
          </div>
          <div className="prof__badges">
            <Badge tone="pine" dot>
              {user.status === "active" ? "Active" : user.status}
            </Badge>
            <Badge tone="neutral">{role}</Badge>
          </div>
        </div>
        <Field label="Display name">
          <input className="jds-input" defaultValue={user.name} aria-label="Display name" />
        </Field>
        <Field label="How Jarvis addresses you" hint="Used in the briefing and throughout the day.">
          <input
            className="jds-input"
            defaultValue={firstName}
            aria-label="How Jarvis addresses you"
          />
        </Field>
      </Group>

      <Group title="Account">
        <Row
          name="Email"
          desc={user.email}
          control={
            <Badge tone="pine" dot>
              Verified
            </Badge>
          }
        />
        <Row
          name="Role"
          desc={
            role === "Owner"
              ? "Owner — full access to admin & setup."
              : role === "Admin"
                ? "Admin — instance administration."
                : "Member of this instance."
          }
          control={<Badge tone="neutral">{role}</Badge>}
        />
        <Row name="Active sessions" desc="Devices currently signed in to your account." coming />
        <Row name="Export my data" desc="Download everything Jarvis holds about you." coming />
        <Row name="Security" desc="Password and two-factor authentication." coming />
      </Group>

      <Group title="Danger zone">
        <Row
          name="Delete account"
          desc="Permanently remove your account and personal data."
          coming
        />
      </Group>
    </>
  );
}

/* --------------------------------------------------------- Assistant & AI */

const PROVIDER_OPTIONS: readonly { readonly label: string; readonly kind: AiProviderKind }[] = [
  { label: "Anthropic", kind: "anthropic" },
  { label: "OpenAI", kind: "openai-compatible" },
  { label: "Google", kind: "google" },
  { label: "Mistral", kind: "openai-compatible" },
  { label: "Local (Ollama)", kind: "ollama" },
  { label: "OpenAI-compatible", kind: "openai-compatible" }
];

function ProviderPicker(props: {
  readonly onChoose: (option: { label: string; kind: AiProviderKind }) => void;
}) {
  return (
    <div className="provpick">
      <div className="provpick__hd">Choose a provider</div>
      <div className="provpick__grid">
        {PROVIDER_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            className="provpick__item"
            onClick={() => props.onChoose(option)}
          >
            <span className="provpick__dot" />
            {option.label}
          </button>
        ))}
      </div>
      <div className="provpick__foot">
        Jarvis routes through this provider once you add your credentials below.
      </div>
    </div>
  );
}

function ProviderConfig(props: {
  readonly provider: AiProviderConfigDto;
  readonly models: readonly AiConfiguredModelDto[];
  readonly onAuth: (method: AiAuthMethod) => void;
}) {
  const { provider } = props;
  const model = props.models.find((item) => item.providerConfigId === provider.id);
  return (
    <div className="provcfg">
      <div className="provcfg__name">
        <span className="provcfg__mark">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        {provider.displayName}
        <Badge tone="pine" dot>
          Connected
        </Badge>
      </div>

      <Field
        label="Authentication"
        hint="CLI uses your existing subscription — no key to manage. Switch to API key only if you'd rather bill usage directly."
      >
        <Segmented<AiAuthMethod>
          value={provider.authMethod}
          options={[
            { value: "cli", label: "CLI subscription" },
            { value: "api_key", label: "API key" }
          ]}
          ariaLabel="Authentication method"
          onChange={props.onAuth}
        />
      </Field>

      {provider.authMethod === "cli" ? (
        <div className="provcfg__cli">
          <span className="provcfg__cli-ic">
            <Terminal size={16} aria-hidden="true" />
          </span>
          <div className="provcfg__cli-main">
            <div className="provcfg__cli-t">
              Signed in via the {provider.displayName} CLI{" "}
              {provider.cliAvailable ? (
                <Badge tone="pine" dot>
                  Available
                </Badge>
              ) : (
                <Badge tone="amber" dot>
                  Not detected
                </Badge>
              )}
            </div>
            <div className="provcfg__cli-d">
              Routes through your authenticated CLI subscription. No API key needed.
            </div>
          </div>
        </div>
      ) : (
        <>
          <Field label="Base URL">
            <input
              className="jds-input"
              defaultValue={provider.baseUrl ?? "https://api.anthropic.com"}
              aria-label="Base URL"
            />
          </Field>
          <Field label="API key" hint="Stored encrypted. Never shown in briefings or logs.">
            <input
              className="jds-input"
              type="password"
              defaultValue={provider.hasCredential ? "••••••••••••" : ""}
              placeholder="sk-…"
              aria-label="API key"
            />
          </Field>
        </>
      )}

      <Field label="Model" hint="The model Jarvis uses for chat, the briefing, and reasoning.">
        <input
          className="jds-input"
          defaultValue={model?.providerModelId ?? ""}
          placeholder="claude-sonnet-4"
          aria-label="Model"
        />
      </Field>
    </div>
  );
}

function AdvancedAiSource() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [pick, setPick] = useState(false);
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
  const providers = (providersQuery.data?.providers ?? []).filter(
    (item) => item.status !== "revoked"
  );
  const provider = providers[0] ?? null;

  const createMutation = useMutation({
    mutationFn: (option: { label: string; kind: AiProviderKind }) =>
      createAiProvider({ providerKind: option.kind, displayName: option.label, authMethod: "cli" }),
    onSuccess: (_data, option) => {
      setPick(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      toast(`Added ${option.label}`, { icon: <Sparkles size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift", icon: <X size={17} /> })
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeAiProvider(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      toast("Provider removed", { tone: "drift", icon: <X size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const authMutation = useMutation({
    mutationFn: (input: { id: string; authMethod: AiAuthMethod }) =>
      updateAiProvider(input.id, { authMethod: input.authMethod }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers }),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  return (
    <Group
      title="AI source"
      desc="Use the shared assistant, or bring your own provider."
      action={
        provider ? (
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={() =>
              confirm({
                title: `Remove ${provider.displayName}?`,
                description: "Jarvis falls back to the shared assistant on this instance.",
                confirmLabel: "Remove",
                danger: true,
                onConfirm: () => revokeMutation.mutate(provider.id)
              })
            }
          >
            <span className="jds-btn__icon">
              <X size={15} />
            </span>
            Remove provider
          </button>
        ) : (
          <button
            type="button"
            className="jds-btn jds-btn--secondary jds-btn--sm"
            onClick={() => setPick((open) => !open)}
          >
            <span className="jds-btn__icon">
              <Plus size={15} />
            </span>
            Add provider
          </button>
        )
      }
    >
      {provider ? (
        <ProviderConfig
          provider={provider}
          models={modelsQuery.data?.models ?? []}
          onAuth={(method) => authMutation.mutate({ id: provider.id, authMethod: method })}
        />
      ) : (
        <>
          <div className="ai-src">
            <div className="ai-src__ic">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <div className="ai-src__main">
              <div className="ai-src__name">
                Shared Jarvis assistant{" "}
                <Badge tone="pine" dot>
                  Active
                </Badge>
              </div>
              <div className="ai-src__sub">
                The default. Add a provider to route Jarvis through your own account instead.
              </div>
            </div>
          </div>
          {pick ? <ProviderPicker onChoose={(option) => createMutation.mutate(option)} /> : null}
        </>
      )}
    </Group>
  );
}

function AssistantPane({ advanced }: PaneProps) {
  return (
    <>
      <PaneHead
        title="Assistant & AI"
        desc="Tune how Jarvis sounds and carries itself. These shape the briefing voice and every reply."
      />

      <Group title="Persona">
        <Field
          label="Assistant name"
          hint="What you call your assistant. Used in chat and the briefing."
        >
          <input className="jds-input" defaultValue="Jarvis" aria-label="Assistant name" />
        </Field>
        <Field
          label="Persona"
          hint="In your own words, how should Jarvis interact with you? Its style, what to lean into, what to avoid."
        >
          <textarea
            className="jds-textarea"
            rows={3}
            aria-label="Persona"
            placeholder="e.g. Be direct and a little dry. Skip the pep talks. Push me on commitments, but ease off on a rough day."
          />
        </Field>
        <Choice label="Tone" value="Warm" options={["Warm", "Neutral", "Crisp"]} />
        <Choice label="Directness" value="Balanced" options={["Gentle", "Balanced", "Direct"]} />
        <Choice label="Humor" value="Dry" options={["None", "Dry", "Playful"]} />
        <Choice
          label="Recovery & accountability"
          hint="How Jarvis responds when you fall behind. Never shaming — that's a promise of the product."
          value="Encouraging"
          options={["Encouraging", "Matter-of-fact", "Firm"]}
        />
      </Group>

      {advanced ? (
        <AdvancedAiSource />
      ) : (
        <Group title="AI source">
          <div className="ai-src">
            <div className="ai-src__ic">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <div className="ai-src__main">
              <div className="ai-src__name">
                Shared Jarvis assistant{" "}
                <Badge tone="pine" dot>
                  Active
                </Badge>
              </div>
              <div className="ai-src__sub">
                Jarvis works out of the box on this instance's assistant — nothing to set up.
              </div>
            </div>
          </div>
          <Note icon={<Settings2 size={13} />}>
            Bringing your own provider — keys, models, CLI — lives under <b>Advanced</b> at the top.
            Most people never need it.
          </Note>
        </Group>
      )}
    </>
  );
}

/* ------------------------------------------------------------- Memory */

function MemoryPane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const settingsQuery = useQuery({
    queryKey: queryKeys.chat.memorySettings,
    queryFn: getMemorySettings,
    retry: false
  });
  const factsQuery = useQuery({
    queryKey: queryKeys.chat.memoryFacts,
    queryFn: getMemoryFacts,
    retry: false
  });
  const patchMutation = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => patchMemorySettings(patch),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.chat.memorySettings, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const settings = settingsQuery.data;
  const factCount = factsQuery.data?.facts.length ?? 0;

  return (
    <>
      <PaneHead
        title="Memory & context"
        desc="Everything Jarvis remembers, believes and infers — in the open, and yours to correct."
      />

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
          desc="Always show where a belief came from — what you said, or what was inferred."
          coming
        />
      </Group>

      <Group
        title="What Jarvis knows"
        desc="Confirmed facts stay until you change them. Inferred patterns decay on their own over time."
      >
        <Row
          name="Remembered facts"
          desc="Things you've told Jarvis, or it confirmed with you."
          control={
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
              {factCount}
            </span>
          }
        />
        <Row
          name="Inferred patterns"
          desc="Guesses from your behaviour, awaiting your yes or no."
          coming
        />
        <Row
          name="Corrections"
          desc="Times you've put Jarvis right. It learns from every one."
          coming
        />
      </Group>

      <Group title="Forget">
        <Row
          name="Review & delete memories"
          desc="See everything Jarvis holds and remove anything you'd rather it forgot."
          coming
        />
        <Row
          name="Memory retention window"
          desc="Automatically forget low-value details after a set time."
          coming
        />
        <Row
          name="Per-topic memory controls"
          desc="Choose what Jarvis may remember, topic by topic."
          coming
        />
      </Group>
    </>
  );
}

export const PERSONAL_PANES: Record<string, ComponentType<PaneProps>> = {
  profile: ProfilePane,
  assistant: AssistantPane,
  memory: MemoryPane,
  connected: ConnectedPane,
  sources: SourcesPane,
  modules: ModulesPane,
  general: GeneralPane
};
