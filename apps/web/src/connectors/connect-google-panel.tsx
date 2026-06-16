import { useQuery } from "@tanstack/react-query";
import { Cable, LoaderCircle } from "lucide-react";

import { listConnectorAccounts } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useGoogleConnectFlow } from "./use-google-connect-flow";

export function ConnectGooglePanel() {
  const flow = useGoogleConnectFlow();
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: listConnectorAccounts,
    retry: false
  });
  const googleAccounts =
    accountsQuery.data?.accounts.filter(
      (account) => account.providerId === "google" && account.status !== "revoked"
    ) ?? [];

  return (
    <section className="panel" aria-labelledby="connect-google-title">
      <div className="panel-heading">
        <Cable size={20} aria-hidden="true" />
        <h2 id="connect-google-title">Connect Google</h2>
      </div>
      {googleAccounts.length ? (
        <div className="connected-summary" aria-label="Connected Google accounts">
          <div className="connected-summary__head">
            <strong>Connected account</strong>
            <span>{googleAccounts.length}</span>
          </div>
          <ul>
            {googleAccounts.map((account) => (
              <li key={account.id}>
                <span>{account.providerDisplayName}</span>
                <span>{account.status === "active" ? "Ready" : "Needs attention"}</span>
              </li>
            ))}
          </ul>
          <p className="form-hint">
            This build stores one Google connection per user. Running the flow again reconnects that
            account.
          </p>
        </div>
      ) : null}
      <ol className="connect-steps">
        <li>
          Create a Google Cloud project, enable the Gmail &amp; Calendar APIs, and create an OAuth
          client of type <strong>Desktop app</strong>. Add yourself as a test user.
        </li>
        <li>Paste your client ID &amp; secret below and start authorization.</li>
        <li>
          Approve in the browser. It will fail to load <code>http://localhost:1</code> — that is
          expected. Copy the full address-bar URL and paste it back.
        </li>
      </ol>
      <label>
        Client ID
        <input value={flow.clientId} onChange={(e) => flow.setClientId(e.target.value)} />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={flow.clientSecret}
          onChange={(e) => flow.setClientSecret(e.target.value)}
        />
      </label>
      <button
        className="primary-button"
        disabled={flow.authorizationPending || !flow.clientId.trim() || !flow.clientSecret.trim()}
        onClick={flow.startAuthorization}
      >
        {flow.authorizationPending ? <LoaderCircle className="spin" size={18} /> : null} Start
        authorization
      </button>
      {flow.authUrl ? (
        <>
          <p>
            <a href={flow.authUrl} target="_blank" rel="noreferrer">
              Open Google consent ↗
            </a>
          </p>
          <label>
            Pasted redirect URL
            <input
              value={flow.redirectUrl}
              onChange={(e) => flow.setRedirectUrl(e.target.value)}
              placeholder="http://localhost:1/?code=..."
            />
          </label>
          <button
            className="primary-button"
            disabled={flow.completionPending || !flow.redirectUrl.trim()}
            onClick={flow.finishConnection}
          >
            {flow.completionPending ? <LoaderCircle className="spin" size={18} /> : null} Finish
            connecting
          </button>
        </>
      ) : null}
      {flow.error ? <p className="form-error">{flow.error}</p> : null}
    </section>
  );
}
