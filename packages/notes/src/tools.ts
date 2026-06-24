import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  MemoryRepository,
  MemoryRetriever
} from "@jarv1s/memory";

const NOTES_SOURCE_KIND = "notes";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

// Read tools receive NO injected services (write->confirm floor), so build the
// retriever from env config here — same factory as the composition root —
// memoized so a local embedding model loads at most once per process.
let retriever: MemoryRetriever | undefined;
function getRetriever(): MemoryRetriever {
  if (!retriever) {
    retriever = new MemoryRetriever(
      createEmbeddingProvider(getEmbeddingProviderConfig()),
      new MemoryRepository()
    );
  }
  return retriever;
}

export const notesSearchExecute: ToolExecute = async (
  scopedDb,
  input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const raw = input as { query?: unknown; limit?: unknown };
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (query.length === 0) {
    return { data: { chunks: [] } };
  }
  const parsedLimit = Number(raw.limit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const chunks = await getRetriever().retrieve(scopedDb, query, limit, NOTES_SOURCE_KIND);
  return {
    data: {
      chunks: chunks.map((c) => ({
        sourcePath: c.sourcePath,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        text: c.text
      }))
    }
  };
};
