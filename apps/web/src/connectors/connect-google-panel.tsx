import { Cable, LoaderCircle } from "lucide-react";

import { useGoogleConnectFlow } from "./use-google-connect-flow";

export function ConnectGooglePanel() {
  const flow = useGoogleConnectFlow();

  return (
    <section className="panel" aria-labelledby="connect-google-title">
      <div className="panel-heading">
        <Cable size={20} aria-hidden="true" />
        <h2 id="connect-google-title">Connect Google</h2>
      </div>
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
