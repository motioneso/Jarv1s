/**
 * §A install-contract — the ADDITIVE Phase-2 on-demand-installer wire surface.
 *
 * This file is the home of the `installProvider` RPC verb's params/result/progress
 * shapes AND the recipe-catalog TYPE (install-contract §A.1.1/§A.2.1). It is layered
 * strictly ON TOP of the FROZEN base RPC contract (`rpc-contract.ts`): it imports
 * `RpcProviderKind` read-only and re-declares NO base wire type (§A.0). The one
 * additive base edit is the `"installProvider"` literal appended to `RpcMethod` in
 * `rpc-contract.ts` (§A.0/§A.2).
 *
 * The CONCRETE frozen catalog VALUES + the load-time pin-validation live in the
 * cli-runner package (`packages/cli-runner/src/catalog.ts`) — server-side, so the
 * catalog (the supply-chain allowlist) never ships to the browser bundle. This file
 * holds only the TYPES both sides share.
 *
 * Grounded-on: install-contract spec FROZEN v2/R6, base RPC contract FROZEN v2.
 */

import type { RpcProviderKind } from "./rpc-contract.js";
import type { ProviderInstallState } from "@jarv1s/shared"; // base §9.2 enum, reused verbatim

// ---------------------------------------------------------------------------
// §A.2.1 — installProvider wire types (additive; mirror the §3.4 envelope)
// ---------------------------------------------------------------------------

/**
 * params for method "installProvider" (install-contract §A.2.1). `installProvider`
 * is a NON-SESSION verb (no `sessionKey`, like `probeProvider`/`listLiveSessions`).
 */
export interface RpcInstallProviderParams {
  /**
   * Which catalog provider to install. Two distinct bad_request paths (§A.2.3): a
   * value that is NOT an `RpcProviderKind` ⇒ the `isProviderKind` mirror rejects
   * ("unknown provider"); a value that IS a kind but whose catalog status is
   * "blocked" (e.g. agy pre-spike) ⇒ the distinct catalog-blocked rejection.
   */
  readonly provider: RpcProviderKind;
}

/**
 * result for method "installProvider" — the TERMINAL outcome (install-contract
 * §A.2.1). The WIRE result carries only the final settled state; the api maps it onto
 * the persisted `ProviderInstallState` (§A.4). A FAILED install is an `RpcOk` with
 * `state:"error"` (a normal terminal outcome), NOT an `RpcErr` (§A.2.3).
 */
export interface RpcInstallProviderResult {
  /**
   * Terminal install state for this verb: "installed" on success (binary present +
   * version-verified, not yet authenticated), or "error" on any
   * verify/download/promote failure (rolled back, §A.3.5). NEVER "ready"/"needs_login"
   * — login is Phase 3, not this verb.
   */
  readonly state: Extract<ProviderInstallState, "installed" | "error">;
  /**
   * The installed version (npm package version / artifact version) once verified.
   * Present iff `state === "installed"`.
   */
  readonly version?: string;
  /**
   * Redacted (§6.4) human-readable detail on "error". Safe to log + persist into
   * `provider_install_state.message`.
   */
  readonly message?: string;
  /**
   * True when the pinned version was ALREADY installed + re-verified — a no-op
   * (idempotent, §A.3.6).
   */
  readonly alreadyInstalled?: boolean;
  /**
   * #1081 H2: true ONLY when this call performed a REAL reinstall that replaced the live
   * binary on disk (the `installNpm`/`installArtifact` success path) — false on the
   * `tryIdempotentNoop` `alreadyInstalled` no-op path, where nothing on disk changed. A
   * running instance's `/api/onboarding/provider-install` handler uses this to decide
   * whether to drop+relaunch that provider's live chat sessions (an old engine process
   * still holds the STALE binary in its exec image); the boot-time reconcile
   * (`InstallService.reconcileInstalledProviders`, #1081 H1) sets no sessions to drop —
   * it runs before any session exists — so it ignores this field entirely.
   */
  readonly binaryChanged?: boolean;
}

// ---------------------------------------------------------------------------
// §A.1.1 — Recipe catalog TYPE (the supply-chain allowlist shape, frozen)
// ---------------------------------------------------------------------------

/**
 * The CONCRETE, per-provider mechanism that disables runtime self-update for the
 * pinned version (§A.3.7). NOT a vague "configure it off" — the exact key the pinned
 * CLI version honors:
 *  - kind "env": a NON-SECRET control env var the CLI reads (e.g. `DISABLE_AUTOUPDATER=1`).
 *    The named key MUST also be an additive entry on the §7.2 CLI-subprocess allowlist
 *    (so the launched CLI receives it) AND its `key=value` MUST be sourced into the
 *    cli-runner `process.env` at boot (`main.ts`) BEFORE the tmux fork — the §7.2
 *    passthrough is a FILTER, not a setter, so allowlisting alone is a no-op (§A.3.7).
 *  - kind "config": a config-file fragment the installer WRITES into the install/HOME
 *    at install time (e.g. a `~/.codex/config.toml` `check_for_update_on_startup = false`).
 *    No env-sourcing problem (it is a file) — PREFERRED where the pinned CLI honors it.
 */
export type SelfUpdateDisable =
  | { readonly kind: "env"; readonly key: string; readonly value: string }
  | { readonly kind: "config"; readonly path: string; readonly content: string };

/** An npm-registry recipe: an EXACT version + a COMMITTED integrity-bearing lockfile. */
export interface NpmInstallRecipe {
  readonly kind: "npm";
  /** The npm package, e.g. "@anthropic-ai/claude-code". */
  readonly pkg: string;
  /** EXACT version — no ^, ~, ranges, "latest", or dist-tags. Validated by §A.1.4. */
  readonly version: string;
  /**
   * REQUIRED for a `supported` npm recipe: a repo-relative path to a COMMITTED,
   * integrity-bearing lockfile (an `npm-shrinkwrap.json` / `package-lock.json` whose
   * EVERY resolved package — top-level AND the FULL transitive tree — carries a
   * `sha512` `integrity`). Copied into the staging prefix; install runs `npm ci`
   * (§A.3.3/§A.3.4), enforcing the lockfile EXACTLY. Absent/placeholder/partial ⇒ the
   * load-time assertion (§A.1.4) demotes the recipe to `blocked`. Regenerated ONLY at
   * the deliberate build-time pin step, never at install.
   */
  readonly lockfile: string;
  /**
   * Optional npm package-level integrity (sha512-<base64>, the registry's
   * `dist.integrity`) for the TOP-LEVEL `pkg@version`. The committed `lockfile` is the
   * authoritative full-tree integrity source (§A.3.4); this is a redundant top-level
   * cross-check only.
   */
  readonly integrity?: string;
  /**
   * The binary name the installed package exposes on PATH (the §A.5 re-probe target).
   * claude → "claude"; codex → "codex" (matches PROVIDER_BINARY, cli-availability.ts).
   */
  readonly binary: string;
  /**
   * The package ships per-arch native binaries via optionalDependencies (amd64 +
   * arm64 — BOTH claude AND codex do this). The install resolves the host-arch optional
   * dep EXPLICITLY/deterministically (§A.1.3) rather than via npm's optional-dep
   * heuristics or any lifecycle script — so the install runs with `--ignore-scripts`
   * and does NOT need `--omit=optional`.
   */
  readonly archOptionalDeps?: boolean;
  /**
   * The npm package NAME of the per-arch native-binary optionalDependency for THIS host
   * arch, resolved explicitly when `archOptionalDeps` is set (§A.1.3) — the
   * lockfile-node_modules KEY (e.g. `@anthropic-ai/claude-code-linux-x64`,
   * `@openai/codex-linux-x64`) the lockfile already pins. The install confirms exactly
   * this package from the lockfile-pinned version (no lifecycle script) and verifies
   * its binary. A host arch with no entry is a DEFINED verify FAILURE (§A.1.3), never
   * an undefined deref.
   */
  readonly archBinaryPackage?: Readonly<Record<"linux-x64" | "linux-arm64", string>>;
  /**
   * OPTIONAL explicit native-binary placement (§A.1.3) — REQUIRED only for a recipe whose
   * main-package `bin` wrapper is a STUB that errors without its postinstall (claude:
   * `bin/claude.exe` prints "native binary not installed" and exits 1; the real 233MB binary
   * ships in the per-arch optionalDependency and the package's `install.cjs` postinstall
   * normally `copyFileSync`s it OVER the wrapper). Because the install runs with
   * `--ignore-scripts` (§A.3.3), that postinstall never executes, so the install service
   * replicates ONLY the file placement it would do — DETERMINISTICALLY, never by running the
   * script. After `npm ci` and BEFORE verify, the service replaces
   * `<staging>/node_modules/<pkg>/<wrapperRelPath>` with the per-arch package's native binary
   * `<staging>/node_modules/<archPkg>/<archBinaryFile>` (relative symlink/copy + chmod 0o755),
   * where `archPkg` is the host-arch `archBinaryPackage` entry.
   *
   * When ABSENT, NO placement is done — the recipe's wrapper is expected to self-resolve the
   * native binary at runtime (codex's `bin/codex.js` does `require.resolve` of its per-arch
   * package, so `codex --version` works straight out of `npm ci --ignore-scripts`).
   */
  readonly archBinaryPlacement?: {
    /** File WITHIN the per-arch package that IS the native binary (claude: "claude"). */
    readonly archBinaryFile: string;
    /** Path WITHIN the main package to overwrite with the native binary (claude: "bin/claude.exe"). */
    readonly wrapperRelPath: string;
  };
  /** REQUIRED concrete self-update-disable mechanism for the pinned version (§A.3.7). */
  readonly selfUpdateDisable: SelfUpdateDisable;
}

/** A versioned-artifact recipe: a pinned URL + a pinned SHA512. Self-update DISABLED. */
export interface ArtifactInstallRecipe {
  readonly kind: "artifact";
  /** A VERSIONED, immutable artifact URL (the version is in the path — never "latest"). */
  readonly url: string;
  /** The artifact's pinned lowercase-hex SHA512. Rejected unless it matches (§A.3.4). */
  readonly sha512: string;
  /** Semantic version recorded into provider_install_state.version + verified via --version (§A.3.4). */
  readonly version: string;
  /** Binary name on PATH after promote (agy → "agy"). */
  readonly binary: string;
  /** REQUIRED concrete self-update-disable mechanism for the pinned version (§A.3.7). */
  readonly selfUpdateDisable: SelfUpdateDisable;
}

export type InstallRecipe = NpmInstallRecipe | ArtifactInstallRecipe;

/**
 * A catalog entry. `status: "supported"` → installable now; `status: "blocked"` →
 * present in the type for documentation but REJECTED at install (no
 * pinnable/checksummed artifact yet, e.g. agy until its spike; or a recipe demoted by
 * the §A.1.4 load-time assertion). A provider absent from the catalog is ALSO rejected.
 */
export interface CatalogEntry {
  readonly provider: RpcProviderKind;
  readonly status: "supported" | "blocked";
  /** Present iff status === "supported". A blocked entry carries no installable recipe. */
  readonly recipe?: InstallRecipe;
  /** Human-readable reason when blocked (surfaced as the redacted error message). */
  readonly blockedReason?: string;
}

/** The single source of truth. NOT env-overridable, NOT user-supplied — a frozen module constant. */
export type ProviderCatalog = Readonly<Record<RpcProviderKind, CatalogEntry>>;
