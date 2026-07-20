import type { ComponentType, ReactNode } from "react";

import type { ChatRecordKind, TranscriptRecord } from "../use-chat-stream";

export type ReactNodeLike = ReactNode;
export type AssistantRecordV1 = TranscriptRecord;

export interface LocalRow {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly content: ReactNodeLike;
}

export interface AssistantSurfaceViewProps {
  readonly localRows?: readonly LocalRow[];
  readonly activeControl?: ReactNodeLike;
  readonly recordKinds?: readonly ChatRecordKind[];
  readonly composer?: {
    readonly placeholder?: string;
    readonly onSubmitText?: (text: string) => "handled" | "send";
  };
  readonly typing?: boolean;
}

export interface AssistantSurfaceHandleV1 {
  readonly Surface: ComponentType<AssistantSurfaceViewProps>;
  seedOnboarding(): Promise<{ ok: boolean }>;
  submitTurn(input: {
    readonly text: string;
    readonly controlContext?: Record<string, unknown>;
    readonly attachmentIds?: readonly string[];
  }): Promise<void>;
  uploadAttachment(file: File): Promise<{ id: string; fileName: string; sizeBytes: number }>;
  subscribeRecords(listener: (records: readonly AssistantRecordV1[]) => void): () => void;
}
