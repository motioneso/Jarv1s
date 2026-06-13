import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { listAiProviders } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function ApiKeyOptOutStep(props: { readonly onSkipStep: () => void }) {
  // Client-side apiKeyOptOut.done derivation (module isolation): the AI module's own public
  // endpoint is the source of truth — settings/onboarding NEVER reads an AI table directly.
  // "done" means the member has already configured at least one of their own AI providers
  // (i.e. opted IN to a personal key); a member who uses the shared assistant simply skips.
  const providersQuery = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: () => listAiProviders(),
    retry: false
  });
  const done = (providersQuery.data?.providers.length ?? 0) > 0;

  return (
    <section className="panel" aria-labelledby="member-apikey-title">
      <div className="panel-heading">
        <h2 id="member-apikey-title">AI assistant</h2>
      </div>
      {done ? (
        <p className="form-hint">
          You&apos;ve added your own AI provider. You can manage it in Settings anytime.
        </p>
      ) : (
        <p>
          You can use the shared assistant this household already set up — no setup needed. If you
          prefer to use your own API key instead, you can add one in AI settings. This step is
          optional.
        </p>
      )}
      <div className="connect-steps">
        <Link className="primary-button" to="/settings">
          {done ? "Manage my AI provider in Settings" : "Add my own API key in Settings"}
        </Link>
        <button className="ghost-button" type="button" onClick={props.onSkipStep}>
          {done ? "Continue" : "Skip — I'll use the shared assistant"}
        </button>
      </div>
    </section>
  );
}
