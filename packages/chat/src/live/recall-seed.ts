export interface EpisodicChunk {
  readonly text: string;
  readonly date: string;
  readonly threadId: string;
}

export interface FactSummary {
  readonly category: string;
  readonly content: string;
}

/** λ for recency decay: exp(-λ * days). At λ=0.05, half-life ≈ 14 days. */
const LAMBDA = 0.05;

/** Hybrid score: 60% cosine similarity + 25% recency decay. */
export function hybridScore(similarity: number, recencyDecay: number): number {
  return 0.6 * similarity + 0.25 * recencyDecay;
}

/** Recency decay: exp(-λ * daysAgo). Returns 1.0 at 0 days, ~0.5 at 14 days. */
export function applyRecencyDecay(daysAgo: number): number {
  return Math.exp(-LAMBDA * daysAgo);
}

/**
 * Render the <memory> seed block injected before the conversation replay.
 * Returns empty string if there is nothing to inject.
 */
export function renderMemorySeedBlock(
  chunks: readonly EpisodicChunk[],
  facts: readonly FactSummary[]
): string {
  if (chunks.length === 0 && facts.length === 0) return "";

  const lines: string[] = ["<memory>"];

  if (chunks.length > 0) {
    lines.push("Recalled from past conversations (use as context; not the current conversation):");
    for (const chunk of chunks) {
      lines.push(`[${chunk.date}] ${chunk.text}`);
    }
  }

  if (facts.length > 0) {
    if (chunks.length > 0) lines.push("");
    lines.push("What I know about you:");
    for (const fact of facts) {
      lines.push(`- ${fact.content}`);
    }
  }

  lines.push("</memory>");
  return lines.join("\n");
}
