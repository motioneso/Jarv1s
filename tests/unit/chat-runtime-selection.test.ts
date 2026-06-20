/**
 * Unit tests for the #342 Phase-1.5 composition-root wiring (Lane A): the engine-factory boot-time
 * fork (`selectEngineFactory`) and its SECURITY FAIL-FAST.
 *
 *   - §3.5: when JARVIS_CLI_RUNNER_SOCKET is set → the RPC client (ChatEngineRpcClient); else the
 *     in-process engine.
 *   - §6.6 FAIL-FAST: when the socket is selected but JARVIS_CLI_RUNNER_RPC_SECRET is missing/empty,
 *     selection THROWS at boot — BEFORE any RpcConnection is constructed or any socket is opened —
 *     with a message that contains NO secret value. The in-process path is unaffected.
 *
 * These are pure selection tests; no socket is opened (the factory does not connect until first
 * engine use, and the fail-fast throws before construction), so they need no real cli-runner.
 */
import { describe, expect, it } from "vitest";

import {
  ChatEngineRpcClient,
  CliChatUnavailableError,
  selectEngineFactory
} from "../../packages/chat/src/live/runtime.js";

const SOCKET = "/run/jarv1s/cli-runner.sock";

describe("selectEngineFactory — boot-time fork (§3.5)", () => {
  it("selects the RPC client when the socket + secret are configured", () => {
    const { factory, connection } = selectEngineFactory({
      env: {
        JARVIS_CLI_RUNNER_SOCKET: SOCKET,
        JARVIS_CLI_RUNNER_RPC_SECRET: "boot-secret"
      } as NodeJS.ProcessEnv
    });
    try {
      const engine = factory("anthropic", "user-a");
      expect(engine).toBeInstanceOf(ChatEngineRpcClient);
      expect(engine.provider).toBe("anthropic");
      expect(connection).toBeDefined();
    } finally {
      connection?.close();
    }
  });

  it("falls back to the in-process engine when the socket env is absent", () => {
    const { factory, connection } = selectEngineFactory({ env: {} as NodeJS.ProcessEnv });
    const engine = factory("anthropic", "user-a");
    expect(engine).not.toBeInstanceOf(ChatEngineRpcClient);
    expect(connection).toBeUndefined();
  });
});

describe("selectEngineFactory — SECURITY FAIL-FAST on a missing RPC secret (§6.6)", () => {
  it("THROWS when the socket is set but the secret is missing", () => {
    expect(() =>
      selectEngineFactory({
        env: { JARVIS_CLI_RUNNER_SOCKET: SOCKET } as NodeJS.ProcessEnv
      })
    ).toThrow(CliChatUnavailableError);
  });

  it("THROWS when the socket is set but the secret is an empty string", () => {
    expect(() =>
      selectEngineFactory({
        env: {
          JARVIS_CLI_RUNNER_SOCKET: SOCKET,
          JARVIS_CLI_RUNNER_RPC_SECRET: ""
        } as NodeJS.ProcessEnv
      })
    ).toThrow(CliChatUnavailableError);
  });

  it("throws BEFORE constructing any connection (no socket opened) and names both env vars", () => {
    let thrown: unknown;
    try {
      selectEngineFactory({
        env: { JARVIS_CLI_RUNNER_SOCKET: SOCKET } as NodeJS.ProcessEnv
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliChatUnavailableError);
    const message = (thrown as Error).message;
    // The message names the two env vars so the operator can fix the deploy config…
    expect(message).toContain("JARVIS_CLI_RUNNER_SOCKET");
    expect(message).toContain("JARVIS_CLI_RUNNER_RPC_SECRET");
    // …and it is fail-CLOSED: a secret-less RPC path never starts (this is the whole point — the
    // previous `rpcSecret ?? ""` was fail-OPEN). There is no secret VALUE to leak (none was set).
  });

  it("does NOT throw on the in-process path even with no secret set", () => {
    expect(() => selectEngineFactory({ env: {} as NodeJS.ProcessEnv })).not.toThrow();
  });
});
