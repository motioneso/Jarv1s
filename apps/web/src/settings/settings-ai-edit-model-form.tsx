import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";

import { updateAiModel } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { readError } from "./settings-types";
import { useFeedback } from "./settings-feedback";
import { Field, Segmented } from "./settings-ui";
import type { AiConfiguredModelDto, AiModelCapability, AiModelTier } from "@jarv1s/shared";

const ALL_CAPABILITIES: readonly AiModelCapability[] = [
  "chat",
  "tool-use",
  "json",
  "vision",
  "summarization"
];

const CAP_SHORT: Record<AiModelCapability, string> = {
  chat: "Chat",
  "tool-use": "Tools",
  json: "JSON",
  vision: "Vision",
  summarization: "Summary"
};

const MODEL_TIERS: readonly AiModelTier[] = ["reasoning", "interactive", "economy"];

export function EditModelForm(props: {
  readonly model: AiConfiguredModelDto;
  readonly onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const { model } = props;

  const [providerModelId, setProviderModelId] = useState(model.providerModelId ?? "");
  const [displayName, setDisplayName] = useState(model.displayName);
  const [tier, setTier] = useState<AiModelTier>(model.tier);
  const [capabilities, setCapabilities] = useState<readonly AiModelCapability[]>(
    model.capabilities
  );

  const editMutation = useMutation({
    mutationFn: () => updateAiModel(model.id, { providerModelId, displayName, tier, capabilities }),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.models }),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.capabilities })
      ]);
      toast("Model updated", { icon: <Pencil size={17} /> });
      props.onClose();
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providerModelId.trim() || !displayName.trim()) return;
    editMutation.mutate();
  };

  return (
    <form className="ai-model-form ai-model-form--edit" onSubmit={submit}>
      <Field label="Model id">
        <input
          className="jds-input"
          value={providerModelId}
          onChange={(e) => setProviderModelId(e.target.value)}
          aria-label="Model id"
        />
      </Field>
      <Field label="Display name">
        <input
          className="jds-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
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
      <div className="ai-model-form__acts">
        <button
          type="submit"
          className="jds-btn jds-btn--primary jds-btn--sm"
          disabled={editMutation.isPending || !providerModelId.trim() || !displayName.trim()}
        >
          {editMutation.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          onClick={props.onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
