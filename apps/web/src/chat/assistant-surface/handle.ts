import { seedModuleOnboarding, sendChatTurn, uploadChatAttachment } from "../../api/client";
import type { AssistantSurfaceHandleV1 } from "./contracts";
import { AssistantSurface } from "./surface";

/** #1196 — build one AssistantSurface handle whose module id is fixed by the host mount. */
export function createAssistantSurfaceHandle(
  moduleId: string,
  subscribeRecords: AssistantSurfaceHandleV1["subscribeRecords"]
): AssistantSurfaceHandleV1 {
  return {
    Surface: AssistantSurface,
    seedOnboarding: () => seedModuleOnboarding(moduleId),
    async submitTurn(input) {
      await sendChatTurn(input.text, input.attachmentIds, input.controlContext);
    },
    async uploadAttachment(file) {
      const { attachment } = await uploadChatAttachment(file, file.name);
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        sizeBytes: attachment.sizeBytes
      };
    },
    subscribeRecords
  };
}
