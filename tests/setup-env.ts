/**
 * Global test harness defaults.
 *
 * Production wiring (`getEmbeddingProviderConfig` -> `createEmbeddingProvider`) resolves the
 * embedding provider from runtime config: instance DB -> env var `JARVIS_EMBED_PROVIDER` ->
 * registry default `"local"`. The `"local"` provider (`LocalEmbeddingProvider`) downloads model
 * weights/tokenizer from the HuggingFace Hub at first use, which makes the test suite:
 *   - non-deterministic (depends on an external network endpoint), and
 *   - flaky under CI (HuggingFace returns 429 Too Many Requests, or the download exceeds the
 *     30s per-test timeout).
 *
 * For unit + integration tests we never need real embeddings: the tests that assert on
 * retrieval behaviour construct a `StubEmbeddingProvider` explicitly, and the ones that go
 * through the production config path only care that *some* vectors are written/read.
 *
 * Default the whole suite to the offline stub here. `??=` preserves any explicit override
 * (per-test `beforeAll` assignments, or a real `JARVIS_EMBED_PROVIDER` in the shell env when
 * running the dedicated local-embed slow test). The deliberate real-HF test
 * (`tests/slow/memory-local-embed.test.ts`) instantiates `LocalEmbeddingProvider` directly,
 * bypassing the config resolver, so this default has no effect on it.
 *
 * #1313: `createEmbeddingProvider` (packages/memory/src/embedding-provider-config.ts) only ever
 * honors "stub" under an explicit test/dev signal (`NODE_ENV=test` / `VITEST=true` /
 * `JARVIS_ALLOW_STUB_EMBEDDINGS=1`), never as a plain settings value. Vitest sets both `NODE_ENV`
 * and `VITEST` for the whole run, so this default keeps working unchanged — no extra env needed
 * here.
 */
process.env.JARVIS_EMBED_PROVIDER ??= "stub";
