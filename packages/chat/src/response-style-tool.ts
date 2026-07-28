import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";
import {
  CHAT_RESPONSE_STYLES,
  CHAT_SETTINGS_PREFERENCE_KEY,
  normalizeChatSettings,
  type ChatResponseStyle
} from "@jarv1s/shared";

// Matches routes.ts's chat settings GET/PUT — both read/write the same preference row.
const preferences = new PreferencesRepository();

export const chatSetResponseStyleInputSchema = {
  type: "object",
  properties: { style: { type: "string", enum: [...CHAT_RESPONSE_STYLES] } },
  required: ["style"],
  additionalProperties: false
} as const;

export const chatSetResponseStyleOutputSchema = {
  type: "object",
  properties: { style: { type: "string", enum: [...CHAT_RESPONSE_STYLES] } },
  required: ["style"],
  additionalProperties: false
} as const;

export const chatSetResponseStyleExecute: ToolExecute = async (
  scopedDb,
  input
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { style } = input as { style: ChatResponseStyle };
  const current = await preferences.getWithRevision(scopedDb, CHAT_SETTINGS_PREFERENCE_KEY);
  const next = normalizeChatSettings({ responseStyle: style });
  await preferences.upsertWithRevision(
    scopedDb,
    CHAT_SETTINGS_PREFERENCE_KEY,
    next,
    current?.revision ?? null
  );
  return { data: { style: next.responseStyle } };
};
