import { useQuery } from "@tanstack/react-query";

import { getPersonaSettings } from "./client";
import { queryKeys } from "./query-keys";

// Single source for the user-configured assistant name (Settings → AI persona).
// Falls back to "Jarvis" before the persona query resolves or if it fails, so
// callers can drop it straight into copy like `Chat with {name}`. Kept as a hook
// (not a literal) because the product name is being migrated ahead of release —
// see the ongoing renaming work; this gives one seam to swap in the final name.
export function useAssistantName(): string {
  const query = useQuery({
    queryKey: queryKeys.settings.persona,
    queryFn: getPersonaSettings,
    retry: false
  });
  return query.data?.persona.assistantName?.trim() || "Jarvis";
}
