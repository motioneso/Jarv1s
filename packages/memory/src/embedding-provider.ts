import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;

  async embed(text: string): Promise<number[]> {
    const hash = createHash("sha256").update(text).digest();
    return Array.from({ length: this.dimensions }, (_, i) => {
      const byte = hash[i % hash.length] ?? 0;
      return (byte / 255) * 2 - 1;
    });
  }
}
