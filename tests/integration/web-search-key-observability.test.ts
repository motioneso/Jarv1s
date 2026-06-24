import { afterEach, describe, expect, it } from "vitest";

import {
  invalidateWebSearchProviderCache,
  resolveWebSearchProvider,
  setWebSearchKeyResolver,
  setWebSearchProviderForTests,
  type WebSearchKeyResolver
} from "@jarv1s/web-research";

const BRAVE_KEY = "secret-brave-key-do-not-leak-9876543210";

describe("web-search key decrypt-failure observability", () => {
  afterEach(() => {
    // Restore to the default no-resolver / no-override state so tests don't leak.
    setWebSearchKeyResolver(undefined);
    setWebSearchProviderForTests(undefined);
    invalidateWebSearchProviderCache();
    delete process.env["JARVIS_BRAVE_SEARCH_API_KEY"];
  });

  it("fires onDecryptFailed and falls back to the env key when the resolver throws", async () => {
    const failingResolver: WebSearchKeyResolver = async () => {
      throw new Error("decrypt failed: bad keyring");
    };

    let notifyCalls = 0;
    setWebSearchKeyResolver(failingResolver, {
      onDecryptFailed: () => {
        notifyCalls += 1;
      }
    });
    process.env["JARVIS_BRAVE_SEARCH_API_KEY"] = BRAVE_KEY;

    // Must not throw — chat keeps working via the env fallback.
    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("brave");

    // The decrypt-failure event fired exactly once for this resolve.
    expect(notifyCalls).toBe(1);
  });

  it("does not fire onDecryptFailed when no resolver is installed", async () => {
    let notifyCalls = 0;
    setWebSearchKeyResolver(undefined, {
      onDecryptFailed: () => {
        notifyCalls += 1;
      }
    });
    process.env["JARVIS_BRAVE_SEARCH_API_KEY"] = BRAVE_KEY;

    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("brave");
    expect(notifyCalls).toBe(0);
  });

  it("falls back to unavailable when the resolver throws and no env key is set", async () => {
    const failingResolver: WebSearchKeyResolver = async () => {
      throw new Error("decrypt failed: corrupted envelope");
    };

    let notifyCalls = 0;
    setWebSearchKeyResolver(failingResolver, {
      onDecryptFailed: () => {
        notifyCalls += 1;
      }
    });

    const provider = await resolveWebSearchProvider(undefined);
    expect(provider.name).toBe("unavailable");
    expect(notifyCalls).toBe(1);
  });

  it("does not propagate the resolver error through the notifier payload boundary", async () => {
    // The notifier is a zero-arg callback: structurally it CANNOT carry secret material. This
    // test pins that contract — if someone widens the signature to accept the error/key, the
    // Hard Invariant ("secrets never escape") could be violated and this test must be updated.
    const errorCarryingResolver: WebSearchKeyResolver = async () => {
      throw new Error(`decrypt failed for key=${BRAVE_KEY}`);
    };

    let captured: unknown = null;
    setWebSearchKeyResolver(errorCarryingResolver, {
      onDecryptFailed: () => {
        // The notifier receives NO arguments. Nothing secret crosses this boundary.
        captured = "fired";
      }
    });
    process.env["JARVIS_BRAVE_SEARCH_API_KEY"] = BRAVE_KEY;

    await resolveWebSearchProvider(undefined);
    expect(captured).toBe("fired");
    // The error message (which contains the key) never reached the notifier.
    expect(String(captured)).not.toContain(BRAVE_KEY);
  });
});
