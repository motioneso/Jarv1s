import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import { CommitmentsRepository } from "./commitments-repository.js";

const repository = new CommitmentsRepository();

export const commitmentsListVisibleExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const commitments = await repository.listVisible(scopedDb);
  return {
    data: {
      commitments: commitments.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        counterparty: c.counterparty,
        dueAt: c.due_at instanceof Date ? c.due_at.toISOString() : c.due_at
      }))
    }
  };
};
