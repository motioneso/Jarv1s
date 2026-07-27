import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult, ToolServices } from "@jarv1s/module-sdk";

import type { NotificationPreferenceWriteService } from "./notification-preference-application.js";

function narrowNotificationPreferenceWrite(
  services: ToolServices | undefined
): NotificationPreferenceWriteService {
  const service = (services ?? {}).notificationPreferenceWrite;
  if (
    !service ||
    typeof (service as NotificationPreferenceWriteService).setEnabled !== "function"
  ) {
    throw new Error("notificationPreferenceWrite service is not available");
  }
  return service as NotificationPreferenceWriteService;
}

export const notificationPreferenceSetEnabledInputSchema = {
  type: "object",
  properties: {
    moduleId: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    clearUnread: { type: "boolean" }
  },
  required: ["moduleId", "enabled"],
  additionalProperties: false
} as const;

export const notificationPreferenceSetEnabledOutputSchema = {
  type: "object",
  properties: {
    moduleId: { type: "string" },
    moduleName: { type: "string" },
    enabled: { type: "boolean" },
    message: { type: "string" }
  },
  required: ["moduleId", "moduleName", "enabled", "message"],
  additionalProperties: false
} as const;

export const notificationPreferenceSetEnabledExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const service = narrowNotificationPreferenceWrite(services);
  const { moduleId, enabled, clearUnread } = input as {
    moduleId: string;
    enabled: boolean;
    clearUnread?: boolean;
  };
  const { preference } = await service.setEnabled(
    scopedDb,
    ctx.actorUserId,
    moduleId,
    enabled,
    clearUnread === true
  );
  const message = `${enabled ? "Turned on" : "Turned off"} notifications for ${preference.moduleName}.`;
  return {
    data: {
      moduleId: preference.moduleId,
      moduleName: preference.moduleName,
      enabled: preference.enabled,
      message
    }
  };
};
