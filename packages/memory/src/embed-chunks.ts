import { createHash } from "node:crypto";

import type { EmbeddingProvider } from "./embedding-provider.js";
import type { TextChunk } from "./parser.js";
import type { NewChunkData } from "./repository.js";

/**
 * How many chunks of one document may be embedded at the same time.
 *
 * #1357: both ingest paths used to embed every chunk of a file with a bare
 * `Promise.all(chunks.map(...))`, so a 200-chunk document fired 200 simultaneous inferences. The
 * embedding runtime allocates scratch buffers per in-flight inference and grows its arena to the
 * high-water mark of that concurrency — an arena it never returns to the OS. A bound is worth
 * having: it makes peak memory a function of the cap rather than of document length.
 *
 * It bought no throughput either: embedding is CPU-bound and runs in one process, so the concurrent
 * calls were queueing behind each other anyway. Four keeps the cores busy while capping the arena.
 *
 * **This was NOT the cause of the ~15.5 GB production worker**, though #1357 claimed it was. That
 * turned out to be a single inference running at the model's 8192-token window (~6.8 GB per call,
 * self-attention being quadratic); see #1359 and `EMBED_MAX_TOKENS` in local-embedding-provider.ts.
 * The refutation was visible in the paragraph above all along — if the calls serialize, capping how
 * many may run at once cannot lower peak memory.
 */
export const EMBED_CONCURRENCY = 4;

/**
 * Embed every chunk of one document, at most `concurrency` at a time, preserving input order.
 *
 * Order matters: callers persist the result alongside line ranges, and a reordered array would
 * attach embeddings to the wrong lines.
 */
export async function embedChunks(
  embeddingProvider: EmbeddingProvider,
  chunks: readonly TextChunk[],
  sourcePath: string,
  concurrency: number = EMBED_CONCURRENCY
): Promise<NewChunkData[]> {
  const results: NewChunkData[] = new Array<NewChunkData>(chunks.length);
  const limit = Math.max(1, Math.min(concurrency, chunks.length));
  let next = 0;

  // Each worker pulls the next unclaimed index until the document is exhausted, so a slow chunk
  // never idles the others and no more than `limit` inferences are ever in flight.
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      const chunk = chunks[index];
      // Undefined means we ran past the end — every chunk has been claimed, so this worker is done.
      if (chunk === undefined) return;
      results[index] = {
        sourcePath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        contentHash: createHash("sha256").update(chunk.text).digest("hex"),
        text: chunk.text,
        embedding: await embeddingProvider.embedDocument(chunk.text)
      };
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
