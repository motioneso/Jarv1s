import { assertDataContextDb } from "@moss/db";
import type { ToolExecute, ToolResult } from "@moss/module-sdk";

import { NotificationsRepository } from "./repository.js";
import { serializeNotification } from "./routes.js";

const repository = new NotificationsRepository();

export const notificationsListVisibleExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const result = await repository.listVisible(scopedDb);
  return {
    data: {
      notifications: result.notifications.map(serializeNotification),
      unreadCount: result.unreadCount
    }
  };
};
