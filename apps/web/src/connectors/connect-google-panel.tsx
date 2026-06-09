import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cable, LoaderCircle } from "lucide-react";

import { authorizeGoogleConnection, completeGoogleConnection } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function ConnectGooglePanel() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authorize = useMutation({
    mutationFn: () =>
      authorizeGoogleConnection({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: (r) => {
      setAuthUrl(r.authUrl);
      setError(null);
    },
    onError: (e: Error) => setError(e.message)
  });

  const complete = useMutation({
    mutationFn: () => completeGoogleConnection({ redirectUrl: redirectUrl.trim() }),
    onSuccess: async () => {
      setAuthUrl(null);
      setRedirectUrl("");
      setClientId("");
      setClientSecret("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
    },
    onError: (e: Error) => setError(e.message)
  });

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
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>
      <button
        className="primary-button"
        disabled={authorize.isPending || !clientId.trim() || !clientSecret.trim()}
        onClick={() => authorize.mutate()}
      >
        {authorize.isPending ? <LoaderCircle className="spin" size={18} /> : null} Start
        authorization
      </button>
      {authUrl ? (
        <>
          <p>
            <a href={authUrl} target="_blank" rel="noreferrer">
              Open Google consent ↗
            </a>
          </p>
          <label>
            Pasted redirect URL
            <input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="http://localhost:1/?code=..."
            />
          </label>
          <button
            className="primary-button"
            disabled={complete.isPending || !redirectUrl.trim()}
            onClick={() => complete.mutate()}
          >
            {complete.isPending ? <LoaderCircle className="spin" size={18} /> : null} Finish
            connecting
          </button>
        </>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
