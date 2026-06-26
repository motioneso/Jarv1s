import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { RuntimeConfigResolver } from "@jarv1s/settings";
import {
  createEmbeddingProvider,
  getEmbeddingProviderConfig,
  type EmbeddingProviderConfig,
  MemoryRepository,
  MemoryRetriever
} from "@jarv1s/memory";

const NOTES_SOURCE_KIND = "notes";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

let retrieverCache: { key: string; retriever: MemoryRetriever } | undefined;

function embeddingConfigCacheKey(config: EmbeddingProviderConfig): string {
  return `${config.kind}:${config.modelId ?? ""}`;
}

async function getRetriever(scopedDb: DataContextDb): Promise<MemoryRetriever> {
  const config = await getEmbeddingProviderConfig(new RuntimeConfigResolver(scopedDb));
  const key = embeddingConfigCacheKey(config);
  if (retrieverCache?.key !== key) {
    retrieverCache = {
      key,
      retriever: new MemoryRetriever(createEmbeddingProvider(config), new MemoryRepository())
    };
  }
  return retrieverCache.retriever;
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

  const retriever = await getRetriever(scopedDb);
  const chunks = await retriever.retrieve(scopedDb, query, limit, NOTES_SOURCE_KIND);
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
