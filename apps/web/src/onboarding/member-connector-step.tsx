import { useQuery } from "@tanstack/react-query";

import { listConnectorAccounts } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { ConnectGooglePanel } from "../connectors/connect-google-panel";

export function MemberConnectorStep(props: { readonly onSkipStep: () => void }) {
  const accountsQuery = useQuery({
    queryKey: queryKeys.connectors.accounts,
    queryFn: () => listConnectorAccounts(),
    retry: false
  });
  // Client-side connectors.done derivation (module isolation): the connectors module's own
  // public endpoint is the source of truth, never a settings-side table read.
  const done = (accountsQuery.data?.accounts.length ?? 0) > 0;

  return (
    <section className="onb-step" aria-labelledby="member-connector-title">
      <p className="onb-eyebrow">Step 2 · Optional</p>
      <h1 id="member-connector-title" className="onb-title">
        Connect your accounts, if you like.
      </h1>
      <p className="onb-lede">
        Optional. Connecting Google lets me read your calendar for context and watch email for
        things worth turning into tasks.
      </p>
      {done ? (
        <p className="form-hint">Connected. You can connect more accounts in Settings later.</p>
      ) : (
        <ConnectGooglePanel />
      )}
      <button className="ghost-button" type="button" onClick={props.onSkipStep}>
        {done ? "Continue" : "Skip for now"}
      </button>
    </section>
  );
}
