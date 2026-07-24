import { createContext, useContext } from "react";

import type { AssistantRecordV1 } from "./contracts";

export interface AssistantSurfaceHostValue {
  readonly records: readonly AssistantRecordV1[];
  /** #1232 — read the host-owned transcript for a named module surface. */
  readonly recordsForSurface?: (surface: string) => readonly AssistantRecordV1[];
  readonly registerComposer: (acceptDraft: (draft: string) => void) => () => void;
  readonly seedComposer?: (draft: string) => void;
  readonly subscribeRecords: (
    listener: (records: readonly AssistantRecordV1[]) => void,
    surface?: string
  ) => () => void;
}

const AssistantSurfaceHostContext = createContext<AssistantSurfaceHostValue | null>(null);

export const AssistantSurfaceHostProvider = AssistantSurfaceHostContext.Provider;

export function useAssistantSurfaceHost(surface?: string): AssistantSurfaceHostValue {
  const value = useContext(AssistantSurfaceHostContext);
  if (!value) throw new Error("AssistantSurface must be rendered inside AppShell");
  if (!surface || !value.recordsForSurface) return value;
  return { ...value, records: value.recordsForSurface(surface) };
}
