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
 * high-water mark of that concurrency — an arena it never returns to the OS. The production worker
 * settled at ~15.5 GB of resident memory on a host with 62 GB, one bad document away from the
 * kernel OOM killer taking the container (and every user request with it).
 *
 * Unbounded fan-out never bought throughput either: embedding is CPU-bound and runs in one process,
 * so the concurrent calls were queueing behind each other anyway — they only multiplied peak memory.
 * Four keeps the cores busy while capping the arena.
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
