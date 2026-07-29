import { pipeline } from "@huggingface/transformers";

import type { EmbeddingProvider } from "./embedding-provider.js";

const DEFAULT_MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";

/** Minimal callable shape we need from the feature-extraction pipeline. */
interface ExtractPipe {
  (text: string, options: Record<string, unknown>): Promise<{ data: Float32Array }>;
}

/**
 * Process-wide cache of loaded models, keyed by model id.
 *
 * #1355: this used to be a per-instance field, and `createEmbeddingProvider` hands out a NEW
 * provider on every call — including once per background job. Every job therefore loaded its own
 * fp32 CPU copy of the model, and because the ONNX session holds native memory outside the JS
 * heap, the discarded copies were never meaningfully reclaimed. The prod worker reached ~25 GB RSS
 * in about 70 minutes, the kernel OOM killer took the container down, and users saw an nginx 502
 * mid-conversation.
 *
 * Sharing is safe: the model is immutable, identical for every caller, and derived only from the
 * model id. The provider holds no db handle, no AccessContext and no user state, so there is
 * nothing tenant-specific that could leak between callers.
 *
 * The cache stores the PROMISE rather than the resolved pipe so concurrent first-callers await a
 * single load instead of racing into several. A rejected load evicts itself, so a transient
 * failure (a cold model download, say) does not poison the cache for the life of the process.
 */
const pipeCache = new Map<string, Promise<ExtractPipe>>();

function loadPipe(modelId: string): Promise<ExtractPipe> {
  const cached = pipeCache.get(modelId);
  if (cached) return cached;

  // pipeline() returns a complex union; we narrow to the callable shape we need.
  const loading = Promise.resolve(pipeline("feature-extraction", modelId)).then(
    (p) => p as unknown as ExtractPipe
  );
  const guarded = loading.catch((err: unknown) => {
    pipeCache.delete(modelId);
    throw err;
  });
  pipeCache.set(modelId, guarded);
  return guarded;
}

/** Test-only: drop the shared model cache so a suite can observe loads from a clean slate. */
export function resetEmbeddingPipelineCacheForTests(): void {
  pipeCache.clear();
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 768;
  readonly modelName: string;
  readonly modelVersion = "1.5";

  constructor(modelId: string = DEFAULT_MODEL_ID) {
    this.modelName = modelId;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.run("search_document", text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.run("search_query", text);
  }

  private async run(prefix: "search_document" | "search_query", text: string): Promise<number[]> {
    const pipe = await loadPipe(this.modelName);
    const output = await pipe(`${prefix}: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }
}
