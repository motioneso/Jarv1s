import { createHash } from "node:crypto";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import { MemoryRepository } from "@jarv1s/memory";
import type {
  ProactiveMonitorInput,
  ProactiveMonitorPriorityAnchor,
  ProactiveMonitorProvider,
  ProactiveMonitorResult,
  ProactiveMonitorSignal
} from "@jarv1s/module-sdk";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** How far back to look for recently-ingested note changes. */
const LOOKBACK_HOURS = 72;

/**
 * Check if text contains an anchor label or alias as a whole word or tag (#alias).
 * Per spec §5: case-insensitive whole-word match, or #tag match.
 */
function matchesAnchor(
  text: string,
  anchors: readonly ProactiveMonitorPriorityAnchor[]
): { matched: boolean; matchedLabel: string | null } {
  const normalized = text.toLowerCase();
  for (const anchor of anchors) {
    const terms = [anchor.label, ...anchor.aliases];
    for (const term of terms) {
      if (!term) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase();
      const wordPattern = new RegExp(`(?:^|\\s|#)${escaped}(?:\\s|$|[,;.!?])`, "i");
      if (wordPattern.test(normalized)) {
        return { matched: true, matchedLabel: anchor.label };
      }
    }
  }
  return { matched: false, matchedLabel: null };
}

export const notesMonitorProvider: ProactiveMonitorProvider = {
  source: "notes",
  moduleId: "notes",

  async collectSignals(
    scopedDb: unknown,
    input: ProactiveMonitorInput
  ): Promise<ProactiveMonitorResult> {
    assertDataContextDb(scopedDb as DataContextDb);
    const db = scopedDb as DataContextDb;

    if (input.priorityAnchors.length === 0) {
      return { signals: [], nextCursor: { checkedAt: input.now } };
    }

    const now = new Date(input.now);
    const lookback = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

    const memoryRepo = new MemoryRepository();
    const recentFiles = await memoryRepo.listRecentVaultFiles(db, lookback, 50, 5);

    if (recentFiles.length === 0) {
      return { signals: [], nextCursor: { checkedAt: input.now } };
    }

    const signals: ProactiveMonitorSignal[] = [];

    for (const file of recentFiles) {
      if (signals.length >= input.maxSignals) break;

      if (file.chunks.length === 0) continue;

      const fullText = file.chunks.map((c) => c.text).join(" ");
      const { matched, matchedLabel } = matchesAnchor(fullText, input.priorityAnchors);
      if (!matched) continue;

      const noteTitle = file.sourcePath.split("/").pop()?.replace(/\.md$/i, "") ?? file.sourcePath;
      const stableKey = `note-changed:${stableHash(file.sourcePath)}`;
      const ingestedAt = file.ingestedAt.toISOString();

      signals.push({
        source: "notes",
        stableKey,
        sourceRefHash: stableHash(file.sourcePath),
        signalType: "priority_anchor_changed",
        title: noteTitle,
        summary: `Note matching "${matchedLabel}" was recently updated`,
        occurredAt: ingestedAt,
        priorityCandidate: {
          relevanceReasons: matchedLabel ? [`matches anchor: ${matchedLabel}`] : []
        }
      });
    }

    return { signals, nextCursor: { checkedAt: input.now } };
  }
};
