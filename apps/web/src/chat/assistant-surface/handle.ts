import { seedModuleOnboarding, sendChatTurn, uploadChatAttachment } from "../../api/client";
import type { ChatSurface } from "@jarv1s/shared";

import type { AssistantSurfaceHandleV1, AssistantSurfaceViewProps } from "./contracts";
import { AssistantSurface } from "./surface";

/** #1196 — build one AssistantSurface handle whose module id is fixed by the host mount. */
export function createAssistantSurfaceHandle(
  moduleId: string,
  subscribeRecords: AssistantSurfaceHandleV1["subscribeRecords"],
  surface?: string,
  seedComposer?: (draft: string) => void
): AssistantSurfaceHandleV1 {
  const scopedSurface = surface as ChatSurface | undefined;
  const Surface = surface
    ? (props: AssistantSurfaceViewProps) => AssistantSurface({ ...props, surface })
    : AssistantSurface;
  return {
    Surface,
    seedOnboarding: () => seedModuleOnboarding(moduleId, scopedSurface),
    seedComposer: (draft) => seedComposer?.(draft),
    async submitTurn(input) {
      await sendChatTurn(input.text, input.attachmentIds, input.controlContext, scopedSurface);
    },
    async uploadAttachment(file) {
      const { attachment } = await uploadChatAttachment(file, file.name);
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        sizeBytes: attachment.sizeBytes
      };
    },
    subscribeRecords: surface ? (listener) => subscribeRecords(listener, surface) : subscribeRecords
  };
}
