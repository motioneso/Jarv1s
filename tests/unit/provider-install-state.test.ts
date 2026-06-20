/**
 * Unit tests for the api-side install state machine (#342 Phase 2, Lane B, install-contract §A.4):
 *   - the §A.4.2 stale-`installing` reconciliation PROJECTION (every probe outcome + identity off
 *     non-`installing` states);
 *   - the install DRIVER's ordering — persist `installing` BEFORE the RPC, terminal AFTER — and that a
 *     transport `RpcErr` (bad_request/internal) propagates WITHOUT clobbering the stale `installing`;
 *   - the §A.4 transition table is COMPLETE (total over the start states the api can send
 *     `installProvider` from) and reconciled with the projection;
 *   - the store is the SOLE writer and is driven via the admin-actor port (the cli-runner never writes).
 *
 * The store + RPC are tiny in-memory fakes; no DB, no socket — the transition LOGIC is what is under
 * test. The concrete `DataContextDb`/admin-`AccessContext` repository lives in the settings module and
 * is exercised in that module's integration suite.
 */
import { describe, expect, it } from "vitest";

import type { ProviderInstallState } from "@jarv1s/shared";
import type {
  RpcInstallProviderParams,
  RpcInstallProviderResult
} from "../../packages/chat/src/live/install-contract.js";
import {
  INSTALL_START_STATES,
  INSTALL_TRANSITIONS,
  reconcileInstalling,
  reconcileInstallingRow,
  runInstallProvider,
  type InstallProviderKey,
  type InstallProviderRpc,
  type PersistedProviderInstall,
  type ProviderInstallStateStore,
  type ProviderInstallWrite
} from "../../packages/chat/src/live/provider-install-state.js";
import type { RpcProbeProviderResult } from "../../packages/chat/src/live/rpc-contract.js";

// ──────────────────────────────────────────────────────────────────────────────
// in-memory fakes (the admin-actor write is captured; no DB)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A fake store that records EVERY write in order — so a test can assert the driver wrote `installing`
 * BEFORE the terminal state, and that nothing else touched the row. It also serves a seeded row for
 * the reconcile path. Stands in for the settings-module `DataContextDb` admin-actor repository.
 */
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

/** A fake RPC that returns a scripted terminal result, or throws to mimic a transport RpcErr. */
function fakeRpc(
  impl: (params: RpcInstallProviderParams) => Promise<RpcInstallProviderResult>
): InstallProviderRpc & { calls: RpcInstallProviderParams[] } {
  const calls: RpcInstallProviderParams[] = [];
  return {
    calls,
    installProvider(params) {
      calls.push(params);
      return impl(params);
    }
  };
}

const probe = (status: RpcProbeProviderResult["status"]): RpcProbeProviderResult => ({ status });

// ──────────────────────────────────────────────────────────────────────────────
// §A.4.2 — the stale-`installing` reconciliation PROJECTION
// ──────────────────────────────────────────────────────────────────────────────

describe("reconcileInstalling projection (§A.4.2)", () => {
  it("is IDENTITY off `installing` — every other persisted state is returned unchanged", () => {
    const others: ProviderInstallState[] = [
      "not_installed",
      "installed",
      "needs_login",
      "ready",
      "error"
    ];
    // Even a probe that WOULD remap an `installing` row must not perturb a non-installing state.
    for (const state of others) {
      for (const s of [
        "ready",
        "needs_login",
        "not_installed",
        "multiplexer_unavailable",
        "error"
      ] as const) {
        expect(reconcileInstalling(state, probe(s))).toBe(state);
      }
    }
  });

  it("installing + probe ready ⇒ installed (binary present, install completed pre-crash)", () => {
    expect(reconcileInstalling("installing", probe("ready"))).toBe("installed");
  });

  it("installing + probe needs_login ⇒ installed (binary present; Phase-3 advances login separately)", () => {
    expect(reconcileInstalling("installing", probe("needs_login"))).toBe("installed");
  });

  it("NEVER invents ready/needs_login — a present binary always collapses to `installed`", () => {
    // The projection must not surface a login lifecycle state (Phase-3 owns those).
    expect(reconcileInstalling("installing", probe("ready"))).not.toBe("ready");
    expect(reconcileInstalling("installing", probe("needs_login"))).not.toBe("needs_login");
  });

  it("installing + probe not_installed ⇒ not_installed (install never completed)", () => {
    expect(reconcileInstalling("installing", probe("not_installed"))).toBe("not_installed");
  });

  it("installing + probe multiplexer_unavailable ⇒ STAYS installing (transient — do not downgrade)", () => {
    expect(reconcileInstalling("installing", probe("multiplexer_unavailable"))).toBe("installing");
  });

  it("installing + probe error ⇒ STAYS installing (opaque probe failure is not evidence of absence)", () => {
    expect(reconcileInstalling("installing", probe("error"))).toBe("installing");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §A.4 — the transition table is TOTAL + correct
// ──────────────────────────────────────────────────────────────────────────────

describe("install transition table (§A.4)", () => {
  it("collapses EVERY start state the api can send installProvider from to `installing` (total)", () => {
    // INSTALL_START_STATES = {not_installed, installed, ready, needs_login, error}; each MUST have a
    // collapse-to-installing edge so the (re)install/upgrade lane is total over the pre-install domain.
    for (const from of INSTALL_START_STATES) {
      const edge = INSTALL_TRANSITIONS.find(
        (t) => t.from === from && t.to === "installing" && t.kind === "collapse-to-installing"
      );
      expect(edge, `missing collapse-to-installing edge from ${from}`).toBeDefined();
      expect(edge?.who).toBe("api");
    }
    // `installing` itself is NOT a start state (an in-flight install is serialized server-side).
    expect(INSTALL_START_STATES).not.toContain("installing");
  });

  it("has the terminal edges installing → {installed, error}, both api-written", () => {
    for (const to of ["installed", "error"] as const) {
      const edge = INSTALL_TRANSITIONS.find(
        (t) => t.from === "installing" && t.to === to && t.kind === "terminal"
      );
      expect(edge, `missing terminal edge installing → ${to}`).toBeDefined();
      expect(edge?.who).toBe("api");
    }
  });

  it("has the §A.4.2 reconcile-projection edges installing → {installed, not_installed}", () => {
    for (const to of ["installed", "not_installed"] as const) {
      const edge = INSTALL_TRANSITIONS.find(
        (t) => t.from === "installing" && t.to === to && t.kind === "reconcile-projection"
      );
      expect(edge, `missing reconcile-projection edge installing → ${to}`).toBeDefined();
    }
  });

  it("resets {installed, ready, needs_login, error} → not_installed on a §A.5 reprobe-absent", () => {
    for (const from of ["installed", "ready", "needs_login", "error"] as const) {
      const edge = INSTALL_TRANSITIONS.find(
        (t) => t.from === from && t.to === "not_installed" && t.kind === "reprobe-absent"
      );
      expect(edge, `missing reprobe-absent edge ${from} → not_installed`).toBeDefined();
      expect(edge?.who).toBe("api");
    }
  });

  it("lists the Phase-3 login edges for completeness but marks them out-of-scope (api-phase3)", () => {
    for (const [from, to] of [
      ["installed", "needs_login"],
      ["needs_login", "ready"]
    ] as const) {
      const edge = INSTALL_TRANSITIONS.find(
        (t) => t.from === from && t.to === to && t.kind === "phase3-login"
      );
      expect(edge, `missing phase3-login edge ${from} → ${to}`).toBeDefined();
      expect(edge?.who).toBe("api-phase3");
    }
  });

  it("every transition's `to` is a valid ProviderInstallState (no stray states)", () => {
    const valid: ProviderInstallState[] = [
      "not_installed",
      "installing",
      "installed",
      "needs_login",
      "ready",
      "error"
    ];
    for (const t of INSTALL_TRANSITIONS) {
      expect(valid).toContain(t.from);
      expect(valid).toContain(t.to);
    }
  });

  it("reconcile-projection edges agree with the reconcileInstalling projection", () => {
    // Cross-check the table against the executable projection: the only installing→X edges the
    // projection can emit are installed + not_installed (it leaves installing on a transient probe).
    const projTargets = new Set<ProviderInstallState>([
      reconcileInstalling("installing", probe("ready")),
      reconcileInstalling("installing", probe("needs_login")),
      reconcileInstalling("installing", probe("not_installed"))
    ]);
    const tableTargets = new Set(
      INSTALL_TRANSITIONS.filter((t) => t.kind === "reconcile-projection").map((t) => t.to)
    );
    expect(tableTargets).toEqual(projTargets);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §A.4 / §A.4.1 — the install DRIVER: admin-actor writes, ordering, error handling
// ──────────────────────────────────────────────────────────────────────────────

describe("runInstallProvider driver (§A.4)", () => {
  const PROVIDER: InstallProviderKey = "anthropic";

  it("persists `installing` BEFORE the RPC, then the terminal `installed`+version AFTER (ordering)", async () => {
    const store = new FakeStore();
    let installingPersistedBeforeRpc = false;
    const rpc = fakeRpc(async () => {
      // At RPC time the store must already hold `installing` (written in step 1, before the RPC).
      installingPersistedBeforeRpc = store.writes.at(-1)?.state === "installing";
      return { state: "installed", version: "1.2.3" };
    });

    const result = await runInstallProvider(PROVIDER, store, rpc);

    expect(installingPersistedBeforeRpc).toBe(true);
    expect(rpc.calls).toEqual([{ provider: PROVIDER }]);
    // Exactly two writes, in order: installing (no version), then installed + version.
    expect(store.writes).toEqual([
      { provider: PROVIDER, state: "installing" },
      { provider: PROVIDER, state: "installed", version: "1.2.3" }
    ]);
    expect(result).toEqual({ state: "installed", version: "1.2.3" });
  });

  it("persists the terminal `error` + redacted message on a FAILED install (RpcOk, not RpcErr)", async () => {
    // §A.2.3: a failed install is a normal terminal OUTCOME — the verb RESOLVES with state:"error".
    const store = new FakeStore();
    const rpc = fakeRpc(async () => ({ state: "error", message: "verify failed (redacted)" }));

    const result = await runInstallProvider(PROVIDER, store, rpc);

    expect(store.writes).toEqual([
      { provider: PROVIDER, state: "installing" },
      { provider: PROVIDER, state: "error", message: "verify failed (redacted)" }
    ]);
    expect(result.state).toBe("error");
  });

  it("carries alreadyInstalled through to the caller (idempotent no-op re-verify)", async () => {
    const store = new FakeStore();
    const rpc = fakeRpc(async () => ({
      state: "installed",
      version: "1.2.3",
      alreadyInstalled: true
    }));
    const result = await runInstallProvider(PROVIDER, store, rpc);
    expect(result.alreadyInstalled).toBe(true);
    // Even an already-installed no-op still re-persists installed+version (the terminal write).
    expect(store.writes.at(-1)).toEqual({
      provider: PROVIDER,
      state: "installed",
      version: "1.2.3"
    });
  });

  it("collapses from ANY start state to `installing` (the table is total — driver does not branch)", async () => {
    // The driver persists `installing` unconditionally — it does not read or special-case the prior
    // state. Verify it from each documented start state (the row may already be installed/error/etc.).
    for (const from of INSTALL_START_STATES) {
      const store = new FakeStore();
      store.seed({ provider: PROVIDER, state: from });
      const rpc = fakeRpc(async () => ({ state: "installed", version: "9.9.9" }));
      await runInstallProvider(PROVIDER, store, rpc);
      expect(store.writes[0]).toEqual({ provider: PROVIDER, state: "installing" });
    }
  });

  it("on a transport RpcErr (bad_request/internal) it RE-THROWS and leaves the stale `installing`", async () => {
    // A bad_request (not-a-kind / catalog-blocked / already-in-progress) or internal fault throws.
    // We must NOT clobber the row to a guessed terminal — the §A.4.2 projection corrects the stale
    // `installing` on the next onboarding load.
    const store = new FakeStore();
    const rpc = fakeRpc(async () => {
      throw new Error("provider not installable: blocked");
    });

    await expect(runInstallProvider(PROVIDER, store, rpc)).rejects.toThrow("not installable");

    // Only the pre-RPC `installing` was written; no terminal write followed.
    expect(store.writes).toEqual([{ provider: PROVIDER, state: "installing" }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// §A.4.2 — reconcileInstallingRow: read → project → persist-only-if-changed
// ──────────────────────────────────────────────────────────────────────────────

describe("reconcileInstallingRow (§A.4.2)", () => {
  const PROVIDER: InstallProviderKey = "openai-compatible";

  it("returns undefined and writes nothing when there is no row", async () => {
    const store = new FakeStore();
    const out = await reconcileInstallingRow(PROVIDER, store, probe("ready"));
    expect(out).toBeUndefined();
    expect(store.writes).toEqual([]);
  });

  it("corrects a stale `installing` row to `installed` (probe ready), carrying version forward", async () => {
    const store = new FakeStore();
    store.seed({ provider: PROVIDER, state: "installing", version: "2.0.0" });
    const out = await reconcileInstallingRow(PROVIDER, store, probe("ready"));
    expect(out).toBe("installed");
    expect(store.writes).toEqual([{ provider: PROVIDER, state: "installed", version: "2.0.0" }]);
  });

  it("corrects a stale `installing` row to `not_installed` (probe not_installed), clearing version", async () => {
    const store = new FakeStore();
    store.seed({ provider: PROVIDER, state: "installing", version: "2.0.0" });
    const out = await reconcileInstallingRow(PROVIDER, store, probe("not_installed"));
    expect(out).toBe("not_installed");
    expect(store.writes).toEqual([{ provider: PROVIDER, state: "not_installed" }]);
  });

  it("writes NOTHING on a transient probe (multiplexer_unavailable) — leaves `installing`", async () => {
    const store = new FakeStore();
    store.seed({ provider: PROVIDER, state: "installing", version: "2.0.0" });
    const out = await reconcileInstallingRow(PROVIDER, store, probe("multiplexer_unavailable"));
    expect(out).toBe("installing");
    expect(store.writes).toEqual([]);
  });

  it("writes NOTHING when the row is not `installing` (projection is identity)", async () => {
    const store = new FakeStore();
    store.seed({ provider: PROVIDER, state: "installed", version: "2.0.0" });
    const out = await reconcileInstallingRow(PROVIDER, store, probe("not_installed"));
    expect(out).toBe("installed");
    expect(store.writes).toEqual([]);
  });
});
