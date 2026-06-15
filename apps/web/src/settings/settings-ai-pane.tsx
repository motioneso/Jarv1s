import { useQuery } from "@tanstack/react-query";
import { Check, CornerDownRight, PencilLine, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { listAiModels } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import {
  personaSample,
  type DirectnessDial,
  type HumorDial,
  type RecoveryDial,
  type ToneDial
} from "./settings-persona-preview";
import { type PaneProps } from "./settings-types";
import { Choice, Field, Group, NotWired, Note, PaneHead, Select } from "./settings-ui";

interface PersonaState {
  name: string;
  description: string;
  tone: ToneDial;
  directness: DirectnessDial;
  humor: HumorDial;
  recovery: RecoveryDial;
}

const PERSONA_STORAGE_KEY = "jarvis.settings.persona";
const DEFAULT_DESCRIPTION =
  "Be direct and a little dry — skip the pep talks. Hold me to commitments I've actually made, but ease off when I've had a rough day. Lead with what matters and keep it short.";

function initialPersona(): PersonaState {
  const base: PersonaState = {
    name: "Jarvis",
    description: DEFAULT_DESCRIPTION,
    tone: "Warm",
    directness: "Balanced",
    humor: "Dry",
    recovery: "Encouraging"
  };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<PersonaState>) } : base;
  } catch {
    return base;
  }
}

function Persona({ who }: { readonly who: string }) {
  const { toast } = useFeedback();
  const [p, setP] = useState<PersonaState>(initialPersona);
  const [saved, setSaved] = useState<PersonaState>(p);
  const [rev, setRev] = useState(0);
  const set = <K extends keyof PersonaState>(k: K, v: PersonaState[K]) =>
    setP((s) => ({ ...s, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const sample = useMemo(() => personaSample(p, who), [p, who]);

  const save = () => {
    setSaved(p);
    setRev((r) => r + 1);
    try {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* BACKEND-TODO: persist persona + dials and feed them into the system prompt; local storage until then */
    }
    toast("Persona saved — your next briefing and replies use this voice", {
      icon: <Sparkles size={17} />
    });
  };
  const discard = () => {
    setP(saved);
    setRev((r) => r + 1);
  };

  return (
    <Group
      title="Persona"
      desc="How Jarvis sounds and carries itself. This is fed into every briefing and reply — the preview shows the effect."
    >
      <NotWired>
        Saves locally only — not yet fed into the system prompt. The preview is illustrative.
      </NotWired>
      <Field
        label="Assistant name"
        hint="What you call your assistant. Used in chat and the briefing."
      >
        <input
          className="jds-input"
          value={p.name}
          onChange={(e) => set("name", e.target.value)}
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
          value={p.description}
          onChange={(e) => set("description", e.target.value)}
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
        hint="How Jarvis responds when you fall behind. Never shaming — that's a promise of the product."
        value={p.recovery}
        options={["Encouraging", "Matter-of-fact", "Firm"]}
        onChange={(v) => set("recovery", v as RecoveryDial)}
      />

      <div className="ppv">
        <div className="ppv__hd">
          <Sparkles size={13} aria-hidden="true" />
          How {p.name || "Jarvis"} would sound
        </div>
        <div className="ppv__bubble ppv__bubble--main">
          <div className="ppv__cap">Morning briefing</div>
          <p className="ppv__say">{sample.greeting}</p>
        </div>
        <div className="ppv__bubble">
          <div className="ppv__cap">When you fall behind</div>
          <p className="ppv__say">{sample.recovery}</p>
        </div>
        <div className="ppv__foot">
          <CornerDownRight size={12} aria-hidden="true" />A live illustration of your settings — not
          a recorded reply.
        </div>
      </div>

      <div className={`psona-save${dirty ? " is-dirty" : ""}`}>
        <span className="psona-save__state">
          {dirty ? (
            <PencilLine size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          {dirty ? "Unsaved changes" : "Saved — this is Jarvis's current voice"}
        </span>
        <span className="psona-save__acts">
          {dirty ? (
            <button type="button" className="jds-btn jds-btn--quiet jds-btn--sm" onClick={discard}>
              Discard
            </button>
          ) : null}
          <button
            type="button"
            className="jds-btn jds-btn--primary jds-btn--sm"
            disabled={!dirty}
            onClick={save}
          >
            Save persona
          </button>
        </span>
      </div>
    </Group>
  );
}

const CHAT_MODEL_STORAGE_KEY = "jarvis.settings.chatModel";

function ChatModel() {
  const { toast } = useFeedback();
  const modelsQuery = useQuery({
    queryKey: queryKeys.ai.models,
    queryFn: listAiModels,
    retry: false
  });
  const chatModels = (modelsQuery.data?.models ?? []).filter(
    (m) => m.status !== "disabled" && m.capabilities.includes("chat")
  );
  const [choice, setChoice] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY) ?? "default";
  });

  const onChange = (value: string) => {
    setChoice(value);
    try {
      window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, value);
    } catch {
      /* BACKEND-TODO: per-user chat-model override endpoint (decision: allow override or read-only?); local storage until then */
    }
    const label =
      value === "default"
        ? "the instance default"
        : chatModels.find((m) => m.id === value)?.displayName;
    toast(`Chat now uses ${label ?? "the selected model"}`, { icon: <Sparkles size={17} /> });
  };

  return (
    <Group
      title="Chat model"
      desc="Which assistant answers when you chat with Jarvis. Providers and instance-wide routing are managed by an admin."
    >
      {chatModels.length ? (
        <>
          <NotWired>
            Your override is remembered on this device only — it doesn't change routing yet.
          </NotWired>
          <Field
            label="Powering your chat"
            hint="Defaults to the instance routing your admin set. Override it to a specific model for your own conversations."
          >
            <Select
              value={choice}
              onChange={(e) => onChange(e.target.value)}
              aria-label="Chat model"
            >
              <option value="default">Instance default</option>
              {chatModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.providerDisplayName} · {m.providerModelId}
                </option>
              ))}
            </Select>
          </Field>
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
              instance — or, if that's you, add one under <b>Admin → Assistant &amp; AI</b>.
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
