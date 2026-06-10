import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, CircleOff, KeyRound, RotateCcw } from "lucide-react";

import {
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
        <ConnectorAccountList
          accounts={accounts}
          isLoading={accountsQuery.isLoading}
          error={accountsQuery.error}
          onChanged={() => invalidateConnectorQueries(queryClient)}
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

function ConnectorAccountList(props: {
  readonly accounts: readonly ConnectorAccountDto[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onChanged: () => Promise<void>;
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
        <ConnectorAccountRow account={account} key={account.id} onChanged={props.onChanged} />
      ))}
    </div>
  );
}

function ConnectorAccountRow(props: {
  readonly account: ConnectorAccountDto;
  readonly onChanged: () => Promise<void>;
}) {
  const updateMutation = useMutation({
    mutationFn: (status: Exclude<ConnectorAccountStatus, "revoked">) =>
      updateConnectorAccount(props.account.id, { status }),
    onSuccess: props.onChanged
  });
  const revokeMutation = useMutation({
    mutationFn: () => revokeConnectorAccount(props.account.id),
    onSuccess: props.onChanged
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

async function invalidateConnectorQueries(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts }),
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminConnectorAccounts })
  ]);
}
