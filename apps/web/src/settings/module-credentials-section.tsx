import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ModuleCredentialStatusDto } from "@jarv1s/shared";

import {
  listModuleCredentials,
  revokeModuleCredential,
  setModuleCredential
} from "../api/client.js";
import { Field } from "./settings-ui.js";
import { useFeedback } from "./settings-feedback.js";
import { readError } from "./settings-types.js";

/**
 * Module credential slots (#918). Docked under a module's row on both the admin surface
 * (instance-scope slots) and, where a `me` surface exists, the per-user surface. Renders
 * nothing when the module declares zero credential slots or the list hasn't loaded yet —
 * matches the file-size/silent-drop discipline used across this module system slice:
 * the value is write-only, the server response never carries a plaintext or ciphertext
 * field (`ModuleCredentialStatusDto` has no such field to begin with).
 */
export function ModuleCredentialsSection(props: {
  readonly moduleId: string;
  readonly surface: "admin" | "me";
}) {
  const queryClient = useQueryClient();
  const queryKey = ["module-credentials", props.surface, props.moduleId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listModuleCredentials(props.surface, props.moduleId),
    retry: false
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const { toast, confirm } = useFeedback();
  const setMutation = useMutation({
    mutationFn: (input: { credentialId: string; value: string }) =>
      setModuleCredential(props.surface, props.moduleId, input.credentialId, input.value),
    onSuccess: () => {
      void invalidate();
      toast("Credential saved", { icon: <KeyRound size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const revokeMutation = useMutation({
    mutationFn: (credentialId: string) =>
      revokeModuleCredential(props.surface, props.moduleId, credentialId),
    onSuccess: () => {
      void invalidate();
      toast("Credential removed", { tone: "drift", icon: <Trash2 size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  if (query.isLoading || !query.data || query.data.credentials.length === 0) return null;

  return (
    <>
      {query.data.credentials.map((credential) => (
        <CredentialField
          key={credential.credentialId}
          credential={credential}
          busy={setMutation.isPending || revokeMutation.isPending}
          onSet={(value) => setMutation.mutate({ credentialId: credential.credentialId, value })}
          onRevoke={() =>
            confirm({
              title: `Remove ${credential.displayName}?`,
              description:
                "The module stops working with this credential until a new one is added.",
              confirmLabel: "Remove",
              danger: true,
              onConfirm: () => revokeMutation.mutate(credential.credentialId)
            })
          }
        />
      ))}
    </>
  );
}

function CredentialField(props: {
  readonly credential: ModuleCredentialStatusDto;
  readonly onSet: (value: string) => void;
  readonly onRevoke: () => void;
  readonly busy: boolean;
}) {
  // Local draft only — the value is never persisted to any query cache and is cleared
  // immediately after a successful save; it never round-trips from the server.
  const [draft, setDraft] = useState("");
  const { credential } = props;
  return (
    <Field
      label={credential.displayName}
      hint={credential.configured ? "Stored encrypted. Never shown once saved." : "Not configured."}
    >
      <input
        className="jds-input"
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={credential.configured ? "•••••••• (stored)" : "Enter value"}
        aria-label={credential.displayName}
      />
      <button
        type="button"
        className="jds-btn jds-btn--secondary jds-btn--sm"
        disabled={props.busy || draft.length === 0}
        onClick={() => {
          props.onSet(draft);
          setDraft("");
        }}
      >
        {props.busy ? "Saving…" : "Save"}
      </button>
      {credential.configured ? (
        <button
          type="button"
          className="jds-btn jds-btn--quiet jds-btn--sm"
          disabled={props.busy}
          onClick={props.onRevoke}
        >
          Revoke
        </button>
      ) : null}
    </Field>
  );
}
