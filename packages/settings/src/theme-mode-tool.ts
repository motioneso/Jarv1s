import { randomUUID } from "node:crypto";

import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { settingsUndoStack } from "./undo-stack.js";

// Matches themes-routes.ts's COLOR_MODE_KEY exactly — both read/write the same preference row.
const COLOR_MODE_KEY = "themes.color-mode";

const preferences = new PreferencesRepository();

export const themeModeSetInputSchema = {
  type: "object",
  properties: { mode: { type: "string", enum: ["light", "dark"] } },
  required: ["mode"],
  additionalProperties: false
} as const;

export const themeModeSetOutputSchema = {
  type: "object",
  properties: { mode: { type: "string", enum: ["light", "dark"] } },
  required: ["mode"],
  additionalProperties: false
} as const;

export const themeModeSetExecute: ToolExecute = async (
  scopedDb,
  input,
  ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const { mode } = input as { mode: "light" | "dark" };
  const current = await preferences.getWithRevision(scopedDb, COLOR_MODE_KEY);
  if (current && current.value === mode) {
    return { data: { mode } };
  }
  const written = await preferences.upsertWithRevision(
    scopedDb,
    COLOR_MODE_KEY,
    mode,
    current?.revision ?? null
  );
  settingsUndoStack.push(ctx.actorUserId, ctx.chatSessionId, {
    mutationId: randomUUID(),
    key: COLOR_MODE_KEY,
    previousValue: current?.value ?? null,
    previousRevision: current?.revision ?? null,
    resultingRevision: written.revision,
    appliedAt: Date.now()
  });
  return { data: { mode } };
};
