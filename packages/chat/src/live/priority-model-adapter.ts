import type { DataContextRunner } from "@jarv1s/db";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

import { readPriorityModel, type PriorityPreferenceReader } from "../priority-consumer.js";

export interface ChatPriorityModelAdapterDeps {
  readonly dataContext: Pick<DataContextRunner, "withDataContext">;
  readonly preferencesRepository: PriorityPreferenceReader;
}

/**
 * Reads the user's priority model (`priority.model.v1`) inside a data context so
 * ChatSessionManager can reorder already-loaded cross-tool evidence. Read-only;
 * never triggers source reads.
 */
export class ChatPriorityModelAdapter {
  constructor(private readonly deps: ChatPriorityModelAdapterDeps) {}

  async getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> {
    return this.deps.dataContext.withDataContext(
      { actorUserId, requestId: "chat:priority-model" },
      async (scopedDb) => readPriorityModel(scopedDb, this.deps.preferencesRepository)
    );
  }
}
