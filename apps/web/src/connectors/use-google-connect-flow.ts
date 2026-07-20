import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { authorizeGoogleConnection, completeGoogleConnection } from "../api/client";
import { queryKeys } from "../api/query-keys";

interface GoogleConnectFlowOptions {
  readonly onAuthorizationReady?: () => void;
  readonly onConnected?: () => void;
  readonly onError?: (message: string) => void;
}

/**
 * Query keys to invalidate after a successful Google connect. `connectors.done` (which the
 * onboarding Finish recap reads) is derived server-side from "a connector account exists", so
 * a successful connect must refresh BOTH the accounts list AND the onboarding status — else the
 * recap wrongly reports the connector step as "skipped" after it was just connected.
 */
export const GOOGLE_CONNECT_SUCCESS_QUERY_KEYS = [
  queryKeys.connectors.accounts,
  queryKeys.onboarding.status
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function useGoogleConnectFlow(options: GoogleConnectFlowOptions = {}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const consentPopupRef = useRef<Window | null>(null);

  const authorizeMutation = useMutation({
    mutationFn: () =>
      authorizeGoogleConnection({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: (response) => {
      setAuthUrl(response.authUrl);
      setError(null);
      options.onAuthorizationReady?.();
      const popup = consentPopupRef.current;
      if (popup && !popup.closed) {
        popup.location.href = response.authUrl;
      }
    },
    onError: (cause) => {
      const message = errorMessage(cause);
      setError(message);
      options.onError?.(message);
      const popup = consentPopupRef.current;
      if (popup && !popup.closed) {
        popup.close();
      }
      consentPopupRef.current = null;
    }
  });

  /**
   * One-click consent: `window.open` must run synchronously inside the click handler or
   * browsers treat the popup as unrequested and block it — it cannot wait for `authUrl` to
   * resolve first (that was the prior two-click flow). Open a blank popup immediately, then
   * navigate it once the real URL comes back from authorizeMutation's onSuccess above.
   */
  const openConsentScreen = () => {
    setError(null);
    setPopupBlocked(false);
    const popup = window.open("about:blank", "jarvis-google-consent");
    if (!popup) {
      setPopupBlocked(true);
      consentPopupRef.current = null;
    } else {
      consentPopupRef.current = popup;
    }
    authorizeMutation.mutate();
  };

  const completeMutation = useMutation({
    mutationFn: () => completeGoogleConnection({ redirectUrl: redirectUrl.trim() }),
    onSuccess: async () => {
      setAuthUrl(null);
      setRedirectUrl("");
      setClientId("");
      setClientSecret("");
      setError(null);
      await Promise.all(
        GOOGLE_CONNECT_SUCCESS_QUERY_KEYS.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      );
      options.onConnected?.();
    },
    onError: (cause) => {
      const message = errorMessage(cause);
      setError(message);
      options.onError?.(message);
    }
  });

  return {
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    authUrl,
    redirectUrl,
    setRedirectUrl,
    error,
    startAuthorization: () => authorizeMutation.mutate(),
    openConsentScreen,
    popupBlocked,
    finishConnection: () => completeMutation.mutate(),
    authorizationPending: authorizeMutation.isPending,
    completionPending: completeMutation.isPending
  };
}
