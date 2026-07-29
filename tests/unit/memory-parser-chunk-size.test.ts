import { describe, expect, it } from "vitest";

import { parseDocument } from "../../packages/memory/src/parser.js";

/**
 * #1359: `## ` headings were the only split point, so a long note without headings became one
 * chunk of arbitrary size. The embedder truncates at 512 tokens and silently drops the remainder,
 * which cost real data in production — 478 note chunks were over the model's ceiling and the
 * largest was 1.25 MB, roughly 96% of it never indexed.
 *
 * These tests pin the two properties that make the embedder's bound safe: no chunk exceeds the
 * budget, and nothing is lost on the way there.
 */

const MAX_CHUNK_CHARS = 2000;

/** Distinct words, so a lossless-round-trip assertion cannot pass on repeated filler. */
function prose(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
}

describe("splitIntoChunks size cap (#1359)", () => {
  it("splits a long heading-free note into chunks within the budget", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}. ${prose(60)}`);
    const { chunks } = parseDocument(paragraphs.join("\n\n"));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("keeps every word, so the bound truncates nothing", () => {
    const body = Array.from({ length: 30 }, (_, i) => `Para ${i}. ${prose(50)}`).join("\n\n");
    const { chunks } = parseDocument(body);

    const roundTripped = chunks.map((c) => c.text).join("\n\n");
    for (const word of body.split(/\s+/)) {
      expect(roundTripped).toContain(word);
    }
  });

  it("splits an oversized section at paragraph boundaries, not mid-sentence", () => {
    // Two paragraphs that each fit but together do not: the cut must land between them.
    const first = `Alpha. ${prose(180)}`;
    const second = `Beta. ${prose(180)}`;
    const { chunks } = parseDocument(`${first}\n\n${second}`);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe(first);
    expect(chunks[1]?.text).toBe(second);
  });

  it("still cuts a single paragraph that is itself over budget", () => {
    const { chunks } = parseDocument(prose(900));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it("cuts a single unbroken line with no whitespace to split on", () => {
    // The pathological case: a minified blob or a pasted spreadsheet row.
    const { chunks } = parseDocument("x".repeat(MAX_CHUNK_CHARS * 3 + 17));

    expect(chunks).toHaveLength(4);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    expect(chunks.map((c) => c.text).join("")).toBe("x".repeat(MAX_CHUNK_CHARS * 3 + 17));
  });

  it("never emits an empty chunk, which the embedder rejects outright", () => {
    const { chunks } = parseDocument(`${prose(200)}\n\n\n\n\n\n${prose(200)}`);

    for (const chunk of chunks) {
      expect(chunk.text.trim()).not.toBe("");
    }
  });

  it("leaves short documents chunked exactly as before", () => {
    const { chunks } = parseDocument("---\ntitle: t\n---\n\n## One\nalpha\n\n## Two\nbeta\n");

    expect(chunks.map((c) => c.text)).toEqual(["## One\nalpha", "## Two\nbeta"]);
  });

  it("gives each part of a split section its own ascending line range", () => {
    const body = Array.from({ length: 12 }, (_, i) => `Para ${i}. ${prose(60)}`).join("\n\n");
    const { chunks } = parseDocument(`## Heading\n\n${body}`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.lineEnd).toBeGreaterThanOrEqual(chunk.lineStart);
    }
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.lineStart).toBeGreaterThan(chunks[i - 1]!.lineStart);
    }
  });
});
