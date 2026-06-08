import { pipeline } from "@huggingface/transformers";

import type { EmbeddingProvider } from "./embedding-provider.js";

const DEFAULT_MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";

/** Minimal callable shape we need from the feature-extraction pipeline. */
interface ExtractPipe {
  (text: string, options: Record<string, unknown>): Promise<{ data: Float32Array }>;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName: string;
  readonly modelVersion = "1.5";

  private pipe: ExtractPipe | null = null;

  constructor(modelId: string = DEFAULT_MODEL_ID) {
    this.modelName = modelId;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.run("search_document", text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.run("search_query", text);
  }

  private async getPipe(): Promise<ExtractPipe> {
    if (!this.pipe) {
      // pipeline() returns a complex union; we narrow to the callable shape we need.
      this.pipe = (await pipeline("feature-extraction", this.modelName)) as unknown as ExtractPipe;
    }
    return this.pipe;
  }

  private async run(prefix: "search_document" | "search_query", text: string): Promise<number[]> {
    const pipe = await this.getPipe();
    const output = await pipe(`${prefix}: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }
}
