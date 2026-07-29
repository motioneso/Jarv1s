import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1355: every embedding job constructed its own provider, and the provider cached its loaded
 * model per instance — so each job loaded a fresh fp32 ONNX model whose native memory was never
 * reclaimed. The prod worker ballooned to ~25 GB and the kernel OOM killer took it down.
 *
 * These tests pin the sharing contract: one load per model id for the life of the process,
 * regardless of how many providers get constructed.
 */

/** Stand-in for the feature-extraction pipeline; returns a fixed two-dim vector. */
const fakePipe = vi.fn(async (_text: string, _options: Record<string, unknown>) => ({
  data: Float32Array.from([0.25, 0.75])
}));
const pipelineMock = vi.fn(async (_task: string, _modelId: string) => fakePipe);

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock
}));

const importProvider = async () => import("../../packages/memory/src/local-embedding-provider.js");

describe("LocalEmbeddingProvider model cache (#1355)", () => {
  beforeEach(async () => {
    const { resetEmbeddingPipelineCacheForTests } = await importProvider();
    resetEmbeddingPipelineCacheForTests();
    pipelineMock.mockClear();
    fakePipe.mockClear();
  });

  it("loads the model once across separate provider instances", async () => {
    const { LocalEmbeddingProvider } = await importProvider();

    // Mirrors production: createEmbeddingProvider hands out a new instance per job.
    await new LocalEmbeddingProvider("model-a").embedDocument("first job");
    await new LocalEmbeddingProvider("model-a").embedDocument("second job");
    await new LocalEmbeddingProvider("model-a").embedQuery("third job");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", "model-a");
    expect(fakePipe).toHaveBeenCalledTimes(3);
  });

  it("loads once per distinct model id", async () => {
    const { LocalEmbeddingProvider } = await importProvider();

    await new LocalEmbeddingProvider("model-a").embedDocument("a");
    await new LocalEmbeddingProvider("model-b").embedDocument("b");
    await new LocalEmbeddingProvider("model-a").embedDocument("a again");

    expect(pipelineMock).toHaveBeenCalledTimes(2);
    expect(pipelineMock.mock.calls.map((call) => call[1])).toEqual(["model-a", "model-b"]);
  });

  it("does not double-load when concurrent callers race the first load", async () => {
    const { LocalEmbeddingProvider } = await importProvider();

    await Promise.all([
      new LocalEmbeddingProvider("model-a").embedDocument("one"),
      new LocalEmbeddingProvider("model-a").embedDocument("two"),
      new LocalEmbeddingProvider("model-a").embedDocument("three")
    ]);

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it("retries the load after a failure instead of caching the rejection forever", async () => {
    const { LocalEmbeddingProvider } = await importProvider();
    pipelineMock.mockRejectedValueOnce(new Error("cold download failed"));

    await expect(new LocalEmbeddingProvider("model-a").embedDocument("x")).rejects.toThrow(
      "cold download failed"
    );

    const vector = await new LocalEmbeddingProvider("model-a").embedDocument("x");

    expect(vector).toEqual([0.25, 0.75]);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
  });

  it("still prefixes the text by task, so pooled vectors stay comparable", async () => {
    const { LocalEmbeddingProvider } = await importProvider();
    const provider = new LocalEmbeddingProvider("model-a");

    await provider.embedDocument("hello");
    await provider.embedQuery("hello");

    expect(fakePipe.mock.calls.map((call) => call[0])).toEqual([
      "search_document: hello",
      "search_query: hello"
    ]);
  });
});
