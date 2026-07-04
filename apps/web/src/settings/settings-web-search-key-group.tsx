import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Globe, Trash2 } from "lucide-react";

import { deleteWebSearchKey, getWebSearchKey, putWebSearchKey } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Field, Group, Note } from "./settings-ui";

export function WebSearchKeyGroup() {
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
