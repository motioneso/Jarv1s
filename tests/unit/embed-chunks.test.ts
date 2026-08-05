import { describe, expect, it } from "vitest";

import { embedChunks, EMBED_CONCURRENCY } from "../../packages/memory/src/embed-chunks.js";
import type { EmbeddingProvider } from "../../packages/memory/src/embedding-provider.js";
import type { TextChunk } from "../../packages/memory/src/parser.js";

/**
 * #1357: both ingest paths embedded every chunk of a document with a bare `Promise.all(map(...))`.
 * A 200-chunk file therefore had 200 inferences in flight at once, and the embedding runtime's
 * scratch arena grew to that high-water mark and never gave the memory back — the prod worker sat
 * at ~15.5 GB. These tests pin the concurrency ceiling and the ordering it must not break.
 */

/** Records peak simultaneous in-flight calls, and lets each call be released on demand. */
function makeProvider(): {
  provider: EmbeddingProvider;
  peakInFlight: () => number;
  callOrder: () => string[];
} {
  let inFlight = 0;
  let peak = 0;
  const order: string[] = [];

  const provider: EmbeddingProvider = {
    dimensions: 3,
    modelName: "test-model",
    modelVersion: "1",
    async embedDocument(text: string): Promise<number[]> {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      order.push(text);
      // Yield across several microtask ticks so overlapping calls actually overlap.
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [text.length, 0, 0];
    },
    async embedQuery(text: string): Promise<number[]> {
      return [text.length, 0, 0];
    }
  };

  return { provider, peakInFlight: () => peak, callOrder: () => order };
}

const chunk = (n: number): TextChunk => ({
  text: `chunk-${n}`,
  lineStart: n * 10,
  lineEnd: n * 10 + 9
});

describe("embedChunks concurrency bound (#1357)", () => {
  it("never runs more than the ceiling of inferences at once", async () => {
    const { provider, peakInFlight } = makeProvider();
    const chunks = Array.from({ length: 50 }, (_, i) => chunk(i));

    await embedChunks(provider, chunks, "notes/big.md");

    expect(peakInFlight()).toBeLessThanOrEqual(EMBED_CONCURRENCY);
    expect(peakInFlight()).toBeGreaterThan(1);
  });

  it("honours an explicit concurrency argument", async () => {
    const { provider, peakInFlight } = makeProvider();
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(i));

    await embedChunks(provider, chunks, "notes/big.md", 2);

    expect(peakInFlight()).toBe(2);
  });

  it("keeps results in document order so embeddings match their line ranges", async () => {
    const { provider } = makeProvider();
    const chunks = Array.from({ length: 12 }, (_, i) => chunk(i));

    const result = await embedChunks(provider, chunks, "notes/big.md");

    expect(result).toHaveLength(12);
    expect(result.map((r) => r.text)).toEqual(chunks.map((c) => c.text));
    expect(result.map((r) => r.lineStart)).toEqual(chunks.map((c) => c.lineStart));
    expect(result.every((r) => r.sourcePath === "notes/big.md")).toBe(true);
  });

  it("embeds every chunk exactly once", async () => {
    const { provider, callOrder } = makeProvider();
    const chunks = Array.from({ length: 30 }, (_, i) => chunk(i));

    await embedChunks(provider, chunks, "notes/big.md");

    expect(callOrder()).toHaveLength(30);
    expect(new Set(callOrder()).size).toBe(30);
  });

  it("hashes chunk text, not the whole document", async () => {
    const { provider } = makeProvider();

    const [first, second] = await embedChunks(provider, [chunk(0), chunk(1)], "notes/big.md");

    expect(first?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.contentHash).not.toBe(second?.contentHash);
  });

  it("handles an empty document without spawning workers", async () => {
    const { provider, peakInFlight } = makeProvider();

    const result = await embedChunks(provider, [], "notes/empty.md");

    expect(result).toEqual([]);
    expect(peakInFlight()).toBe(0);
  });
});
