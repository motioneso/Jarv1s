import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CornerDownRight, PencilLine, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getChatModelOverrideSettings,
  getPersonaSettings,
  previewPersona,
  putChatModelOverride,
  putPersonaSettings
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import {
  personaSeedText,
  personaSample,
  type DirectnessDial,
  type HumorDial,
  type RecoveryDial,
  type ToneDial
} from "./settings-persona-preview";
import { type PaneProps } from "./settings-types";
import { Choice, Field, Group, Note, PaneHead, Select } from "./settings-ui";

interface PersonaState {
  assistantName: string;
  personaText: string;
  tone: ToneDial;
  directness: DirectnessDial;
  humor: HumorDial;
  recovery: RecoveryDial;
}

const DEFAULT_DESCRIPTION =
  "Be direct and a little dry: skip the pep talks. Hold me to commitments I've actually made, but ease off when I've had a rough day. Lead with what matters and keep it short.";
const DEFAULT_PERSONA_DIALS = {
  tone: "Warm",
  directness: "Balanced",
  humor: "Dry",
  recovery: "Encouraging"
} satisfies Pick<PersonaState, "tone" | "directness" | "humor" | "recovery">;

function initialPersona(): PersonaState {
  return {
    assistantName: "Jarvis",
    personaText: DEFAULT_DESCRIPTION,
    ...DEFAULT_PERSONA_DIALS
  };
}

function Persona({ who }: { readonly who: string }) {
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const [p, setP] = useState<PersonaState>(initialPersona);
  const [saved, setSaved] = useState<PersonaState>(p);
  const [rev, setRev] = useState(0);
  const set = <K extends keyof PersonaState>(k: K, v: PersonaState[K]) =>
    setP((s) => ({ ...s, [k]: v }));
  const personaQuery = useQuery({
    queryKey: queryKeys.settings.persona,
    queryFn: getPersonaSettings,
    retry: false
  });
  useEffect(() => {
    if (!personaQuery.data) return;
    const next: PersonaState = {
      assistantName: personaQuery.data.persona.assistantName,
      personaText: personaQuery.data.persona.personaText,
      ...DEFAULT_PERSONA_DIALS
    };
    setP(next);
    setSaved(next);
    setRev((r) => r + 1);
  }, [personaQuery.data]);
  const dirty =
    p.assistantName !== saved.assistantName || p.personaText.trim() !== saved.personaText.trim();
  const sample = useMemo(() => personaSample(p, who), [p, who]);
  const seedText = useMemo(() => personaSeedText(p), [p]);

  const saveMutation = useMutation({
    mutationFn: () =>
      putPersonaSettings({
        persona: {
          assistantName: p.assistantName,
          personaText: p.personaText
        }
      }),
    onSuccess: (result) => {
      const next: PersonaState = {
        assistantName: result.persona.assistantName,
        personaText: result.persona.personaText,
        tone: p.tone,
        directness: p.directness,
        humor: p.humor,
        recovery: p.recovery
      };
      setP(next);
      setSaved(next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.persona });
      toast("Persona saved. Your next briefing and replies will use this voice.", {
        icon: <Sparkles size={17} />
      });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not save persona");
    }
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      previewPersona({
        persona: {
          assistantName: p.assistantName,
          personaText: p.personaText
        }
      }),
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not preview persona");
    }
  });

  const discard = () => {
    setP(saved);
    setRev((r) => r + 1);
  };
  const applySeed = () => set("personaText", seedText);
  const previewReply = previewMutation.data?.reply;

  return (
    <Group
      title="Persona"
      desc="How Jarvis sounds and carries itself. This is fed into every briefing and reply; the preview shows the effect."
    >
      <Field
        label="Assistant name"
        hint="What you call your assistant. Used in chat and the briefing."
      >
        <input
          className="jds-input"
          value={p.assistantName}
          onChange={(e) => set("assistantName", e.target.value)}
          aria-label="Assistant name"
        />
      </Field>
      <Field
        label="In your own words"
        hint="How should Jarvis interact with you? Its style, what to lean into, what to avoid."
      >
        <textarea
          className="jds-textarea"
          rows={3}
          value={p.personaText}
          onChange={(e) => set("personaText", e.target.value)}
          aria-label="Persona"
          placeholder="e.g. Be direct and a little dry. Skip the pep talks. Push me on commitments, but ease off on a rough day."
        />
      </Field>
      <Choice
        key={`tone${rev}`}
        label="Tone"
        value={p.tone}
        options={["Warm", "Neutral", "Crisp"]}
        onChange={(v) => set("tone", v as ToneDial)}
      />
      <Choice
        key={`dir${rev}`}
        label="Directness"
        value={p.directness}
        options={["Gentle", "Balanced", "Direct"]}
        onChange={(v) => set("directness", v as DirectnessDial)}
      />
      <Choice
        key={`hum${rev}`}
        label="Humor"
        value={p.humor}
        options={["None", "Dry", "Playful"]}
        onChange={(v) => set("humor", v as HumorDial)}
      />
      <Choice
        key={`rec${rev}`}
        label="Recovery & accountability"
        hint="How Jarvis responds when you fall behind. Never shaming: that's a promise of the product."
        value={p.recovery}
        options={["Encouraging", "Matter-of-fact", "Firm"]}
        onChange={(v) => set("recovery", v as RecoveryDial)}
      />

      <div className="ppv">
        <div className="ppv__hd">
          <Sparkles size={13} aria-hidden="true" />
          How {p.assistantName || "Jarvis"} would sound
        </div>
        <div className="ppv__bubble ppv__bubble--main">
          <div className="ppv__cap">{previewReply ? "Voice preview" : "Morning briefing"}</div>
          <p className="ppv__say">{previewReply ?? sample.greeting}</p>
        </div>
        {previewReply ? null : (
          <div className="ppv__bubble">
            <div className="ppv__cap">When you fall behind</div>
            <p className="ppv__say">{sample.recovery}</p>
          </div>
        )}
        <div className="ppv__foot">
          <CornerDownRight size={12} aria-hidden="true" />
          {previewReply ? "Real preview from your chat route." : seedText}
        </div>
      </div>

      <div className={`psona-save${dirty ? " is-dirty" : ""}`}>
        <span className="psona-save__state">
          {dirty ? (
            <PencilLine size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          {dirty ? "Unsaved changes" : "Saved. This is Jarvis's current voice."}
        </span>
        <span className="psona-save__acts">
          <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={applySeed}>
            Use dials
          </button>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || personaQuery.isLoading}
          >
            {previewMutation.isPending ? "Previewing" : "Preview voice"}
          </button>
          {dirty ? (
            <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={discard}>
              Discard
            </button>
          ) : null}
          <button
            type="button"
            className="jds-btn jds-btn--primary jds-btn--sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving" : "Save persona"}
          </button>
        </span>
      </div>
    </Group>
  );
}

function ChatModel() {
  const { toast } = useFeedback();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.ai.chatModelOverride,
    queryFn: getChatModelOverrideSettings,
    retry: false
  });
  const settings = settingsQuery.data?.settings;
  const mutation = useMutation({
    mutationFn: (modelId: string | null) => putChatModelOverride({ modelId }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.ai.chatModelOverride, result);
      const model = result.settings.effectiveOverrideModelId
        ? result.settings.selectedModel
        : result.settings.defaultModel;
      toast(`Chat now uses ${model?.displayName ?? "the instance default"}`, {
        icon: <Sparkles size={17} />
      });
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : "Could not update chat model");
    }
  });
  const defaultModel = settings?.defaultModel ?? null;
  const allowedModels = settings?.allowedModels ?? [];
  const allowedIds = new Set(allowedModels.map((m) => m.id));
  const currentOverride =
    settings?.currentOverrideModelId && allowedIds.has(settings.currentOverrideModelId)
      ? settings.currentOverrideModelId
      : null;
  const value = currentOverride ?? "default";

  return (
    <Group
      title="Chat model"
      desc="The assistant that answers when you chat with Jarvis. Admins manage providers and routing."
    >
      {defaultModel ? (
        <>
          {settings?.overrideEnabled ? (
            <Field
              label="Powering your chat"
              hint="Defaults to the instance routing your admin set. Override it to a specific model for your own conversations."
            >
              <Select
                value={value}
                disabled={mutation.isPending || settingsQuery.isLoading}
                onChange={(e) =>
                  mutation.mutate(e.target.value === "default" ? null : e.target.value)
                }
                aria-label="Chat model"
              >
                <option value="default">Instance default · {defaultModel.providerModelId}</option>
                {allowedModels
                  .filter((m) => m.id !== defaultModel.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.providerDisplayName} · {m.providerModelId}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field
              label="Powering your chat"
              hint="Your admin has locked chat to the instance default."
            >
              <input
                className="jds-input"
                value={`${defaultModel.providerDisplayName} · ${defaultModel.providerModelId}`}
                readOnly
                aria-label="Chat model"
              />
            </Field>
          )}
          <Note>
            Providers, credentials and which model handles each kind of work live in{" "}
            <b>Admin → Assistant &amp; AI</b>.
          </Note>
        </>
      ) : (
        <div className="ai-empty">
          <div className="ai-empty__ic">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div className="ai-empty__main">
            <div className="ai-empty__t">No assistant configured yet</div>
            <div className="ai-empty__d">
              An admin needs to add an AI provider before Jarvis can chat. Ask whoever set up this
              instance. If that's you, add one under <b>Admin → Assistant &amp; AI</b>.
            </div>
          </div>
        </div>
      )}
    </Group>
  );
}

export function AssistantPane({ me }: PaneProps) {
  const who = (me.user.name ?? "").split(/\s+/)[0] || "there";
  return (
    <>
      <PaneHead
        title="Assistant & AI"
        desc="Tune how Jarvis sounds, and choose which assistant powers your chat."
      />
      <Persona who={who} />
      <ChatModel />
    </>
  );
}
