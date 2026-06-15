import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authorizeGoogleConnection, completeGoogleConnection } from "../api/client";
import { queryKeys } from "../api/query-keys";

interface GoogleConnectFlowOptions {
  readonly onAuthorizationReady?: () => void;
  readonly onConnected?: () => void;
  readonly onError?: (message: string) => void;
}

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

  const authorizeMutation = useMutation({
    mutationFn: () =>
      authorizeGoogleConnection({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: (response) => {
      setAuthUrl(response.authUrl);
      setError(null);
      options.onAuthorizationReady?.();
    },
    onError: (cause) => {
      const message = errorMessage(cause);
      setError(message);
      options.onError?.(message);
    }
  });

  const completeMutation = useMutation({
    mutationFn: () => completeGoogleConnection({ redirectUrl: redirectUrl.trim() }),
    onSuccess: async () => {
      setAuthUrl(null);
      setRedirectUrl("");
      setClientId("");
      setClientSecret("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.connectors.accounts });
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
    finishConnection: () => completeMutation.mutate(),
    authorizationPending: authorizeMutation.isPending,
    completionPending: completeMutation.isPending
  };
}
