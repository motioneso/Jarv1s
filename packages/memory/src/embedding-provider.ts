import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  readonly modelVersion: string;
  /** Embed a document for indexing. The provider applies any required task prefix. */
  embedDocument(text: string): Promise<number[]>;
  /** Embed a search query. The provider applies any required task prefix. */
  embedQuery(text: string): Promise<number[]>;
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName = "stub";
  readonly modelVersion = "0";

  async embedDocument(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  private hashEmbed(text: string): number[] {
    const hash = createHash("sha256").update(text).digest();
    return Array.from({ length: this.dimensions }, (_, i) => {
      const byte = hash[i % hash.length] ?? 0;
      return (byte / 255) * 2 - 1;
    });
  }
}
