import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, CircleOff, KeyRound, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createConnectorAccount,
  listAdminConnectorAccounts,
  listConnectorAccounts,
  listConnectorProviders,
  revokeConnectorAccount,
  updateConnectorAccount
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type { ConnectorAccountDto, ConnectorAccountStatus } from "@jarv1s/shared";

interface ConnectorsPanelProps {
  readonly isAdmin: boolean;
}

export function ConnectorsPanel(props: ConnectorsPanelProps) {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: queryKeys.connectors.providers,
    queryFn: () => listConnectorProviders()
  });
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: () => listConnectorAccounts()
  });
  const adminAccountsQuery = useQuery({
    enabled: props.isAdmin,
    queryKey: queryKeys.settings.adminConnectorAccounts,
    queryFn: listAdminConnectorAccounts,
    retry: false
  });
  const providers = providersQuery.data?.providers ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <>
      <section className="panel" aria-labelledby="connector-providers-title">
        <div className="panel-heading">
          <Cable size={20} aria-hidden="true" />
          <h2 id="connector-providers-title">Connector Providers</h2>
        </div>
        <div className="compact-list">
          {providers.map((provider) => (
            <div className="compact-row" key={provider.id}>
              <span>{provider.displayName}</span>
              <strong className={provider.status === "available" ? "status-good" : "status-muted"}>
                {provider.providerType}
              </strong>
            </div>
          ))}
          {providersQuery.isLoading ? <p className="muted-text">Loading providers</p> : null}
          {providersQuery.error ? (
            <p className="form-error">{providersQuery.error.message}</p>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-labelledby="connector-accounts-title">
        <div className="panel-heading">
          <KeyRound size={20} aria-hidden="true" />
          <h2 id="connector-accounts-title">Connector Accounts</h2>
        </div>
        <CreateConnectorForm
          providers={providers}
          onCreated={() => invalidateConnectorQueries(queryClient)}
        />
        <ConnectorAccountList
          accounts={accounts}
          isLoading={accountsQuery.isLoading}
          error={accountsQuery.error}
        />
      </section>

      {props.isAdmin ? (
        <section className="panel span-2" aria-labelledby="admin-connectors-title">
          <div className="panel-heading">
            <KeyRound size={20} aria-hidden="true" />
            <h2 id="admin-connectors-title">Admin Connector Metadata</h2>
          </div>
          <div className="compact-list">
            {(adminAccountsQuery.data?.accounts ?? []).map((account) => (
              <div className="compact-row" key={account.id}>
                <span>{account.providerDisplayName}</span>
                <strong>{account.status}</strong>
              </div>
            ))}
            {adminAccountsQuery.isLoading ? (
              <p className="muted-text">Loading connector metadata</p>
            ) : null}
            {adminAccountsQuery.error ? (
              <p className="form-error">{adminAccountsQuery.error.message}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function CreateConnectorForm(props: {
  readonly providers: readonly { readonly id: string; readonly defaultScopes: readonly string[] }[];
  readonly onCreated: () => Promise<void>;
}) {
  const [providerId, setProviderId] = useState("");
  const [scopes, setScopes] = useState("");
  const [tokenPayload, setTokenPayload] = useState('{"accessToken":"placeholder"}');
  const [formError, setFormError] = useState<string | null>(null);
  const selectedProvider = useMemo(
    () => props.providers.find((provider) => provider.id === providerId),
    [providerId, props.providers]
  );
  const createMutation = useMutation({
    mutationFn: () =>
      createConnectorAccount({
        providerId,
        scopes: parseScopes(scopes || selectedProvider?.defaultScopes.join(" ") || ""),
        tokenPayload: parseTokenPayload(tokenPayload)
      }),
    onSuccess: async () => {
      setScopes("");
      setTokenPayload("{}");
      setFormError(null);
      await props.onCreated();
    },
    onError: (error) => setFormError(error.message)
  });

  useEffect(() => {
    if (!providerId && props.providers[0]) {
      setProviderId(props.providers[0].id);
    }
  }, [providerId, props.providers]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <form className="connector-form" onSubmit={handleSubmit}>
      <label>
        Provider
        <select onChange={(event) => setProviderId(event.target.value)} required value={providerId}>
          {props.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.id}
            </option>
          ))}
        </select>
      </label>

      <label>
        Scopes
        <input
          onChange={(event) => setScopes(event.target.value)}
          placeholder={selectedProvider?.defaultScopes.join(" ") ?? "scope"}
          type="text"
          value={scopes}
        />
      </label>

      <label className="span-2">
        Token JSON
        <textarea
          onChange={(event) => setTokenPayload(event.target.value)}
          required
          rows={3}
          value={tokenPayload}
        />
      </label>

      {formError ? <p className="form-error span-2">{formError}</p> : null}

      <button className="primary-button span-2" disabled={createMutation.isPending} type="submit">
        {createMutation.isPending ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <Plus size={18} aria-hidden="true" />
        )}
        Add connector
      </button>
    </form>
  );
}

function ConnectorAccountList(props: {
  readonly accounts: readonly ConnectorAccountDto[];
  readonly isLoading: boolean;
  readonly error: Error | null;
}) {
  if (props.isLoading) {
    return <p className="muted-text">Loading connector accounts</p>;
  }

  if (props.error) {
    return <p className="form-error">{props.error.message}</p>;
  }

  if (props.accounts.length === 0) {
    return <p className="muted-text">No connector accounts</p>;
  }

  return (
    <div className="connector-account-list">
      {props.accounts.map((account) => (
        <ConnectorAccountRow account={account} key={account.id} />
      ))}
    </div>
  );
}

function ConnectorAccountRow(props: { readonly account: ConnectorAccountDto }) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (status: Exclude<ConnectorAccountStatus, "revoked">) =>
      updateConnectorAccount(props.account.id, { status }),
    onSuccess: async () => invalidateConnectorQueries(queryClient)
  });
  const revokeMutation = useMutation({
    mutationFn: () => revokeConnectorAccount(props.account.id),
    onSuccess: async () => invalidateConnectorQueries(queryClient)
  });
  const nextStatus = props.account.status === "error" ? "active" : "error";

  return (
    <article className="connector-account-row">
      <div>
        <strong>{props.account.providerDisplayName}</strong>
        <p>
          {props.account.status} - {props.account.scopes.join(", ") || "no scopes"} -{" "}
          {props.account.hasSecret ? "secret stored" : "no secret"}
        </p>
      </div>
      <div className="connector-actions">
        {props.account.status !== "revoked" ? (
          <>
            <button
              className="secondary-button"
              disabled={updateMutation.isPending}
              type="button"
              onClick={() => updateMutation.mutate(nextStatus)}
            >
              <RotateCcw size={16} aria-hidden="true" />
              {nextStatus === "active" ? "Activate" : "Mark error"}
            </button>
            <button
              className="secondary-button"
              disabled={revokeMutation.isPending}
              type="button"
              onClick={() => revokeMutation.mutate()}
            >
              <CircleOff size={16} aria-hidden="true" />
              Revoke
            </button>
          </>
        ) : (
          <span className="status-muted">Revoked</span>
        )}
      </div>
    </article>
  );
}

function parseScopes(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseTokenPayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Token JSON must be an object");
  }

  return parsed as Record<string, unknown>;
}

async function invalidateConnectorQueries(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts }),
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminConnectorAccounts })
  ]);
}
