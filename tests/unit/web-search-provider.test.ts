import { afterEach, describe, expect, it } from "vitest";

import {
  invalidateWebSearchProviderCache,
  resolveWebSearchProvider,
  setWebSearchKeyResolver,
  setWebSearchProviderForTests,
  type WebSearchProvider
} from "@jarv1s/web-research";

const ENV_KEY = "JARVIS_BRAVE_SEARCH_API_KEY";

function reset(): void {
  setWebSearchProviderForTests(undefined);
  setWebSearchKeyResolver(undefined);
  invalidateWebSearchProviderCache();
  delete process.env[ENV_KEY];
}

afterEach(reset);

describe("resolveWebSearchProvider", () => {
  it("returns the unavailable provider when no key is resolvable", async () => {
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("unavailable");
  });

  it("falls back to the env key when no resolver is installed", async () => {
    process.env[ENV_KEY] = "env-brave-key";
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("brave");
  });

  it("prefers the injected resolver key over the env key", async () => {
    process.env[ENV_KEY] = "env-brave-key";
    setWebSearchKeyResolver(async () => "instance-brave-key");

    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("brave");

    // Same key value resolves to the cached instance; env key (different value) would build a
    // distinct provider, so identity proves the resolver key, not the env key, was used.
    invalidateWebSearchProviderCache();
    setWebSearchKeyResolver(undefined); // now only the env key remains
    const envProvider = await resolveWebSearchProvider(undefined);
    expect(envProvider).not.toBe(provider);
  });

  it("falls back to the env key when the resolver throws", async () => {
    process.env[ENV_KEY] = "env-brave-key";
    setWebSearchKeyResolver(async () => {
      throw new Error("keyring exploded");
    });
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("brave");
  });

  it("returns unavailable when the resolver yields null and no env key is set", async () => {
    setWebSearchKeyResolver(async () => null);
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("unavailable");
  });

  it("caches the provider by key value and rebuilds when the key changes", async () => {
    setWebSearchKeyResolver(async () => "key-one");
    const first = await resolveWebSearchProvider(undefined);
    const second = await resolveWebSearchProvider(undefined);
    expect(second).toBe(first); // same key value → cached instance

    setWebSearchKeyResolver(async () => "key-two"); // rotation clears the cache
    const third = await resolveWebSearchProvider(undefined);
    expect(third).not.toBe(first);
  });

  it("invalidateWebSearchProviderCache forces a fresh provider", async () => {
    setWebSearchKeyResolver(async () => "stable-key");
    const first = await resolveWebSearchProvider(undefined);
    invalidateWebSearchProviderCache();
    const second = await resolveWebSearchProvider(undefined);
    expect(second).not.toBe(first);
    expect(second.name).toBe("brave");
  });

  it("the test override short-circuits all resolution", async () => {
    const stub: WebSearchProvider = {
      name: "stub",
      search: async () => ({ results: [] })
    };
    process.env[ENV_KEY] = "env-brave-key";
    setWebSearchKeyResolver(async () => "instance-brave-key");
    setWebSearchProviderForTests(stub);
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider).toBe(stub);
  });
});
