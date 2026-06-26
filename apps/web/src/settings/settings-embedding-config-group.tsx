import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { getRuntimeConfig, putRuntimeConfig } from "../api/runtime-config-client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Badge, Field, Group, Note, Select } from "./settings-ui";

const EMBED_PROVIDER_CONFIG_KEY = "ai.embed_provider";
const EMBED_MODEL_CONFIG_KEY = "ai.embed_model";
const EMBED_PROVIDER_OPTIONS = ["local", "stub"] as const;

function sourceBadge(source: "instance" | "env" | "default" | undefined) {
  if (source === "instance") return <Badge tone="pine">Instance</Badge>;
  if (source === "env") return <Badge tone="amber">Env</Badge>;
  return <Badge tone="steel">Default</Badge>;
}

export function EmbeddingConfigGroup() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [provider, setProvider] = useState<(typeof EMBED_PROVIDER_OPTIONS)[number]>("local");
  const [model, setModel] = useState("");

  const providerQuery = useQuery({
    queryKey: queryKeys.ai.runtimeConfig(EMBED_PROVIDER_CONFIG_KEY),
    queryFn: () => getRuntimeConfig(EMBED_PROVIDER_CONFIG_KEY),
    retry: false
  });
  const modelQuery = useQuery({
    queryKey: queryKeys.ai.runtimeConfig(EMBED_MODEL_CONFIG_KEY),
    queryFn: () => getRuntimeConfig(EMBED_MODEL_CONFIG_KEY),
    retry: false
  });

  useEffect(() => {
    const value = providerQuery.data?.config.value;
    if (value === "local" || value === "stub") setProvider(value);
  }, [providerQuery.data?.config.value]);

  useEffect(() => {
    setModel(modelQuery.data?.config.value ?? "");
  }, [modelQuery.data?.config.value]);

  const invalidate = (key: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.ai.runtimeConfig(key) });

  const saveProvider = useMutation({
    mutationFn: () => putRuntimeConfig(EMBED_PROVIDER_CONFIG_KEY, { value: provider }),
    onSuccess: () => {
      void invalidate(EMBED_PROVIDER_CONFIG_KEY);
      toast("Embedding provider saved", { icon: <Cpu size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const saveModel = useMutation({
    mutationFn: () => putRuntimeConfig(EMBED_MODEL_CONFIG_KEY, { value: model.trim() }),
    onSuccess: () => {
      void invalidate(EMBED_MODEL_CONFIG_KEY);
      toast("Embedding model saved", { icon: <Cpu size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const providerSource = providerQuery.data?.config.source;
  const modelSource = modelQuery.data?.config.source;

  return (
    <Group
      title="Embeddings"
      desc="Controls how Jarvis builds memory search vectors for notes and conversations."
    >
      <Field label="Provider" hint={sourceBadge(providerSource)}>
        <Select
          value={provider}
          aria-label="Embedding provider"
          disabled={saveProvider.isPending}
          onChange={(event) =>
            setProvider(event.target.value as (typeof EMBED_PROVIDER_OPTIONS)[number])
          }
        >
          {EMBED_PROVIDER_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === "local" ? "Local" : "Stub"}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="jds-btn jds-btn--secondary jds-btn--sm"
          disabled={saveProvider.isPending}
          onClick={() => saveProvider.mutate()}
        >
          {saveProvider.isPending ? "Saving..." : "Save"}
        </button>
      </Field>
      <Field label="Model" hint={sourceBadge(modelSource)}>
        <input
          className="jds-input"
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Provider default"
          aria-label="Embedding model"
        />
        <button
          type="button"
          className="jds-btn jds-btn--secondary jds-btn--sm"
          disabled={saveModel.isPending}
          onClick={() => saveModel.mutate()}
        >
          {saveModel.isPending ? "Saving..." : "Save"}
        </button>
      </Field>
      <Note icon={<Cpu size={13} />}>
        {providerSource === "env" || modelSource === "env"
          ? "Env fallback is active until an instance value is saved."
          : "Instance values take effect without restarting Jarvis."}
      </Note>
    </Group>
  );
}
