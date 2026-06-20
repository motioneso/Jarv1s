/**
 * Unit tests for the #342 Phase-1.5 onboarding-probe socket routing (Lane A, chat-multiplexer.ts).
 *
 * When the cli-runner socket is configured, the CLIs are NOT in the api container, so the onboarding
 * probes (`makeCliPresentProbe` + `makeProviderConnectionCheckProbe`) MUST route through the cli-runner
 * over the socket via `probeProvider` (§4.8) instead of spawning CLIs in-process. The connection is
 * supplied as a late-bound accessor so a connection wired AFTER probe construction is still used.
 *
 * These tests pass a minimal fake exposing only `probeProvider` (the single verb the probes call), so
 * no real socket is opened.
 */
import { describe, expect, it, vi } from "vitest";

import type { RpcConnection } from "@jarv1s/chat";
import type { OnboardingProviderCheckResponse } from "@jarv1s/shared";

import {
  makeCliPresentProbe,
  makeProviderConnectionCheckProbe
} from "../../packages/module-registry/src/chat-multiplexer.js";

/**
 * A fake just rich enough to stand in for RpcConnection in the probe path (the probes only ever touch
 * `.probeProvider`); cast through unknown so the test fake need not implement the whole surface.
 */
function fakeConnection(
  probeProvider: (params: { provider: string }) => Promise<unknown>
): RpcConnection {
  return { probeProvider } as unknown as RpcConnection;
}

describe("makeCliPresentProbe — socket route (§4.8)", () => {
  it("routes presence through probeProvider when a connection is available", async () => {
    const probeProvider = vi.fn(
      async () => ({ status: "ready" }) as OnboardingProviderCheckResponse
    );
    const connection = fakeConnection(probeProvider);
    const cliPresent = makeCliPresentProbe(() => connection);

    await expect(cliPresent("anthropic")).resolves.toBe(true);
    expect(probeProvider).toHaveBeenCalledWith({ provider: "anthropic" });
  });

  it("reports NOT present only when the cli-runner says not_installed", async () => {
    const cliPresent = makeCliPresentProbe(() =>
      fakeConnection(async () => ({ status: "not_installed" }))
    );
    await expect(cliPresent("openai-compatible")).resolves.toBe(false);
  });

  it("treats needs_login as present (the binary exists; only auth is missing)", async () => {
    const cliPresent = makeCliPresentProbe(() =>
      fakeConnection(async () => ({ status: "needs_login" }))
    );
    await expect(cliPresent("google")).resolves.toBe(true);
  });

  it("degrades a socket error to false (bounded + fail-soft, like the PATH path)", async () => {
    const cliPresent = makeCliPresentProbe(() =>
      fakeConnection(async () => {
        throw new Error("socket down");
      })
    );
    await expect(cliPresent("anthropic")).resolves.toBe(false);
  });

  it("uses the late-bound accessor — a connection wired AFTER construction is still used", async () => {
    // Late-bound: the accessor closes over `connection` and is built BEFORE it is assigned, so this
    // cannot be a const declaration-with-initializer.
    // eslint-disable-next-line prefer-const
    let connection: RpcConnection | undefined;
    const cliPresent = makeCliPresentProbe(() => connection);
    // Wired after the probe is built (the real composition publishes it post-route-registration).
    connection = fakeConnection(async () => ({ status: "ready" }));
    await expect(cliPresent("anthropic")).resolves.toBe(true);
  });
});

describe("makeProviderConnectionCheckProbe — socket route (§4.8)", () => {
  it("returns the cli-runner probeProvider response verbatim when a connection is available", async () => {
    const probeProvider = vi.fn(
      async () => ({ status: "ready" }) as OnboardingProviderCheckResponse
    );
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("must NOT spawn an in-process engine on the socket path");
      },
      cliPresent: async () => {
        throw new Error("must NOT run the in-process cliPresent on the socket path");
      },
      connection: () => fakeConnection(probeProvider)
    });

    await expect(probe("anthropic")).resolves.toEqual({ status: "ready" });
    expect(probeProvider).toHaveBeenCalledWith({ provider: "anthropic" });
  });

  it("surfaces multiplexer_unavailable when the socket call fails with CliChatUnavailableError", async () => {
    const { CliChatUnavailableError } = await import("@jarv1s/chat");
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("unused");
      },
      cliPresent: async () => true,
      connection: () =>
        fakeConnection(async () => {
          throw new CliChatUnavailableError("cli-runner reconciling after restart");
        })
    });
    await expect(probe("openai-compatible")).resolves.toEqual({
      status: "multiplexer_unavailable"
    });
  });

  it("surfaces error for a non-CliChatUnavailableError socket failure", async () => {
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("unused");
      },
      cliPresent: async () => true,
      connection: () =>
        fakeConnection(async () => {
          throw new Error("unexpected");
        })
    });
    await expect(probe("google")).resolves.toEqual({ status: "error" });
  });

  it("uses the in-process path when no connection accessor resolves a connection (host-dev)", async () => {
    let spawned = false;
    const probe = makeProviderConnectionCheckProbe({
      engineFactory: () => {
        throw new Error("anthropic uses auth-status, not an engine");
      },
      cliPresent: async () => {
        spawned = true;
        return false;
      },
      connection: () => undefined
    });
    // anthropic short-circuits via cliPresent → not_installed when cliPresent is false.
    await expect(probe("anthropic")).resolves.toEqual({ status: "not_installed" });
    expect(spawned).toBe(true);
  });
});
