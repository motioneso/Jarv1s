/**
 * Unit tests for the api-side LOGIN lifecycle (#342 Phase 3, login-contract §L.4):
 *   - the §L.4.2 login-reconcile PROJECTION (identity off the post-install states; every probe);
 *   - the composed §L.4.2 full-lifecycle reconcile (reconcileInstalling THEN reconcileLogin);
 *   - `reconcileProviderLifecycleRow` persists only on a real change + carries version;
 *   - the §L.4.1 `loginFlowStatusToState` mapper (terminal vs awaiting);
 *   - the §L.4 transition table gained the appended login edges WITHOUT rewriting the originals.
 *
 * Pure logic — tiny in-memory store fake; no DB, no socket.
 */
import { describe, expect, it } from "vitest";

import type { ProviderInstallState } from "@jarv1s/shared";
import {
  INSTALL_TRANSITIONS,
  loginFlowStatusToState,
  reconcileLogin,
  reconcileProviderLifecycle,
  reconcileProviderLifecycleRow,
  type InstallProviderKey,
  type PersistedProviderInstall,
  type ProviderInstallStateStore,
  type ProviderInstallWrite
} from "../../packages/chat/src/live/provider-install-state.js";
import type { RpcProbeProviderResult } from "../../packages/chat/src/live/rpc-contract.js";

class FakeStore implements ProviderInstallStateStore {
  readonly writes: ProviderInstallWrite[] = [];
  private rows = new Map<InstallProviderKey, PersistedProviderInstall>();
  seed(row: PersistedProviderInstall): void {
    this.rows.set(row.provider, row);
  }
  async read(provider: InstallProviderKey): Promise<PersistedProviderInstall | undefined> {
    return this.rows.get(provider);
  }
  async write(input: ProviderInstallWrite): Promise<void> {
    this.writes.push(input);
    this.rows.set(input.provider, {
      provider: input.provider,
      state: input.state,
      version: input.version,
      message: input.message
    });
  }
}

const probe = (status: RpcProbeProviderResult["status"]): RpcProbeProviderResult => ({ status });

describe("reconcileLogin (§L.4.2 projection)", () => {
  it("is identity off the post-install states", () => {
    expect(reconcileLogin("not_installed", probe("ready"))).toBe("not_installed");
    expect(reconcileLogin("installing", probe("ready"))).toBe("installing");
  });

  it("maps the post-install states by the fresh probe", () => {
    for (const persisted of [
      "installed",
      "needs_login",
      "ready",
      "error"
    ] as ProviderInstallState[]) {
      expect(reconcileLogin(persisted, probe("ready"))).toBe("ready");
      expect(reconcileLogin(persisted, probe("needs_login"))).toBe("needs_login");
      expect(reconcileLogin(persisted, probe("not_installed"))).toBe("not_installed");
    }
  });

  it("leaves the state UNCHANGED on a transient/opaque probe (never downgrades)", () => {
    expect(reconcileLogin("ready", probe("multiplexer_unavailable"))).toBe("ready");
    expect(reconcileLogin("ready", probe("error"))).toBe("ready");
    expect(reconcileLogin("needs_login", probe("error"))).toBe("needs_login");
  });
});

describe("reconcileProviderLifecycle (composed §L.4.2)", () => {
  it("collapses a stale installing through to ready in one pass when the probe is ready", () => {
    expect(reconcileProviderLifecycle("installing", probe("ready"))).toBe("ready");
    expect(reconcileProviderLifecycle("installing", probe("needs_login"))).toBe("needs_login");
    expect(reconcileProviderLifecycle("installing", probe("not_installed"))).toBe("not_installed");
  });

  it("self-heals error→ready and re-derives ready→needs_login", () => {
    expect(reconcileProviderLifecycle("error", probe("ready"))).toBe("ready");
    expect(reconcileProviderLifecycle("ready", probe("needs_login"))).toBe("needs_login");
  });

  it("leaves installing unchanged on a transient probe", () => {
    expect(reconcileProviderLifecycle("installing", probe("multiplexer_unavailable"))).toBe(
      "installing"
    );
  });
});

describe("reconcileProviderLifecycleRow", () => {
  it("persists ONLY on a real change and carries the version forward for present states", async () => {
    const store = new FakeStore();
    store.seed({ provider: "anthropic", state: "installed", version: "2.1.183" });
    const corrected = await reconcileProviderLifecycleRow("anthropic", store, probe("ready"));
    expect(corrected).toBe("ready");
    expect(store.writes).toEqual([{ provider: "anthropic", state: "ready", version: "2.1.183" }]);
  });

  it("writes nothing when the projection is identity", async () => {
    const store = new FakeStore();
    store.seed({ provider: "anthropic", state: "ready", version: "2.1.183" });
    const corrected = await reconcileProviderLifecycleRow("anthropic", store, probe("ready"));
    expect(corrected).toBe("ready");
    expect(store.writes).toHaveLength(0);
  });

  it("clears version on a reprobe-absent (→ not_installed)", async () => {
    const store = new FakeStore();
    store.seed({ provider: "anthropic", state: "ready", version: "2.1.183" });
    const corrected = await reconcileProviderLifecycleRow(
      "anthropic",
      store,
      probe("not_installed")
    );
    expect(corrected).toBe("not_installed");
    expect(store.writes).toEqual([{ provider: "anthropic", state: "not_installed" }]);
  });

  it("returns undefined when there is no row", async () => {
    const store = new FakeStore();
    expect(await reconcileProviderLifecycleRow("anthropic", store, probe("ready"))).toBeUndefined();
  });
});

describe("loginFlowStatusToState (§L.4.1)", () => {
  it("maps terminal statuses and leaves awaiting unpersisted", () => {
    expect(loginFlowStatusToState("ready")).toBe("ready");
    expect(loginFlowStatusToState("error")).toBe("error");
    expect(loginFlowStatusToState("awaiting_authorization")).toBeUndefined();
    expect(loginFlowStatusToState("awaiting_token")).toBeUndefined();
  });
});

describe("§L.4 transition table (additive)", () => {
  const has = (from: ProviderInstallState, to: ProviderInstallState): boolean =>
    INSTALL_TRANSITIONS.some((t) => t.from === from && t.to === to && t.kind === "phase3-login");

  it("KEEPS the two original placeholder rows unchanged (who: api-phase3)", () => {
    const original = INSTALL_TRANSITIONS.filter((t) => t.who === "api-phase3");
    expect(original).toEqual([
      { from: "installed", to: "needs_login", who: "api-phase3", kind: "phase3-login" },
      { from: "needs_login", to: "ready", who: "api-phase3", kind: "phase3-login" }
    ]);
  });

  it("APPENDS the remaining login edges (total over the post-install lifecycle)", () => {
    expect(has("needs_login", "error")).toBe(true);
    expect(has("ready", "needs_login")).toBe(true);
    expect(has("installed", "ready")).toBe(true);
    expect(has("error", "needs_login")).toBe(true);
    expect(has("error", "ready")).toBe(true);
  });
});
