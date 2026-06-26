import { assertDataContextDb, type EmailMessage } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { emailMessageDtoSchema, nullableStringSchema } from "@jarv1s/shared";

import { EmailRepository } from "./repository.js";
import { serializeEmailMessage } from "./routes.js";

const repository = new EmailRepository();

export const emailToolMessageOutputSchema = {
  ...emailMessageDtoSchema,
  required: [...emailMessageDtoSchema.required, "connectorAccountId"],
  properties: {
    ...emailMessageDtoSchema.properties,
    connectorAccountId: { type: "string" },
    threadId: nullableStringSchema,
    connectorLabel: nullableStringSchema
  }
} as const;

export const emailListVisibleMessagesExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const messages = await repository.listVisibleForBriefing(scopedDb);
  return { data: { messages: messages.map(serializeEmailToolMessage) } };
};

function serializeEmailToolMessage(message: EmailMessage) {
  const base = serializeEmailMessage(message);
  const md: Record<string, unknown> =
    message.external_metadata != null && typeof message.external_metadata === "object"
      ? (message.external_metadata as Record<string, unknown>)
      : {};
  return {
    ...base,
    connectorAccountId: message.connector_account_id,
    threadId: typeof md.threadId === "string" ? md.threadId : null,
    connectorLabel: typeof md.connectorLabel === "string" ? md.connectorLabel : null
  };
}
