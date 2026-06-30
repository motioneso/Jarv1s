import { assertDataContextDb, type EmailMessage } from "@jarv1s/db";
import type { ToolExecute, ToolResult, ToolServices } from "@jarv1s/module-sdk";
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

// Structural interface — no @jarv1s/connectors import (module isolation).
interface FeatureGrantService {
  grantedAccountIds(
    scopedDb: Parameters<ToolExecute>[0],
    feature: "email" | "calendar"
  ): Promise<ReadonlySet<string>>;
}

function narrowFeatureGrants(services: ToolServices | undefined): FeatureGrantService {
  const svc = (services ?? {}).featureGrants as FeatureGrantService | undefined;
  if (!svc || typeof svc.grantedAccountIds !== "function") {
    throw new Error("featureGrants service is not available");
  }
  return svc;
}

export const emailListVisibleMessagesExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx,
  services
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const featureGrants = narrowFeatureGrants(services);
  const grantedIds = await featureGrants.grantedAccountIds(scopedDb, "email");
  const messages = await repository.listVisibleForBriefing(scopedDb);
  const filtered = messages.filter((m) => grantedIds.has(m.connector_account_id));
  return { data: { messages: filtered.map(serializeEmailToolMessage) } };
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
