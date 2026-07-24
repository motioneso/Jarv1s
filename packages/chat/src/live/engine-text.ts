/**
 * Build the engine-bound text for one turn: folds passive-retrieval / cross-tool-reasoning
 * hidden context ahead of the raw user text. Extracted from ChatSessionManager so the
 * (already substantial) retrieval orchestration lives in its own module rather than
 * growing the manager class further.
 */
import type { AnswerSourceSupport, ChatSurface } from "@jarv1s/shared";
import type { MemoryRecallItem } from "@jarv1s/memory";
import type { PriorityModelPreferenceV1 } from "@jarv1s/priority";

import { crossToolItemToSupport, memoryItemToSupport } from "./answer-provenance.js";
import type { ChatPersistencePort, PassiveRetrievalPort } from "./chat-session-manager.js";
import {
  collectCrossToolContextAndItems,
  planCrossToolReasoning,
  renderCrossToolContextBlock,
  type CrossToolReadRunner
} from "./cross-tool-reasoning.js";
import { rankChatContext, reorderByPriority } from "../priority-consumer.js";
import { combineHiddenContextBlocks } from "./chat-session-manager.js";

export interface EngineTextDeps {
  readonly persistence: Pick<ChatPersistencePort, "listPriorTurns" | "getThreadContext">;
  readonly passiveRetrieval?: PassiveRetrievalPort;
  readonly crossToolRead?: CrossToolReadRunner;
  readonly priorityModel?: { getModel(actorUserId: string): Promise<PriorityModelPreferenceV1> };
}

export async function buildEngineText(
  deps: EngineTextDeps,
  actorUserId: string,
  text: string,
  surface?: ChatSurface
): Promise<{ text: string; pendingItems: AnswerSourceSupport[] }> {
  if (!deps.passiveRetrieval && !deps.crossToolRead) {
    return { text, pendingItems: [] };
  }
  try {
    const [{ recent }, threadCtx] = await Promise.all([
      deps.persistence.listPriorTurns(actorUserId, undefined, surface),
      deps.persistence.getThreadContext(actorUserId, surface)
    ]);

    const localNow = new Date().toISOString();
    const plan =
      deps.crossToolRead != null
        ? planCrossToolReasoning({
            userText: text,
            threadTitle: threadCtx.threadTitle,
            recentTurns: recent,
            localNowIso: localNow,
            localTimezone: threadCtx.localTimezone ?? "UTC"
          })
        : null;

    const [passiveResult, crossToolResult] = await Promise.all([
      deps.passiveRetrieval != null
        ? (deps.passiveRetrieval.retrieveWithItems != null
            ? deps.passiveRetrieval.retrieveWithItems({
                actorUserId,
                userText: text,
                threadTitle: threadCtx.threadTitle,
                recentTurns: recent
              })
            : deps.passiveRetrieval
                .retrieve({
                  actorUserId,
                  userText: text,
                  threadTitle: threadCtx.threadTitle,
                  recentTurns: recent
                })
                .then((block) => ({ block, items: [] as MemoryRecallItem[] }))
          ).catch(() => ({ block: "", items: [] as MemoryRecallItem[] }))
        : Promise.resolve({ block: "", items: [] as MemoryRecallItem[] }),
      plan != null && deps.crossToolRead != null
        ? collectCrossToolContextAndItems(
            actorUserId,
            plan,
            deps.crossToolRead,
            localNow,
            threadCtx.localTimezone ?? "UTC"
          ).catch(() => ({ block: "", items: [] }))
        : Promise.resolve({ block: "", items: [] })
    ]);

    let crossTool = crossToolResult;
    if (deps.priorityModel && crossTool.items.length > 0) {
      try {
        const model = await deps.priorityModel.getModel(actorUserId);
        const ranked = rankChatContext(
          crossTool.items.map(({ source, title, summary, dueAt, startsAt }) => ({
            source,
            title,
            summary,
            dueAt,
            startsAt,
            textForAnchorMatch: [title, summary]
          })),
          model,
          localNow,
          threadCtx.localTimezone ?? "UTC"
        );
        const reordered = reorderByPriority(crossTool.items, ranked);
        crossTool = { block: renderCrossToolContextBlock(reordered), items: reordered };
      } catch {
        crossTool = crossToolResult;
      }
    }

    let idx = 0;
    const memoryItems = passiveResult.items.map((item) => memoryItemToSupport(item, idx++));
    const crossToolItems = crossTool.items.map((item) => crossToolItemToSupport(item, idx++));
    const pendingItems: AnswerSourceSupport[] = [...memoryItems, ...crossToolItems];

    const combined = combineHiddenContextBlocks(passiveResult.block, crossTool.block);
    return { text: combined ? `${combined}\n\n${text}` : text, pendingItems };
  } catch {
    return { text, pendingItems: [] };
  }
}
