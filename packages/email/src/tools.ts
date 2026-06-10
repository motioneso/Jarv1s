import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { EmailRepository } from "./repository.js";
import { serializeEmailMessage } from "./routes.js";

const repository = new EmailRepository();

export const emailListVisibleMessagesExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const messages = await repository.listVisible(scopedDb);
  return { data: { messages: messages.map(serializeEmailMessage) } };
};
