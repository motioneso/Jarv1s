import { createContext, useContext } from "react";

import type { AssistantRecordV1 } from "./contracts";

export interface AssistantSurfaceHostValue {
  readonly records: readonly AssistantRecordV1[];
  readonly registerComposer: (acceptDraft: (draft: string) => void) => () => void;
  readonly subscribeRecords: (
    listener: (records: readonly AssistantRecordV1[]) => void
  ) => () => void;
}

const AssistantSurfaceHostContext = createContext<AssistantSurfaceHostValue | null>(null);

export const AssistantSurfaceHostProvider = AssistantSurfaceHostContext.Provider;

export function useAssistantSurfaceHost(): AssistantSurfaceHostValue {
  const value = useContext(AssistantSurfaceHostContext);
  if (!value) throw new Error("AssistantSurface must be rendered inside AppShell");
  return value;
}
