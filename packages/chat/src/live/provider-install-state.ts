/**
 * provider-install-state — the api-side install state machine (#342 Phase 2, install-contract §A.4).
 *
 * This module owns the `app.provider_install_state` STATE MACHINE: who writes which transition and
 * when. The base contract (§9, `0103_provider_install_state.sql`, `ProviderInstallState`) freezes the
 * states + the table; this module freezes the api-side TRANSITIONS over them.
 *
 *   - The **api is the SOLE writer** of `app.provider_install_state` — the cli-runner has no DB
 *     mount/credentials; it only REPORTS the terminal `RpcInstallProviderResult` over the socket
 *     (§A.4). Every write here runs under an **ADMIN `AccessContext`** because the table's write RLS
 *     is `current_actor_is_admin()` (`0103:53-71`).
 *   - The driver ({@link runInstallProvider}) sequences `persist(installing) → installProvider RPC →
 *     persist(installed|error)` — the §A.4 transition table is TOTAL over the start states the api can
 *     be in when it sends `installProvider` (`{not_installed, installed, ready, needs_login, error} →
 *     installing`), and every such start collapses to `installing` BEFORE the RPC.
 *   - {@link reconcileInstalling} is the FROZEN stale-`installing` reconciliation PROJECTION (§A.4.2):
 *     a pure function over (persisted state, fresh `probeProvider` result) that corrects a row left
 *     `installing` by an api crash mid-install.
 *
 * MODULE ISOLATION: this module defines the transition LOGIC + a {@link ProviderInstallStateStore}
 * PORT; the concrete `DataContextDb`-backed repository lives in the settings/onboarding module (state
 * lives there, base §9.2), which wires the port. This file does NOT import `@jarv1s/db` machinery; it
 * only names the `AccessContext` shape it threads through to the store.
 *
 * Grounded-on: install-contract spec FROZEN v2/R6 §A.4/§A.4.1/§A.4.2; base RPC contract FROZEN v2.
 */

import type { ProviderInstallState } from "@jarv1s/shared";

import type { RpcInstallProviderParams, RpcInstallProviderResult } from "./install-contract.js";
import type { RpcProbeProviderResult } from "./rpc-contract.js";

/**
 * The provider keys the table accepts (`0103` CHECK: 'anthropic' | 'openai-compatible' | 'google').
 * Mirrors `RpcProviderKind` — re-stated here only so the store port is self-describing; not redefined.
 */
export type InstallProviderKey = "anthropic" | "openai-compatible" | "google";

// ---------------------------------------------------------------------------
// §A.4 — the COMPLETE transition table (who writes which edge, when)
// ---------------------------------------------------------------------------

/**
 * The terminal install states the `installProvider` verb can settle to (§A.2.1) — the RPC result's
 * `state` is exactly `Extract<ProviderInstallState, "installed" | "error">`.
 */
export type TerminalInstallState = Extract<ProviderInstallState, "installed" | "error">;

/**
 * The set of persisted start states from which the api may (re)issue `installProvider` (§A.4). A
 * (re)install/upgrade may begin from ANY of these, and every one collapses to `installing` before the
 * RPC. This is the FULL pre-install domain — `installing` itself is excluded (an install in flight is
 * serialized server-side, §A.3.1; the api does not re-collapse a row already `installing`).
 */
export const INSTALL_START_STATES: readonly ProviderInstallState[] = [
  "not_installed",
  "installed",
  "ready",
  "needs_login",
  "error"
] as const;

/**
 * The named transition edges of the §A.4 state machine. Each edge records its `from`/`to` and WHO
 * writes it — the api writes every edge in this addendum's scope (the cli-runner never writes the DB,
 * §A.4); the two Phase-3 login edges (`installed → needs_login`, `needs_login → ready`) are listed for
 * completeness but are OUT of this addendum's scope (owned by the Phase-3 login layer). `kind`
 * classifies HOW the edge is produced so a test can assert the table is total + correct.
 */
export type InstallTransitionKind =
  /** api persists `installing` BEFORE the RPC (collapse from any start state). */
  | "collapse-to-installing"
  /** api persists the terminal `installed`/`error` from the `RpcInstallProviderResult` AFTER the RPC. */
  | "terminal"
  /** api corrects a stale `installing` row via the §A.4.2 projection (probe-driven, NOT a fresh RPC). */
  | "reconcile-projection"
  /** api re-probe (§A.5) shows the binary absent ⇒ reset to `not_installed`. */
  | "reprobe-absent"
  /** Phase-3 login layer — OUT of this addendum's scope, listed for completeness. */
  | "phase3-login";

export interface InstallTransition {
  readonly from: ProviderInstallState;
  readonly to: ProviderInstallState;
  readonly who: "api" | "api-phase3";
  readonly kind: InstallTransitionKind;
}

/**
 * The COMPLETE §A.4 transition table. Total over the start states the api can send `installProvider`
 * from (every `INSTALL_START_STATES` member has a `collapse-to-installing` row), plus the terminal
 * edges out of `installing`, the §A.4.2 reconcile-projection edges, the §A.5 reprobe-absent resets,
 * and the (out-of-scope) Phase-3 login edges for completeness.
 */
export const INSTALL_TRANSITIONS: readonly InstallTransition[] = [
  // {not_installed, installed, ready, needs_login, error} → installing (api, before the RPC)
  { from: "not_installed", to: "installing", who: "api", kind: "collapse-to-installing" },
  { from: "installed", to: "installing", who: "api", kind: "collapse-to-installing" },
  { from: "ready", to: "installing", who: "api", kind: "collapse-to-installing" },
  { from: "needs_login", to: "installing", who: "api", kind: "collapse-to-installing" },
  { from: "error", to: "installing", who: "api", kind: "collapse-to-installing" },
  // installing → {installed, error} (api, from the RpcInstallProviderResult, after the RPC)
  { from: "installing", to: "installed", who: "api", kind: "terminal" },
  { from: "installing", to: "error", who: "api", kind: "terminal" },
  // installing → {installed, not_installed} (api, §A.4.2 stale-installing reconcile projection)
  { from: "installing", to: "installed", who: "api", kind: "reconcile-projection" },
  { from: "installing", to: "not_installed", who: "api", kind: "reconcile-projection" },
  // {installed, ready, needs_login, error} → not_installed (api, §A.5 re-probe shows binary absent)
  { from: "installed", to: "not_installed", who: "api", kind: "reprobe-absent" },
  { from: "ready", to: "not_installed", who: "api", kind: "reprobe-absent" },
  { from: "needs_login", to: "not_installed", who: "api", kind: "reprobe-absent" },
  { from: "error", to: "not_installed", who: "api", kind: "reprobe-absent" },
  // Phase-3 login edges (OUT of this addendum's scope — completeness only)
  { from: "installed", to: "needs_login", who: "api-phase3", kind: "phase3-login" },
  { from: "needs_login", to: "ready", who: "api-phase3", kind: "phase3-login" }
] as const;

// ---------------------------------------------------------------------------
// §A.4.2 — stale-`installing` reconciliation PROJECTION (frozen, pure)
// ---------------------------------------------------------------------------

/**
 * The FROZEN §A.4.2 stale-`installing` reconciliation projection. A persisted `installing` row is
 * transient by intent — it should be overwritten by the terminal `installed`/`error` the same request
 * produces. If the api crashed between persisting `installing` and the terminal state, the row is
 * STALE. On the next onboarding load the api reconciles it via this pure projection over (persisted
 * state, fresh `probeProvider` result):
 *
 *   - It applies ONLY to a persisted `installing` row — every other persisted state is returned
 *     UNCHANGED (the projection is IDENTITY off `installing`).
 *   - For `persisted === "installing"`, map by the fresh probe:
 *       probe ∈ { ready, needs_login } (binary present on PATH) ⇒ `installed`
 *         (the install actually completed before the crash; login lifecycle is advanced separately by
 *         Phase 3 — this projection NEVER invents `ready`/`needs_login`).
 *       probe === not_installed (binary absent) ⇒ `not_installed` (the install never completed).
 *       probe === multiplexer_unavailable (transient, base §9.1) ⇒ leave `installing` UNCHANGED and
 *         re-reconcile on the next load (do NOT downgrade a possibly-complete install on a transient
 *         probe failure).
 *       probe === error (a non-transient probe failure) ⇒ leave `installing` UNCHANGED (same caution:
 *         an opaque probe error is not evidence the binary is absent; re-reconcile next load).
 *
 * This is the ONLY writer of the `installing → {installed, not_installed}` reconcile edges in the §A.4
 * table. PURE — no I/O. The caller persists the result under an admin actor ({@link persistState}).
 */
export function reconcileInstalling(
  persisted: ProviderInstallState,
  probe: RpcProbeProviderResult
): ProviderInstallState {
  // Identity off `installing` — never touch any other persisted state.
  if (persisted !== "installing") return persisted;

  switch (probe.status) {
    case "ready":
    case "needs_login":
      // Binary present on PATH ⇒ the install completed before the crash. Collapse to `installed`;
      // Phase-3 login owns advancing it further. NEVER invent ready/needs_login here.
      return "installed";
    case "not_installed":
      // Binary absent ⇒ the install never completed; the user re-triggers.
      return "not_installed";
    case "multiplexer_unavailable":
    case "error":
      // Transient / opaque probe failure ⇒ leave `installing` unchanged; re-reconcile next load. Do
      // NOT downgrade a possibly-complete install on a probe we cannot trust.
      return "installing";
    default: {
      // Exhaustiveness guard: an unknown probe status (should be impossible — the union is closed) is
      // treated as untrusted ⇒ leave `installing`.
      return "installing";
    }
  }
}

// ---------------------------------------------------------------------------
// §A.4.1 — persistence port (admin-actor write) + the install DRIVER
// ---------------------------------------------------------------------------

/**
 * The persistence PORT the settings/onboarding module wires (module isolation — the concrete
 * `DataContextDb`-backed repository lives there, base §9.2). Every method runs under an ADMIN
 * `AccessContext` because `app.provider_install_state` write RLS is `current_actor_is_admin()`
 * (`0103:53-71`). The implementation MUST `withDataContext(adminAccessContext, …)` upsert one row per
 * provider (the table is `provider PRIMARY KEY`, instance-global, ADR 0007).
 */
export interface ProviderInstallStateStore {
  /** Read the persisted state for a provider, or `undefined` when no row exists yet. */
  read(provider: InstallProviderKey): Promise<PersistedProviderInstall | undefined>;
  /**
   * Upsert the state (admin actor, §A.4.1). `version`/`message` are set/cleared per the §A.4 table:
   * `installed` carries `version`, `error` carries the redacted `message`, the rest clear both. The
   * implementation is the SOLE writer; the cli-runner never reaches the DB (§A.4).
   */
  write(input: ProviderInstallWrite): Promise<void>;
}

/** A persisted row as the store returns it (mirrors the `0103` columns the projection needs). */
export interface PersistedProviderInstall {
  readonly provider: InstallProviderKey;
  readonly state: ProviderInstallState;
  readonly version?: string;
  readonly message?: string;
}

/** A single admin-actor upsert of `app.provider_install_state` (§A.4.1). */
export interface ProviderInstallWrite {
  readonly provider: InstallProviderKey;
  readonly state: ProviderInstallState;
  /** Set on `installed` (the verified version); cleared (undefined) on every other state. */
  readonly version?: string;
  /** Set on `error` (already redacted, base §6.4, ≤2000 chars); cleared otherwise. */
  readonly message?: string;
}

/**
 * The minimal RPC surface the install driver needs — exactly the §A.2 verb on {@link RpcConnection}.
 * Narrowed to one method so the driver is unit-testable with a fake and does not depend on the whole
 * connection. A `bad_request` (not-a-kind / catalog-blocked / already-in-progress) or `internal`
 * RpcErr surfaces here as a THROWN typed error (mapped by `call()` / `mapRpcError`, §4.7); a FAILED
 * install is a normal terminal OUTCOME — a resolved `{ state: "error", message }` (§A.2.3).
 */
export interface InstallProviderRpc {
  installProvider(params: RpcInstallProviderParams): Promise<RpcInstallProviderResult>;
}

/**
 * Drive ONE `installProvider` through the §A.4 machine, under an admin actor:
 *
 *   1. persist `installing` (collapse from ANY start state — §A.4, transition table is total over
 *      `INSTALL_START_STATES`). This is the `not_installed|installed|ready|needs_login|error →
 *      installing` edge — written BEFORE the RPC so a crash mid-install leaves a `installing` row the
 *      §A.4.2 projection later corrects.
 *   2. send the `installProvider` RPC.
 *   3. persist the terminal `installed`(+`version`) / `error`(+redacted `message`) from the
 *      `RpcInstallProviderResult` (§A.4 `installing → {installed,error}` terminal edges).
 *
 * A FAILED install (`result.state === "error"`) is a normal terminal OUTCOME (§A.2.3): the RPC
 * RESOLVES, and step 3 persists `error`. Only a transport-level `RpcErr` (`bad_request` / `internal`)
 * THROWS — in which case the `installing` row remains and is corrected on the next onboarding load by
 * the §A.4.2 projection (a stale `installing`), so we re-throw WITHOUT clobbering it to a guessed
 * state (we have no terminal result to persist). The thrown error propagates to the route, which maps
 * it to HTTP (§4.7).
 *
 * Returns the terminal `RpcInstallProviderResult` so the caller (the onboarding install route) can
 * surface `version`/`alreadyInstalled`/`message`.
 */
export async function runInstallProvider(
  provider: InstallProviderKey,
  store: ProviderInstallStateStore,
  rpc: InstallProviderRpc
): Promise<RpcInstallProviderResult> {
  // 1. collapse to `installing` BEFORE the RPC (admin actor, §A.4.1). version/message cleared.
  await store.write({ provider, state: "installing" });

  // 2. drive the install over the socket. A bad_request/internal RpcErr throws here (mapped §4.7);
  //    we deliberately do NOT catch it — the `installing` row is left for the §A.4.2 projection.
  const result = await rpc.installProvider({ provider });

  // 3. persist the terminal state from the result (§A.4 terminal edges).
  if (result.state === "installed") {
    await store.write({ provider, state: "installed", version: result.version });
  } else {
    await store.write({ provider, state: "error", message: result.message });
  }
  return result;
}

/**
 * Persist the corrected state of a stale `installing` row (§A.4.2). Reads the row, runs the
 * {@link reconcileInstalling} projection over (persisted, fresh probe), and — ONLY when the projection
 * changed the state — writes the corrected state under the admin actor so the row is no longer stale.
 * A `installed` correction carries the prior `version` forward (the install completed before the
 * crash); a `not_installed` correction clears version+message. When the projection is identity (not a
 * stale `installing` row, or a transient probe) NOTHING is written.
 *
 * Returns the (possibly-unchanged) reconciled state, or `undefined` when there is no row to reconcile.
 */
export async function reconcileInstallingRow(
  provider: InstallProviderKey,
  store: ProviderInstallStateStore,
  probe: RpcProbeProviderResult
): Promise<ProviderInstallState | undefined> {
  const row = await store.read(provider);
  if (!row) return undefined;

  const corrected = reconcileInstalling(row.state, probe);
  if (corrected === row.state) return corrected; // identity — nothing to persist.

  if (corrected === "installed") {
    // The install completed before the crash; carry the recorded version forward.
    await store.write({ provider, state: "installed", version: row.version });
  } else {
    // not_installed — clear version + message.
    await store.write({ provider, state: corrected });
  }
  return corrected;
}
