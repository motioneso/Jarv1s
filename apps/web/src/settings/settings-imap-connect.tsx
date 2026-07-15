import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { connectImapConnection, testImapConnection } from "../api/client";
import { GOOGLE_CONNECT_SUCCESS_QUERY_KEYS } from "../connectors/use-google-connect-flow";
import { IMAP_PROVIDERS, type ImapProvider } from "../onboarding/google-connector-step";
import { useFeedback } from "./settings-feedback";

function imapResultCopy(result: string): string {
  if (result === "ok") return "Connection works.";
  if (result === "auth_failed") return "The mail server rejected that username or password.";
  if (result === "tls_failed") return "Could not establish a secure connection.";
  return "Could not reach the mail server.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Connection failed.";
}

/* Settings-surface twin of the onboarding IMAP flow (google-connector-step.tsx) — same
   provider list, same testImapConnection/connectImapConnection API layer, same success
   query-key invalidation, since accounts.done is shared between onboarding and settings. */
export function ImapConnect(props: {
  readonly onBack: () => void;
  readonly initialProvider?: ImapProvider;
}) {
  const [provider, setProvider] = useState<ImapProvider | null>(props.initialProvider ?? null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useFeedback();

  const credsReady = username.trim().length > 0 && password.length > 0;

  const testImap = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error("Choose a provider first.");
      return testImapConnection({ providerId: provider.id, username, password });
    },
    onSuccess: ({ result }) => setTestResult(imapResultCopy(result))
  });

  const connectImap = useMutation({
    mutationFn: () => {
      if (!provider) throw new Error("Choose a provider first.");
      return connectImapConnection({ providerId: provider.id, username, password });
    },
    onSuccess: () =>
      Promise.all(
        GOOGLE_CONNECT_SUCCESS_QUERY_KEYS.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      ).then(() => {
        toast(`Connected ${provider?.name ?? "email"} — messages are syncing`, {
          icon: <Check size={17} />
        });
        props.onBack();
      }),
    onError: (error) => toast(errorMessage(error), { tone: "drift" })
  });

  if (!provider) {
    return (
      <div className="imapflow">
        <button type="button" className="gflow__back" onClick={props.onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          All accounts
        </button>
        <div className="provpick__hd">Choose an email provider</div>
        <div className="onb-provgrid">
          {IMAP_PROVIDERS.map((p) => (
            <button
              className="onb-provmini"
              key={p.id}
              type="button"
              onClick={() => {
                setProvider(p);
                setTestResult(null);
              }}
            >
              <span className="onb-provmini__tile">{p.tile}</span>
              <span className="onb-provmini__main">
                <span className="onb-provmini__name">{p.name}</span>
                <span className="onb-provmini__soon">Connect {p.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="imapflow">
      <button
        type="button"
        className="gflow__back"
        onClick={() => (props.initialProvider ? props.onBack() : setProvider(null))}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {props.initialProvider ? "All accounts" : "Choose a different provider"}
      </button>
      <div className="gflow__intro">
        <span className="gflow__g">{provider.tile}</span>
        <div className="gflow__introtx">
          <div className="gflow__title">Connect {provider.name}</div>
          <div className="gflow__sub">IMAP email sync</div>
        </div>
      </div>
      <div className="onb-guide__intro">
        <span className="ic">
          <ShieldCheck size={15} aria-hidden="true" />
        </span>
        <span>{provider.prerequisite}</span>
      </div>
      <div className="onb-cred">
        <div className="onb-cred__hd">Enter your email credentials</div>
        <label className="onb-cred__field">
          <span className="onb-cred__lbl">Email address</span>
          <span className="onb-cred__in">
            <span className="ic">
              <Mail size={15} aria-hidden="true" />
            </span>
            <input
              type="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="you@example.com"
              spellCheck={false}
              aria-label="Email address"
            />
          </span>
        </label>
        <label className="onb-cred__field">
          <span className="onb-cred__lbl">App password</span>
          <span className="onb-cred__in">
            <span className="ic">
              <KeyRound size={15} aria-hidden="true" />
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Provider app password"
              spellCheck={false}
              aria-label="App password"
            />
          </span>
        </label>
        <div className="onb-cred__actions">
          <button
            className="jds-btn jds-btn--quiet jds-btn--sm"
            type="button"
            disabled={!credsReady || testImap.isPending}
            onClick={() => testImap.mutate()}
          >
            Test connection
          </button>
          <button
            className="jds-btn jds-btn--primary jds-btn--sm"
            type="button"
            disabled={!credsReady || connectImap.isPending}
            onClick={() => connectImap.mutate()}
          >
            Connect {provider.name}
          </button>
          <button
            className="jds-btn jds-btn--quiet jds-btn--sm"
            type="button"
            onClick={props.onBack}
          >
            Cancel
          </button>
          <span className="onb-cred__hint">
            Passwords are encrypted at rest and never shown in logs or briefings.
          </span>
        </div>
        {testResult ? <p className="gflow__p">{testResult}</p> : null}
        {testImap.error ? <p className="form-error">{errorMessage(testImap.error)}</p> : null}
        {connectImap.error ? <p className="form-error">{errorMessage(connectImap.error)}</p> : null}
      </div>
    </div>
  );
}
