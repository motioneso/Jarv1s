import { createHash } from "node:crypto";

import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
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

    // Find recently ingested vault notes.
    const recentFiles = await db.db
      .selectFrom("app.memory_file_index")
      .select(["source_path", "ingested_at", "file_hash"])
      .where("source_kind", "=", "vault")
      .where("ingested_at", ">=", lookback)
      .orderBy("ingested_at", "desc")
      .limit(50)
      .execute();

    if (recentFiles.length === 0) {
      return { signals: [], nextCursor: { checkedAt: input.now } };
    }

    const signals: ProactiveMonitorSignal[] = [];

    for (const file of recentFiles) {
      if (signals.length >= input.maxSignals) break;

      // Load first chunks to check for anchor matches.
      const chunks = await db.db
        .selectFrom("app.memory_chunks")
        .select(["text", "line_start", "updated_at"])
        .where("source_kind", "=", "vault")
        .where("source_path", "=", file.source_path)
        .orderBy("line_start", "asc")
        .limit(5)
        .execute();

      if (chunks.length === 0) continue;

      const fullText = chunks.map((c) => c.text).join(" ");
      const { matched, matchedLabel } = matchesAnchor(fullText, input.priorityAnchors);
      if (!matched) continue;

      const noteTitle =
        file.source_path.split("/").pop()?.replace(/\.md$/i, "") ?? file.source_path;
      const stableKey = `note-changed:${stableHash(file.source_path)}`;
      const ingestedAt = new Date(file.ingested_at as unknown as string).toISOString();

      signals.push({
        source: "notes",
        stableKey,
        sourceRefHash: stableHash(file.source_path),
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
