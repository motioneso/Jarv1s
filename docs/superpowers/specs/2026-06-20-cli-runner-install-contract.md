# Spec (ADDENDUM): cli-runner on-demand installer contract — #342 Phase 2

- **Status:** **FROZEN v2 / R6** (Phase-2 build contract). **ADDITIVE addendum** to the FROZEN RPC contract
  `docs/superpowers/specs/2026-06-20-cli-runner-rpc-contract.md` (the "base contract"). This document
  **adds** one RPC verb, new wire types, a server-side recipe catalog, an install service, and the
  state-transition/onboarding wiring. **It changes NO frozen shape** — every existing envelope, method,
  type, env var, mount, and ownership rule in the base contract stands unchanged. New verbs/types are
  additive only (§A.0).
- **Revision R6 (2026-06-20, pre-build freeze — cross-model second pass: Codex gpt-5.5 + Opus critic, both
  REVISE):** closed two real defects the prior rounds missed plus four minor gaps, all grounded in the
  Phase-1 code. (1) **`kind:"env"` self-update-disable never reached the launched CLI** — `buildSanitizedCliEnv`
  is a passthrough FILTER, not a setter, so allowlisting alone was a no-op; the value is now **sourced into
  the cli-runner `process.env` at boot from the catalog (`main.ts`)** before the tmux fork, with `kind:"config"`
  preferred where honored, and the test asserts the launched-CLI env, not the allowlist (A.3.7, A.7.4).
  (2) **Staging/promote contradiction** — "remove staging on success" dangled `current → <staging>`; the npm
  staged tree is now `rename`d into a **durable `providers/<provider>/releases/<rand>` lane** before the
  `current`-flip, the just-promoted release is never deleted, only the superseded prior release is GC'd, and
  the stable `bin/<binary>` symlink is created once on first install (A.3.2, A.3.5). (3) **`.staging`/release
  startup sweep** given a named owner distinct from the engine-host auth-volume sweep (A.3.2). (4) **Tools-volume
  sharing** between install and live-chat stated precisely (disjoint by lock/auth-volume; atomic flip ⇒ no
  half-state; running CLI keeps its inode) (A.5.1). (5) **Post-install runtime-tamper residual** named honestly
  as a #347 same-UID-class deferral (launch-time hash-verify / read-only tools mount) (A.6.3). (6) **codex
  host-arch resolver** (`os.arch()` mapping) + unsupported-arch = defined verify failure (A.1.3). The catalog
  `<PINNED_*>` placeholders remain a build-time pin step (A.1.2/A.1.4 force `blocked` if unfilled) — the
  Catalog build stage resolves them to real values or ships that provider `blocked`.
- **Date:** 2026-06-20
- **Owner:** #342 in-container CLI chat (overnight build, Ben-delegated approvals)
- **GitHub:** #342 (epic #47, Phase 2). Plan: `docs/superpowers/plans/2026-06-20-in-container-cli-chat.md`
  (Phase 2 items 8–10 + the agy/Antigravity risk).
- **Grounded-on:** `origin/main` ff34061; Phase-1 merged code in `/home/ben/jarvis-342-p1` (cli-runner
  server/connection/engine-host/sanitized-env/main, `cli-chat-engine.ts` probe surface,
  `packages/settings/sql/0103_provider_install_state.sql`, `packages/shared/src/onboarding-api.ts`
  `ProviderInstallState`), and the FROZEN base contract in `/home/ben/jarvis-342-build`.
- **Builds on, does not re-freeze:** the base contract's §3 transport/framing/hello, §4 methods (incl.
  `probeProvider` §4.8), §7 sanitized-env allowlist, §9 provider state machine. Read those first; this
  addendum only fills the Phase-2-deferred installer (base contract §2 "Out", §15).

> **This document is FROZEN and additive.** The Phase-2 installer lane builds against it with no further
> coordination. Where a value is not specified here, that is a contract gap — escalate, do **not** invent.
> The base contract's framing/hello/envelope/redaction/single-active-user rules are **inherited verbatim**.

---

## A.0 Additive-only invariant (what this addendum MUST NOT touch)

The base contract is FROZEN. This addendum is layered strictly on top:

- **No frozen shape changes.** `RpcRequest`/`RpcOk`/`RpcErr`/`RpcError`, `MAX_FRAME_BYTES`, the §3.6 hello
  frames, `RpcLaunchParams`/`RpcReadNewResult`/… and the `CliChatEngine` interface are unchanged.
- **`RpcMethod` is EXTENDED additively** — `"installProvider"` is appended to the existing union
  (base §3.4). The new verb reuses the **same** §3.4 request/ok/err envelope, the **same** §3.6 auth hello,
  the **same** §3.2 length-prefixed framing, the **same** §6.4 redaction, and the **same** §4.7 error→HTTP
  mapping. No new envelope, no new error code (it reuses `unavailable`/`bad_request`/`internal`).
- **`installProvider` is a NON-SESSION verb** — exactly like `listLiveSessions` (§4.6) and `probeProvider`
  (§4.8): no `sessionKey`, instance-wide, gated solely by the §3.6 connection auth hello (only the api holds
  `JARVIS_CLI_RUNNER_RPC_SECRET`; the CLI subprocesses are excluded from it, §7.2). It is **NOT** a chat
  launch: no MCP token is minted, injected, or required; no replay; no neutral-dir/persona write; the
  single-active-user gate (§4.1.0a) does **not** apply (it gates live engines, not installs).
- **`ProviderInstallState`** (base §9.2 enum, `onboarding-api.ts:44-50`) and the persistence table
  `app.provider_install_state` (`packages/settings/sql/0103_provider_install_state.sql`) are reused
  **verbatim** — this addendum does not add states or columns. It only defines **who writes them when**.
  - **Table-name reconciliation (authoritative):** the base contract §9.2 *sketched* the table as
    `app.provider_state`; the migration that actually landed (0103) created **`app.provider_install_state`**.
    **`app.provider_install_state` is the authoritative name and is used everywhere in this addendum.** The
    §9.2 `app.provider_state` string is a non-binding sketch superseded by the real migration — no other
    base shape changes.
- **A new wire-type file** `packages/chat/src/live/install-contract.ts` holds the install verb's params/
  result/progress shapes + the catalog type, and **imports** `RpcProviderKind` from `rpc-contract.ts`
  read-only. It does NOT re-declare any base wire type. (Co-locating in `rpc-contract.ts` is acceptable; a
  separate file keeps the Phase-2 surface isolated. Either way, additive.)

---

## A.1 RECIPE CATALOG (server-side allowlist — the supply-chain core)

The catalog is a **typed, server-side, compile-time-constant allowlist** mapping each provider to exactly
one pinned install recipe. **The catalog IS the allowlist: any provider not present (or marked `blocked`)
is rejected with `RpcErr code "bad_request"`.** There is **NO** `latest`, **NO** `^`/`~`/range version, **NO**
mutable tag, **NO** unpinned `curl | bash`. A recipe with an unpinnable/unchecksummed artifact ships
`blocked` (experimental) — claude + codex are the certain MVP; agy is gated on its pinning spike.

### A.1.1 Catalog type (frozen)

Lives in `packages/chat/src/live/install-contract.ts`. `RpcProviderKind` is imported from
`rpc-contract.ts`. Two recipe kinds: `npm` (registry package pinned to an exact version AND a committed,
full-tree-`sha512` lockfile installed via `npm ci`) and `artifact` (a versioned URL + SHA512). The
discriminant is `recipe.kind`.

```typescript
import type { RpcProviderKind } from "./rpc-contract.js";

/** An npm-registry recipe: an EXACT version + a COMMITTED integrity-bearing lockfile. */
export interface NpmInstallRecipe {
  readonly kind: "npm";
  /** The npm package, e.g. "@anthropic-ai/claude-code". */
  readonly pkg: string;
  /** EXACT version — no ^, ~, ranges, "latest", or dist-tags. Validated by A.1.4. */
  readonly version: string;
  /**
   * REQUIRED for a `supported` npm recipe: a repo-relative path to a COMMITTED,
   * integrity-bearing lockfile (an `npm-shrinkwrap.json` / `package-lock.json` whose EVERY
   * resolved package — top-level AND the FULL transitive tree — carries a `sha512` `integrity`).
   * The lockfile is copied into the staging prefix and the install runs `npm ci` (A.3.3/A.3.4),
   * which enforces the lockfile EXACTLY and fails on any tree drift or integrity mismatch. This
   * closes the top npm attack vector: without a committed lockfile the transitive tree resolves
   * fresh on every install (unpinned semver), so a `supported` npm recipe MUST reference a
   * lockfile — absent ⇒ the load-time assertion (A.1.4) demotes the recipe to `blocked`. The
   * lockfile is regenerated ONLY at the deliberate build-time pin step (A.1.2), never at install.
   */
  readonly lockfile: string;
  /**
   * Optional npm package-level integrity (sha512-<base64>, the registry's `dist.integrity`) for
   * the TOP-LEVEL `pkg@version`. The committed `lockfile` is the authoritative, full-tree
   * integrity source (A.3.4); this top-level field is a redundant cross-check only. Whole-tree
   * integrity comes from `npm ci` against `lockfile`, NOT from this field.
   */
  readonly integrity?: string;
  /**
   * The binary name the installed package exposes on PATH (the §A.5 re-probe target).
   * claude → "claude"; codex → "codex" (matches PROVIDER_BINARY, cli-availability.ts:18-22).
   */
  readonly binary: string;
  /**
   * Note for codex: the package ships per-arch native binaries via optionalDependencies
   * (amd64 + arm64). The install resolves the host-arch optional dep EXPLICITLY/deterministically
   * (A.1.3) rather than relying on npm's optional-dep heuristics or any lifecycle script — so the
   * install runs with `--ignore-scripts` and does NOT need `--omit=optional`.
   */
  readonly archOptionalDeps?: boolean;
  /**
   * The npm package NAME of the per-arch native-binary optionalDependency for THIS host arch,
   * resolved explicitly when `archOptionalDeps` is set (A.1.3). e.g. for codex the
   * `@openai/codex-<os>-<arch>` package the lockfile already pins. The install adds exactly this
   * package from the lockfile-pinned version (no lifecycle script) and verifies its binary.
   */
  readonly archBinaryPackage?: Readonly<Record<"linux-x64" | "linux-arm64", string>>;
  /** REQUIRED concrete self-update-disable mechanism for the pinned version (A.3.7). */
  readonly selfUpdateDisable: SelfUpdateDisable;
}

/** A versioned-artifact recipe: a pinned URL + a pinned SHA512. Self-update DISABLED. */
export interface ArtifactInstallRecipe {
  readonly kind: "artifact";
  /** A VERSIONED, immutable artifact URL (the version is in the path — never a "latest" URL). */
  readonly url: string;
  /** The artifact's pinned lowercase-hex SHA512. The download is rejected unless it matches (A.3.4). */
  readonly sha512: string;
  /** Semantic version string recorded into provider_install_state.version + verified via --version (A.3.4). */
  readonly version: string;
  /** Binary name on PATH after promote (agy → "agy", cli-availability.ts:21). */
  readonly binary: string;
  /** REQUIRED concrete self-update-disable mechanism for the pinned version (A.3.7). */
  readonly selfUpdateDisable: SelfUpdateDisable;
}

/**
 * The CONCRETE, per-provider mechanism that disables runtime self-update for the pinned version
 * (A.3.7). NOT a vague "configure it off" — the exact key the pinned CLI version honors:
 *  - kind "env": a NON-SECRET control env var the CLI reads (e.g. `<PROVIDER>_DISABLE_AUTO_UPDATE=1`).
 *    The named key MUST also be an additive entry on the §7.2 CLI-subprocess allowlist (so the launched
 *    CLI actually receives it) — see A.3.7. Carries the exact `key`/`value`.
 *  - kind "config": a config-file fragment the installer WRITES into the install/HOME at install time
 *    (e.g. a `~/.codex/config.toml` `disable_auto_update = true`). Carries the target `path` + `content`.
 * The pin step verifies the named mechanism is actually honored by the pinned version (A.1.4 documents it;
 * the spike must confirm it for agy before agy can be unblocked).
 */
export type SelfUpdateDisable =
  | { readonly kind: "env"; readonly key: string; readonly value: string }
  | { readonly kind: "config"; readonly path: string; readonly content: string };

export type InstallRecipe = NpmInstallRecipe | ArtifactInstallRecipe;

/**
 * A catalog entry. `status: "supported"` → installable now; `status: "blocked"` → present in the
 * type for documentation but REJECTED at install (no pinnable/checksummed artifact yet, e.g. agy
 * until its spike lands). A provider absent from the catalog is ALSO rejected.
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
```

### A.1.2 The frozen catalog values (MVP)

```typescript
export const PROVIDER_CATALOG: ProviderCatalog = {
  anthropic: {
    provider: "anthropic",
    status: "supported",
    recipe: {
      kind: "npm",
      pkg: "@anthropic-ai/claude-code",
      version: "<PINNED_EXACT>", // build-time: pin to a known-good EXACT version (A.1.4); NEVER "latest"
      // REQUIRED: a committed, full-tree-sha512 lockfile, copied into staging + installed via `npm ci`
      // (A.3.3/A.3.4). Regenerated only at the build-time pin step (A.1.2). Absent ⇒ blocked (A.1.4).
      lockfile: "packages/cli-runner/recipes/anthropic/npm-shrinkwrap.json",
      binary: "claude",
      // The CONCRETE self-update-disable key the pinned claude version honors (A.3.7). Pinner fills the
      // exact key/value the pinned version reads; it is added to the §7.2 allowlist as a non-secret control.
      selfUpdateDisable: { kind: "env", key: "<PINNED_CLAUDE_DISABLE_UPDATE_ENV>", value: "1" }
      // integrity: optional redundant top-level cross-check; whole-tree integrity is the lockfile + npm ci.
    }
  },
  "openai-compatible": {
    provider: "openai-compatible",
    status: "supported",
    recipe: {
      kind: "npm",
      pkg: "@openai/codex",
      version: "<PINNED_EXACT>", // build-time: pin to a known-good EXACT version (A.1.4)
      lockfile: "packages/cli-runner/recipes/openai-compatible/npm-shrinkwrap.json", // committed, full-tree sha512
      binary: "codex",
      archOptionalDeps: true, // ships per-arch native-binary optionalDeps; resolved EXPLICITLY (A.1.3)
      archBinaryPackage: {
        // build-time: the lockfile-pinned per-arch native-binary package names (A.1.3). Installed
        // explicitly + verified; NOT left to npm optional-dep heuristics or any lifecycle script.
        "linux-x64": "<PINNED_CODEX_LINUX_X64_PKG>",
        "linux-arm64": "<PINNED_CODEX_LINUX_ARM64_PKG>"
      },
      // The CONCRETE self-update-disable mechanism the pinned codex version honors (A.3.7). The pinner
      // picks env vs config from what the pinned version actually reads (e.g. a config.toml flag written
      // into HOME, or a non-secret control env added to the §7.2 allowlist).
      selfUpdateDisable: { kind: "config", path: "<PINNED_CODEX_CONFIG_PATH>", content: "<PINNED_CODEX_DISABLE_UPDATE>" }
    }
  },
  google: {
    // agy = Antigravity CLI. SUPPORTED only if the pinning spike yields a VERSIONED artifact URL +
    // a pinnable SHA512 AND self-update can be disabled (A.4). Until then it ships BLOCKED.
    provider: "google",
    status: "blocked", // flip to "supported" with the artifact recipe ONLY after the spike (plan risk)
    blockedReason: "agy/Antigravity pinning spike unresolved — no checksummed versioned artifact yet",
    recipe: undefined
    // When unblocked:
    // status: "supported",
    // recipe: { kind: "artifact", url: "<VERSIONED_URL>", sha512: "<PINNED_SHA512>",
    //           version: "<VERSION>", binary: "agy",
    //           // HARD precondition of unblocking: the spike must yield a CONCRETE self-update-disable
    //           // mechanism the pinned agy version honors (A.3.7). No mechanism ⇒ agy stays blocked.
    //           selfUpdateDisable: { kind: "config", path: "<AGY_CONFIG_PATH>", content: "<AGY_DISABLE_UPDATE>" } }
  }
} as const;
```

> **The exact pinned version strings AND the committed lockfiles are a single build-time pin step**,
> recorded into the recipe before the Phase-2 lane merges. A maintainer resolves the current known-good
> `@anthropic-ai/claude-code` and `@openai/codex` versions, writes them in literally, AND **regenerates
> the committed `npm-shrinkwrap.json` for each** (`npm install --package-lock-only` against the pinned
> `pkg@version`, then commit it under `packages/cli-runner/recipes/<provider>/`). **Lockfile
> regeneration happens ONLY here, at the deliberate pin step — never at install time** (install is
> `npm ci`, which only consumes the committed lockfile and refuses to write one). The contract freezes
> the **shape + policy** (exact pin, committed full-tree-sha512 lockfile, `npm ci` + `--ignore-scripts`,
> explicit arch-binary resolve, SHA512 verify, self-update off); the concrete version literals,
> per-arch binary-package names, and lockfile contents are filled by the pinner and reviewed in the PR.
> A placeholder `<PINNED_*>` literal (version, arch package, or an empty/missing lockfile) MUST NOT merge.

### A.1.3 codex per-arch native binary — EXPLICIT/deterministic resolution (no lifecycle script)

`@openai/codex` ships its native binary via per-platform `optionalDependencies`. The whole install runs
with **`--ignore-scripts`** (A.3.3 — no `preinstall`/`install`/`postinstall` lifecycle script executes
during the verify window), so the native binary is resolved **explicitly and deterministically**, NOT via
npm's optional-dep heuristics and NOT via a lifecycle script. The install (A.3) MUST:

- run `npm ci --ignore-scripts` against the committed lockfile (A.3.3) — `npm ci` already materializes the
  lockfile-pinned, integrity-checked tree (including the per-arch optional package, which is pinned in the
  lockfile), but because scripts are ignored, the package's own `postinstall` that would normally place /
  chmod the platform binary does **not** run; therefore
- **explicitly install + place the host-arch native binary**: **resolve the host-arch key by mapping
  `os.arch()`** — `"x64" → "linux-x64"`, `"arm64" → "linux-arm64"` (the only deploy targets) — then select
  the per-arch package name from `recipe.archBinaryPackage[<key>]` (the lockfile-pinned version). **A host
  arch with no `archBinaryPackage` entry (e.g. a future `riscv64`) is a DEFINED verify FAILURE → `state:"error"`
  / rollback (A.3.5), never an undefined `[key]` deref.** Confirm `npm ci` materialized that exact package +
  version under the staging prefix (full-tree integrity already enforced it), and locate/mark-executable its
  shipped binary deterministically (from the package's declared `bin` path) — no `curl`, no script, no
  network beyond the lockfile-pinned tarball, and
- **verify the platform binary actually resolved** on the run arch via the §A.5 re-probe + `--version`
  check **before promote** — on both `linux/amd64` and `linux/arm64` (the deploy targets). An install that
  "succeeds" but leaves no runnable `codex` binary for the arch is a verify FAILURE → rollback (A.3.5), not
  a silent half-install.

Because the per-arch dep is pinned in the lockfile and installed explicitly, **`--omit=optional` is NOT
used and NO lifecycle script runs** — the two are decoupled, which is the supply-chain win: arbitrary
postinstall code never executes, yet the correct native binary is still present and verified.

### A.1.4 Pin validation (rejects a bad recipe at load)

A startup assertion (and a unit test) rejects any recipe that is not properly pinned, so a mutable recipe
can never ship:

- `npm.version` MUST match `/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/` (an exact semver, no leading `^`/`~`/`>=`,
  no `latest`/`next`/dist-tag, no `*`).
- **`npm.lockfile` is MANDATORY for a `supported` npm recipe.** It MUST be a non-placeholder repo-relative
  path that exists and parses as a lockfile in which **every** resolved package (the full transitive tree,
  not just the top level) carries a `sha512` `integrity`. A `supported` npm recipe with a missing,
  placeholder, unparsable, or partially-unintegrified lockfile is **demoted to `blocked` at load** (treated
  exactly like agy — no installable recipe is exposed) and the load-time assertion records the reason. This
  is the same bar agy is held to: no full-tree integrity ⇒ not installable. (The lockfile content is not
  re-verified byte-for-byte at load — that is `npm ci`'s job at install — but its presence + structural
  integrity-coverage IS asserted, so a top-level-only pin can never ship.)
- For codex (`archOptionalDeps:true`), the per-arch `archBinaryPackage` entries MUST be present and
  non-placeholder for both `linux-x64` and `linux-arm64`.
- `artifact.url` MUST be `https:`, MUST contain the `version` substring (the version is in the path — a
  cheap "this URL is versioned, not a moving `latest`" check), and MUST NOT contain `latest`.
- `artifact.sha512` MUST be 128 lowercase hex chars; `artifact.version` non-empty.
- **`recipe.selfUpdateDisable` is MANDATORY and non-placeholder** for every `supported` recipe (A.3.7): an
  `env` mechanism MUST name a non-empty `key`/`value` (and that key MUST appear on the §7.2 CLI-subprocess
  allowlist); a `config` mechanism MUST name a non-empty `path`/`content`. A missing or `<PINNED_*>`
  self-update-disable forces `blocked`.
- A `supported` entry MUST carry a `recipe`; a `blocked` entry MUST NOT. A placeholder `<PINNED_*>` literal
  (version, arch package, lockfile path, or self-update-disable) fails validation / forces `blocked` (so it
  cannot reach `main`).

---

## A.2 `installProvider` RPC verb (additive; mirrors the §3.4 envelope)

`installProvider` is appended to `RpcMethod` (base §3.4) and reuses the entire frozen transport. It is
**non-session** (no `sessionKey`, like `probeProvider`/`listLiveSessions`).

### A.2.1 Wire types (additive — `install-contract.ts`)

```typescript
import type { RpcProviderKind } from "./rpc-contract.js";
import type { ProviderInstallState } from "@jarv1s/shared"; // base §9.2 enum, reused verbatim

/** params for method "installProvider". */
export interface RpcInstallProviderParams {
  /**
   * Which catalog provider to install. Two distinct bad_request paths (A.2.3): a value that is NOT an
   * RpcProviderKind ⇒ the isProviderKind mirror rejects ("unknown provider"); a value that IS a kind but
   * whose catalog status is "blocked" (e.g. agy pre-spike) ⇒ the distinct catalog-blocked rejection.
   */
  readonly provider: RpcProviderKind;
}

/**
 * result for method "installProvider" (the TERMINAL outcome). Progress is reported by the API to the
 * onboarding/state layer as it drives the install (A.4 state machine) — the WIRE result carries only the
 * final settled state. (Streaming progress is OPTIONAL and additive — A.2.2 — and rides the same envelope.)
 */
export interface RpcInstallProviderResult {
  /**
   * Terminal install state for this verb: "installed" on success (binary present + version-verified,
   * not yet authenticated), or "error" on any verify/download/promote failure (rolled back, A.3.5).
   * NEVER "ready"/"needs_login" — login is Phase 3, not this verb. The api maps this onto the persisted
   * ProviderInstallState (A.4).
   */
  readonly state: Extract<ProviderInstallState, "installed" | "error">;
  /** The installed version (npm package version / artifact version) once verified. Present iff state==="installed". */
  readonly version?: string;
  /** Redacted (§6.4) human-readable detail on "error". Safe to log + persist into provider_install_state.message. */
  readonly message?: string;
  /** True when the pinned version was ALREADY installed + re-verified — a no-op (idempotent, A.3.6). */
  readonly alreadyInstalled?: boolean;
}
```

### A.2.2 Optional progress stream (additive; same envelope)

Phase-2 MVP is **request/response** (the install runs to completion server-side and returns the terminal
`RpcInstallProviderResult`; the api persists `installing` before the call and `installed`/`error` after).
This is sufficient because npm/artifact installs are bounded (seconds–low-minutes) and the onboarding UI
polls. **An optional progress stream is reserved, additive, and rides the SAME §3.4 envelope** — should the
build want live progress, the server MAY emit zero-or-more interim `RpcOk` frames echoing the request `id`
with `result: RpcInstallProgress` BEFORE the terminal frame, each carrying `complete: false`:

```typescript
export interface RpcInstallProgress {
  readonly phase: "resolving" | "downloading" | "verifying" | "promoting";
  readonly state: "installing"; // always "installing" during progress
  readonly complete: false; // the client keeps reading until the terminal RpcInstallProviderResult
}
```

If the stream is NOT implemented in Phase 2 (the frozen default), the verb is a plain single
request→single response. Adding the stream later is additive (no envelope change) — exactly the §3.2
note about chunking being a `complete:false` continuation convention.

### A.2.3 Errors (reuse base §3.4 codes — NO new code)

Two **distinct rejection paths** both reuse `bad_request` but are produced by **different code paths with
different messages** (the reviewer's correctness ask — do not conflate "not a kind" with "a kind but
blocked"):

| Condition | `RpcErrorCode` | Code path / Notes |
| --- | --- | --- |
| `provider` value is **not an `RpcProviderKind`** (e.g. `"gemini"`, `42`, missing) | `bad_request` | **`isProviderKind` mirror** (connection.ts:269) rejects FIRST, before the catalog is consulted — message ≈ `"unknown provider"`. A semantically-invalid value; does NOT close (§3.7). |
| `provider` **IS a valid kind** but its catalog `status:"blocked"` (or — defensively — absent from `PROVIDER_CATALOG`) | `bad_request` | **distinct catalog-blocked rejection** — a different code path + message (≈ `"provider not installable: <blockedReason>"`, surfacing `CatalogEntry.blockedReason`, redacted §6.4). **agy-while-blocked lands HERE**, not in the `isProviderKind` path. Does NOT close. |
| install in progress for this provider (lock held, A.3.1) | `bad_request` | re-entrant install of an in-flight provider is rejected (serialized, A.3.1); NOT a close. Distinct message (≈ `"install already in progress"`). |
| download/verify/promote failure | returned as `RpcInstallProviderResult{ state:"error", message }` on an **`RpcOk`** | a *failed install* is a normal terminal OUTCOME, not a transport error — the verb succeeds, the result says `error`. Reserve `RpcErr internal` for an unexpected server fault (e.g. the lock impl throws). |
| oversize/ malformed frame | (transport) | inherited from §3.2/§3.7 — closes the connection. |

> **Why two `bad_request` paths, not one.** `isProviderKind` is the type-guard mirror (the value isn't even a
> provider kind — a client/protocol bug); catalog-blocked means the value IS a known provider the operator
> simply cannot install yet (agy pre-spike, or a recipe demoted to `blocked` by the load-time assertion,
> A.1.4). They are the **same wire code** (`bad_request`, no new code per A.0) but **different branches +
> messages**, so onboarding can tell "you sent garbage" from "this provider isn't available on this build."

> **Design call (frozen): a failed install is an `RpcOk` with `result.state==="error"`, not an `RpcErr`.**
> Rationale: the api needs the redacted `message` + the fact-of-failure to persist `error` into
> `provider_install_state` and surface a retry in onboarding; modelling it as a transport error would
> conflate "the install failed" with "the socket/RPC failed" (which triggers reconnect+reconciliation,
> §3.5/§5.3 — wrong response to a failed npm install). `RpcErr` is reserved for malformed/blocked input
> (`bad_request`) and unexpected server faults (`internal`).

### A.2.4 Dispatch (engine-host + connection, additive)

Mirrors the existing non-session verbs in `packages/cli-runner/src/connection.ts:180-228` and
`engine-host.ts`:

- `connection.ts invoke()` gains a `case "installProvider":` with **two ordered validation gates**, both
  mapping to `bad_request` (§3.7) but distinct (A.2.3):
  1. **Kind guard (first):** `isProviderKind(params.provider)` (connection.ts:269 mirror). False ⇒ throw
     `BadRequestError("unknown provider")` — exactly like `probeProvider`. The catalog is not consulted.
  2. **Catalog-status gate (second):** look up `PROVIDER_CATALOG[provider]`; if absent or
     `status:"blocked"`, throw a **distinct** `BadRequestError` carrying the redacted `blockedReason`
     (e.g. `"provider not installable: <reason>"`). agy-while-blocked is rejected here, NOT by the kind
     guard. Only a valid + `supported` provider reaches `host.installProvider(provider)`.
- `CliChatEngineHost` gains `installProvider(provider): Promise<RpcInstallProviderResult>` that delegates to
  the **install service** (A.3). It does **NOT** go through the per-`sessionKey` queue (no session) nor the
  §4.1.0a admission mutex (no live engine — the install lane is volume-disjoint from admission, A.5.1); it
  takes the install service's **own per-provider lock** (A.3.1).

---

## A.3 INSTALL SERVICE contract (hardening — supply-chain core)

A new module under cli-runner (e.g. `packages/cli-runner/src/install-service.ts`) that performs the
install entirely **inside the cli-runner sidecar** under a **sanitized installer env** (the §7.2 allowlist
PLUS only the non-secret registry/proxy vars an npm install needs — A.3.3; no app secrets) with network
egress to the registry/artifact host. It installs into `/data/cli-tools` (`NPM_CONFIG_PREFIX`, base §7.1);
`PATH` already includes `/data/cli-tools/bin`. All invariants below (A.3.1–A.3.8) are FROZEN.

### A.3.1 SERIALIZED per provider (concurrency lock)

- One **per-provider mutex** — reuse the `Mutex` **class** from `packages/cli-runner/src/mutex.ts`, but a
  **separate instance per provider**, distinct from the §4.1.0a admission mutex (the install lane is
  volume-disjoint from admission and does NOT share its lock — A.5.1). A second `installProvider(P)` while
  `P` is in flight is **rejected** (not queued) with `RpcErr bad_request` (A.2.3, the "install already in
  progress" path) — so the UI never silently stacks installs. Different providers MAY install concurrently
  (independent temp prefixes, independent locks).
- The lock is **held across the WHOLE** resolve→download→verify→promote sequence (A.3.2–A.3.4) and released
  in a `finally`, so a crashed/timed-out install cannot strand the lock indefinitely — bound the whole
  sequence by an install timeout (e.g. a generous `installTimeoutMs`, analogous to the §4.1.0a
  `launchTimeoutMs`); on timeout the install fails (rollback, A.3.5) and the lock releases.

### A.3.2 TEMP prefix on the SAME filesystem as the tools volume

- Install into an **EPHEMERAL temp prefix UNDER the tools volume** — e.g.
  `/data/cli-tools/.staging/<provider>-<rand>` — **never** `/tmp` or any other mount. Same-filesystem is
  mandatory so the A.3.5 promote (a same-dir `rename` of the verified tree into the provider's durable
  release lane + an atomic `current`-symlink flip) never crosses a device boundary. For the npm recipe the
  staging prefix is the npm `--prefix` (the `.staging` dir, **not** `/data/cli-tools` directly — so npm never
  writes the live `bin/<binary>` itself); for the artifact recipe the artifact is downloaded into the
  staging dir.
- **TWO distinct areas, both on the tools volume (R6 — closes the dangling-`current` trap):** (a) the
  **EPHEMERAL staging scratch** `/data/cli-tools/.staging/<provider>-<rand>` (`0700`, run uid) where
  `npm ci` runs and verify (A.3.4) happens — **removed on FAILURE** (rollback) and **emptied on SUCCESS**
  (its verified tree is `rename`d OUT into the release lane by A.3.5, leaving nothing to delete); and (b)
  the **DURABLE per-provider release lane** `/data/cli-tools/providers/<provider>/releases/<rand>` that
  `current` points at after promote — this is **NEVER deleted while `current` resolves to it** (deleting it
  would dangle `current` and break the install). So **"removed on success" means the ephemeral scratch and,
  by GC, the SUPERSEDED PRIOR release once `current` has flipped off it — never the just-promoted release.**
- **Startup sweep (named owner, R6).** A tools-volume sweep — owned by the **install service / `main.ts`
  boot, ordered BEFORE the first `installProvider` is accepted** and **DISTINCT** from the engine-host
  neutral-base clean-slate sweep (`engine-host.ts:265`, which only clears the **auth** volume) — (1) clears
  orphaned `/data/cli-tools/.staging/*` and (2) GCs any `providers/<provider>/releases/<rand>` dir **not**
  referenced by that provider's `current` symlink (a crash between the release-`rename` and the
  `current`-flip can orphan one).

### A.3.3 No shell `curl | bash`; `npm ci --ignore-scripts`; installer-env allowlist

- **npm recipe:** copy the recipe's **committed lockfile** (`recipe.lockfile`) into the staging prefix
  alongside a minimal generated `package.json` pinning exactly `pkg@version`, then invoke npm
  **non-interactively** via the runner's `TmuxIo.run` (execFile-style, **not** a shell string — same
  discipline as the rest of cli-runner) as **`npm ci --ignore-scripts --prefix <staging>`**:
  - **`npm ci`** installs the EXACT committed lockfile tree and enforces **full-tree `sha512` integrity**
    for every resolved package (top-level AND transitive), failing on any drift — this is the transitive
    integrity guarantee. (`npm ci` requires the lockfile; it never resolves fresh semver and never writes a
    lockfile, which is why the lockfile is regenerated only at the pin step, A.1.2.)
  - **`--ignore-scripts`** blocks every `preinstall`/`install`/`postinstall` lifecycle script during the
    verify window — no arbitrary package code runs at install. The codex native binary is then resolved
    **explicitly/deterministically** (A.1.3) from the lockfile-pinned per-arch package, so `--omit=optional`
    is unnecessary and no lifecycle script is needed to place the binary.
  - **Never** `npm install -g <pkg>@latest`, **never** a bare `npm install` (which would re-resolve the
    tree), **never** a piped `curl … | bash`, **never** a postinstall-trusting global mutation of the live
    prefix.
- **artifact recipe:** download the **pinned versioned URL** over HTTPS to the staging dir (no redirect to
  a different host; TLS verified), then SHA512-verify (A.3.4) **before** the binary is ever marked
  executable or placed on PATH. **No `curl | bash`** — fetch-then-verify-then-promote, never fetch-and-run.
- **Installer process env = a distinct INSTALLER-ENV allowlist** (NOT the bare §7.2 CLI-subprocess
  allowlist, because an npm install legitimately needs registry/proxy configuration the CLI runtime does
  not). It is the **§7.2 allowlist PLUS exactly these non-secret network-config vars**, and **nothing
  secret**:
  - the full §7.2 CLI-subprocess allowlist (`HOME`, `PATH`, `NPM_CONFIG_PREFIX`,
    `JARVIS_CLI_TOOLS_PREFIX`, `JARVIS_CLI_HOME*`, `JARVIS_CLI_NEUTRAL_BASE`, `JARVIS_HOST_UID/GID`, `TERM`,
    `LANG`, `LC_*`, `TMPDIR`), PLUS
  - **`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`** (and their lowercase forms) and **`NPM_CONFIG_REGISTRY`** —
    the registry/proxy vars a legitimate npm install needs in a proxied/mirrored deploy.

  Concretely the installer reuses `buildSanitizedCliEnv` (`sanitized-env.ts:40`) and then layers ONLY the
  above proxy/registry keys on top (a separate `buildSanitizedInstallerEnv` / explicit extra-allowlist —
  additive to §7.2, same deny-by-default posture). It therefore sees **no** `BETTER_AUTH_SECRET`,
  `JARVIS_AI_SECRET_KEY`, `JARVIS_CONNECTOR_SECRET_KEY`, DB URLs / role passwords, vault paths, the RPC
  secret, or the socket path — a poisoned tarball/lifecycle (already blocked by `--ignore-scripts`) would
  find nothing to exfiltrate. (Network egress to the registry/artifact host is a deploy/compose concern —
  the cli-runner has outbound network; it exposes no listener, base §3.1.)

### A.3.4 VERIFY before promote (the gate)

After staging, **before** anything is placed on the live PATH, the service verifies, and a failure of ANY
check is a verify failure → rollback (A.3.5):

- **npm:** `npm ci` succeeded against the committed lockfile (full-tree `sha512` integrity enforced — any
  drift or integrity mismatch already failed the install); the staged prefix actually produced the recipe's
  `binary` (`<staging>/bin/<binary>` exists + executable); the installed package's resolved version
  **equals** `recipe.version`; the binary's own `--version` output **matches** `recipe.version` (the §A.5
  re-probe target). For codex, the **per-arch native binary was resolved EXPLICITLY** (A.1.3) — the
  lockfile-pinned `archBinaryPackage` is present and its `--version` actually runs on this arch.
- **artifact:** the downloaded file's computed **SHA512 equals `recipe.sha512`** (constant-time compare),
  THEN the binary is marked executable and its `--version` is checked **against `recipe.version`**.
- A version mismatch, a missing binary, a failed `--version`, a failed `npm ci`/integrity check, or
  (artifact) a SHA512 mismatch ⇒ **do NOT promote**; roll back.

**TOCTOU close (verify→promote): pin the staged hash at verify time, re-verify it after promote.** Between
the verify checks and the atomic promote there is a window in which the staged tree could be tampered with.
To close it, at verify time the service computes and **pins a SHA512 over the exact promote target** — for
npm that is the staged `bin/<binary>` (and its real resolved target, dereferencing the bin symlink), for
artifact the verified binary file. **Immediately AFTER promote**, the service re-computes the SHA512 of the
now-live promote target and asserts it **equals the pinned verify-time hash**. A mismatch ⇒ the promote did
not place the exact bytes that were verified ⇒ treat as a verify failure: roll back (A.3.5), leave the prior
install live, return `state:"error"`. (For the symlink-flip promote this confirms
`current → releases/<rand>` resolves to the same verified bytes; for the rename promote it confirms the
renamed tree's binary is byte-identical.) The pinned verify-time hash is also recorded so the idempotent
re-verify (A.3.6) can re-compare on-disk bytes, not just `--version`.

### A.3.5 ATOMIC promote; ROLLBACK on any failure

**Promote mechanism is FROZEN to exactly ONE form per recipe kind (not an OR — pick by `recipe.kind`):**

- **npm recipe → `rename` the verified tree into a durable release lane, THEN per-provider `current`
  symlink-flip.** `npm ci` installs into the **ephemeral `.staging` scratch** (A.3.2a); after verify
  (A.3.4) the verified tree is atomically **`rename`d (same-fs) into the durable release dir**
  `/data/cli-tools/providers/<provider>/releases/<rand>` — so `current` **never points into `.staging`**
  (closing the R6 trap where "remove staging on success" would dangle `current`). Promote then flips
  `/data/cli-tools/providers/<provider>/current → releases/<rand>` by writing a temp symlink in the same
  directory and `rename`-ing it onto `current` (same-dir, same-fs ⇒ atomic POSIX rename). The PATH entry
  `/data/cli-tools/bin/<binary>` is a stable symlink that resolves **through** `…/<provider>/current`; it is
  **created ONCE on the first-ever install of a provider** (symlink-to-temp + `rename`, idempotent on later
  installs) and is **never a real file npm wrote** (npm ci uses the `.staging` prefix, not `/data/cli-tools`
  directly). The flip swaps the whole install atomically; the **prior release stays on disk until the flip
  succeeds** (trivial rollback = flip `current` back), then is GC'd (A.3.2). The shared `NPM_CONFIG_PREFIX`
  (`/data/cli-tools`, base §7.1) is preserved — providers share the prefix but each owns its
  `providers/<provider>/` lane, so two providers never collide.
- **artifact recipe → atomic `rename` of the verified binary onto its live path.** The single verified
  binary file is `rename`d from staging onto `/data/cli-tools/providers/<provider>/<binary>` (same-fs ⇒
  atomic), with the PATH entry `/data/cli-tools/bin/<binary>` a stable symlink to it. (A single file needs
  no symlink-lane indirection; the atomic rename is sufficient and simplest.)

The post-promote SHA512 re-verify (A.3.4) confirms PATH now resolves to the exact verified bytes. **No
partially-written binary is ever on PATH** — PATH only ever points at a fully-verified install.

- **ROLLBACK leaves the prior install intact.** On ANY download/verify/promote failure, the service
  **removes the ephemeral `.staging` scratch** — and, if the failure was a **POST-promote re-hash mismatch**
  (A.3.4), **flips `current` back to the prior release and removes the just-promoted `releases/<rand>`** — so
  the previously-promoted install (if any) is left untouched and still live (the user keeps a working prior
  CLI). The terminal result is `state:"error"` (A.2.1) with a redacted message; the api persists `error` and
  the prior `version` is unchanged.

### A.3.6 IDEMPOTENT

- A re-install of the **already-pinned version** is a **no-op safe re-verify** ONLY when the on-disk bytes
  still match. The re-verify MUST **re-compute the live binary's on-disk SHA512** and compare it to the
  recipe's expectation — for an artifact recipe directly against `recipe.sha512`; for an npm recipe against
  the verify-time hash pinned + recorded for that pinned version at its last successful install (A.3.4) —
  **in addition to** the §A.5 re-probe + `--version` check. A `--version`-only check is insufficient: a
  tampered or partially-overwritten binary can still report the right version string. **Only if the
  recomputed on-disk SHA512 matches AND `--version` matches** does the service return
  `{ state:"installed", version, alreadyInstalled:true }` **without** re-downloading or re-promoting, and
  without mutating the live install.
- **A hash mismatch (on-disk bytes drifted from the recipe/pinned hash) ⇒ NOT a no-op — REINSTALL**: the
  service re-stages, re-verifies, and atomically re-promotes the pinned version (A.3.2–A.3.5), replacing the
  drifted binary. (This is the recovery path for a tampered or truncated on-disk install.)
- Installing a **different** pinned version (a maintainer bumped the catalog) stages + verifies the new
  version and atomically promotes it over the old (A.3.5) — the old dir is removed only AFTER the new one is
  promoted and verified.

### A.3.7 Self-update DISABLED for ALL providers (esp. agy)

- The installed CLIs MUST be configured so they **never self-update at runtime** (a self-update would defeat
  the pin + checksum and re-introduce a mutable, unverified binary). The mechanism is **NOT vague — it is a
  CONCRETE per-provider key pinned in `recipe.selfUpdateDisable`** (§A.1.1), one of:
  - **`kind:"env"`** — a NON-SECRET control env var the pinned CLI version reads (e.g.
    `<PROVIDER>_DISABLE_AUTO_UPDATE=1`). For the launched CLI to actually receive it, **TWO things are
    required (R6 — both, not just the allowlist):** (1) the key is an **additive entry on the §7.2
    CLI-subprocess allowlist**, AND (2) the `key=value` pair is **SOURCED INTO the cli-runner process env
    BEFORE the tmux server is forked.** This second step is load-bearing and was the gap: `buildSanitizedCliEnv`
    (`sanitized-env.ts:40`) is a **passthrough FILTER, not a setter** — it copies a key only if it is already
    present in the source `process.env`; the launched CLI inherits exactly `buildSanitizedCliEnv(process.env)`
    via the forked tmux server (`runner-io.ts:22`), and `tmux new-session` passes no per-launch `-e`. So
    allowlisting alone is a **no-op** — the value never appears. **Frozen mechanism:** at boot, **`main.ts`
    reads the catalog's `kind:"env"` `selfUpdateDisable` entries and sets each `key=value` on its own
    `process.env` BEFORE constructing `createSanitizedTmuxIo()`** (the catalog is the single source of truth;
    no compose hardcoding, no secret). Then the §7.2 passthrough propagates it to the forked tmux server and
    every launched CLI. (A per-launch `opts.env` overlay — `runner-io.ts:25` already layers it — is an
    acceptable alternative ONLY if the launch path, not just an `io.run`, actually reaches the CLI's tmux
    session env; the boot-time `process.env` source is the frozen default because it provably reaches the
    forked server.)
  - **`kind:"config"`** — a config-file fragment the installer **writes at install time** into the install
    dir or CLI `HOME` (e.g. a `disable_auto_update = true` line in the provider's config under
    `/data/cli-auth`). **No env-sourcing problem** (it is a file, not an env var) — so where the pinned CLI
    honors a config flag this form is **preferred** and sidesteps the R6 passthrough issue entirely.
- **§7.2 allowlist addition (named, non-secret control).** When a recipe uses `kind:"env"`, its exact key is
  added to the §7.2 CLI-subprocess allowlist in `sanitized-env.ts` (`ALLOWED_KEYS`) as a **named non-secret
  control var** — it does NOT weaken the deny-by-default posture (it is a single, explicitly-named,
  non-secret auto-update-disable flag, never a wildcard). The key MUST match `recipe.selfUpdateDisable.key`.
  **The test asserts the value actually reaches the launched-CLI env (`key=value` present in
  `buildSanitizedCliEnv` of a `process.env` that includes the boot-sourced pair) — NOT merely that the key is
  on the allowlist** (the allowlist-only assertion would pass while the mechanism is a no-op). **MVP note:**
  the pinner SHOULD prefer `kind:"config"` for claude if the pinned claude version honors a config
  auto-update-disable flag (sidestepping the env source); if it pins `kind:"env"`, the boot-source step
  above is mandatory. codex uses `kind:"config"`.
- For **agy** a working self-update-disable mechanism is a **hard precondition of unblocking** (A.1.2): if
  no concrete `selfUpdateDisable` the pinned agy version honors can be confirmed by the spike, agy stays
  `blocked`.

### A.3.8 Same-filesystem + UID summary (frozen)

staging dir, live install, and PATH bin **all live on the tools volume** (`/data/cli-tools`), owned by
`JARVIS_HOST_UID` (the root-init service chowns the volume, base §8). The promote is therefore always
same-fs/same-uid → atomic. The installer runs as the same single uid as the CLIs (base §13 / #347 same-UID
limitation applies — see A.6).

---

## A.4 STATE MACHINE — who writes the transitions

The states + the table (**`app.provider_install_state`** — the authoritative name; §A.0 reconciliation) are
frozen by the base contract (§9, `0103_provider_install_state.sql`, `ProviderInstallState`). This addendum
freezes **who writes which transition and when**. The transition table below is **TOTAL over the start states
the api can be in when it sends `installProvider`** — a (re)install/upgrade may begin from ANY of
`{not_installed, installed, ready, needs_login, error}`, and every such start collapses to `installing`
before the RPC:

```
              installProvider requested (admin, A.5.1)
   {not_installed, installed, ready, needs_login, error}
                       │  (api: persist `installing` BEFORE the RPC)
                       ▼
                   installing ───────────────────────────────┐
                       │  installProvider result.state        │ (api crash mid-install ⇒ stale `installing`)
            "installed"│              │"error"                 │ reconciled on next onboarding load by the
                       ▼              ▼                        │ stale-`installing` projection (A.4.2):
                   installed ──────▶ error ──┐                 │   probe ready/needs_login ⇒ installed
                       │                     │ (api retry:     │   probe not_installed     ⇒ not_installed
                       │                     │  persist        ◀─┘
                       │                     │  `installing`)
                       │                     └──────────────▶ installing
   (api re-probe       │
    shows binary       ▼
    absent ⇒)      needs_login ──▶ ready        ◀── Phase-3 login presentation layer
        └──────────▶ not_installed              (out of this addendum's scope)
   {installed, ready, needs_login, error} ─(api re-probe shows binary absent)─▶ not_installed
```

| Transition | WHO writes it | HOW |
| --- | --- | --- |
| `not_installed → installing` | **api** | persists `installing` to `app.provider_install_state` **before** sending the `installProvider` RPC (admin actor, A.4.1). |
| `installed → installing` | **api** | a re-install / version upgrade (catalog bump) of an already-installed provider: persists `installing` before the RPC. The install service idempotency (A.3.6) makes a same-version re-install a no-op safe re-verify; a different pinned version re-promotes. |
| `ready → installing` | **api** | a re-install / upgrade of a provider that was already installed AND logged in (Phase 3 state): persists `installing` before the RPC. (Login state is re-derived by the Phase-3 layer after the install settles.) |
| `needs_login → installing` | **api** | a re-install / upgrade of an installed-but-unauthenticated provider: persists `installing` before the RPC. |
| `error → installing` | **api** | a retry after a failed install: persists `installing` and re-sends `installProvider`. |
| `installing → installed` | **api** | on `RpcInstallProviderResult{ state:"installed", version }` — persists `installed` + `version`. The **cli-runner reports** the result over the socket; the **api persists** it (the table is admin-write, RLS, A.4.1). |
| `installing → error` | **api** | on `RpcInstallProviderResult{ state:"error", message }` (or an `RpcErr internal`) — persists `error` + redacted `message`. Recoverable: a retry re-enters `installing`. |
| `installing → {installed, not_installed}` (reconcile) | **api** | a **stale** `installing` row (api crashed mid-install) is corrected on next onboarding load by the stale-`installing` projection (A.4.2), NOT by a fresh RPC result. |
| `installed → needs_login` | **api** (Phase 3) | after install, a `probeProvider` (§4.8) returning `needs_login` (or the login layer) writes `needs_login`. **Out of this addendum's scope** (Phase 3) — listed for completeness. |
| `needs_login → ready` | **api** (Phase 3) | login presentation layer (Phase 3) on a successful auth + smoke. **Out of scope here.** |
| `{installed, ready, needs_login, error} → not_installed` | **api** | a post-install `probeProvider` / `cliPresent` re-probe (§A.5) showing the binary absent resets to `not_installed`. |

> **Re-install/upgrade is the same lane regardless of start state.** The api does NOT special-case the
> pre-install state: from any of `{not_installed, installed, ready, needs_login, error}` it persists
> `installing` and sends one `installProvider`. The install-service's idempotency + atomic-promote (A.3.5/
> A.3.6) make this safe — a same-version re-install is a no-op safe re-verify; a different pinned version is
> staged + verified + atomically promoted, leaving the prior install live until the new one is verified.

**The cli-runner NEVER writes the table.** It has no DB mount/credentials (base §7.2/§8 — no DB URL in its
env, no postgres mount). It only **reports** the terminal `RpcInstallProviderResult` over the socket; the
**api** is the sole writer, under an **admin actor**, satisfying the table's admin-only write RLS
(`provider_install_state_insert/update`, `0103_provider_install_state.sql:53-62`). This preserves module
isolation (state lives in the settings/onboarding module, base §9.2) and the base contract's invariant that
the live-chat socket is the engine boundary only — the install verb is the **one** additive control path
that crosses it, and even it does not let cli-runner touch the DB.

### A.4.1 Persistence mechanics

- The api persists via the settings/onboarding module's repository (a `DataContextDb` handle under an
  **admin** `AccessContext` — admin is required by the table RLS). One row per provider (instance-global,
  ADR 0007; the table is `provider PRIMARY KEY`). `message` is the **redacted** string (base §6.4 — the
  same `redactSecrets` chokepoint, enforced by the table's `message_len_ck` ≤ 2000).
- Upsert semantics: `installing` is written before the RPC; the terminal state overwrites it; a stale
  `installing` row (api crashed mid-install) is reconciled on next onboarding load by the
  stale-`installing` projection (A.4.2).

### A.4.2 Stale-`installing` reconciliation projection (FROZEN)

A persisted `installing` row is **transient by intent** — it should be overwritten by the terminal
`installed`/`error` the same request produces. If the api crashes between persisting `installing` and
persisting the terminal state, the row is **stale**. On the next onboarding load the api reconciles it via a
pure projection over **(persisted state, fresh `probeProvider` result)**:

```
reconcileInstalling(persisted: ProviderInstallState, probe: RpcProbeProviderResult): ProviderInstallState
```

- It applies **only** to a persisted `installing` row (every other persisted state is returned unchanged —
  the projection is identity off `installing`).
- For `persisted === "installing"`, map by the fresh probe:
  - `probe ∈ { ready, needs_login }` (binary present on PATH; §A.5 `cliPresent` true) ⇒ **`installed`**
    (the install actually completed before the crash; login lifecycle is then advanced separately by Phase 3).
  - `probe === not_installed` (binary absent on PATH) ⇒ **`not_installed`** (the install never completed; the
    user re-triggers).
  - `probe === multiplexer_unavailable` (a transient cli-runner-wide condition, base §9.1) ⇒ **leave
    `installing` unchanged** and re-reconcile on the next load (do NOT downgrade a possibly-complete install
    on a transient probe failure).
- The corrected state is persisted (admin actor, A.4.1) so the row is no longer stale. This projection is the
  ONLY writer of the `installing → {installed, not_installed}` reconcile edges in the §A.4 table; it never
  invents `ready`/`needs_login` (Phase-3 login owns those).

---

## A.5 ONBOARDING INSTALL STEP

The onboarding cli-auth step (`OnboardingCliAuthStepDto`, `onboarding-api.ts:81-85`) drives install via the
api over the socket and reflects the persisted state:

1. **Trigger (named seam, A.5.1).** A new **admin-gated POST under `packages/settings/src/onboarding-routes.ts`**
   (alongside the existing `/api/onboarding/provider-check` handler, same module + `resolveAccessContext`
   wiring) initiates the install — e.g. `POST /api/onboarding/provider-install { providerKind }`. The handler
   resolves an **admin `AccessContext`** (the table's write RLS is `current_actor_is_admin()`, `0103:53-71`),
   persists `installing` (A.4), calls `installProvider({ provider })` over the socket (the api's RPC client
   `ChatEngineRpcClient`, base §3.5), then persists the terminal `installed`/`error` (A.4). The cli-runner
   itself is never the trigger and never writes the table (§A.4).
2. **Reflect persisted state.** `OnboardingCliProviderDto.installState?` (`onboarding-api.ts:52-63`, the
   additive optional field already frozen in Phase 1) is populated from `app.provider_install_state`. The
   founder-status resolver reads the row (select-RLS allows all authed actors, `0103:47-50`) and surfaces
   `installState` to the wizard. Absent row ⇒ `installState` omitted (Phase-1 byte-for-byte surface).
3. **Re-probe `cliPresent` after install.** Install **presence** is re-derived after a successful install by
   re-running the §4.8 `probeProvider` (or the `cliPresent` PATH probe inside cli-runner,
   `cli-availability.ts:76` / `engine-host.ts:60`) so `OnboardingCliProviderDto.cliPresent` flips to `true`
   only when the binary is actually on PATH in the tools volume. `cliPresent` stays **presence-only** (it is
   NOT an auth claim — `onboarding-api.ts:54`); `installState` carries the lifecycle. After install the
   provider sits at `installed` (present, not yet authed) until the Phase-3 login layer advances it to
   `needs_login`/`ready`.
4. **No `JARVIS_HOST_CLIS` in in-container mode.** Per the plan (#341 superseded), the containerized path
   does not consult `JARVIS_HOST_CLIS`; the cli-runner discovers installed CLIs via the in-container PATH
   probe (`cliAvailable`, which falls through to the `command -v` probe when `JARVIS_HOST_CLIS` is unset —
   `cli-availability.ts:78-83`). The host-install path is unchanged (base §7.1 host-mode note).

### A.5.1 Trigger seam, concurrency, and streaming (frozen)

- **Trigger seam (named).** `installProvider` is initiated by the admin-gated onboarding install route in
  `packages/settings/src/onboarding-routes.ts` (A.5 step 1), under an **admin `AccessContext`** so the table
  write RLS (`current_actor_is_admin()`, 0103) is satisfied. This is the **one** api route that drives the
  install verb; the onboarding wizard's install action calls it.
- **Concurrency — install is volume-disjoint from the live-engine admission gate.** The install lane and the
  §4.1.0a single-active-user admission gate do **NOT** share a mutex and do not contend:
  - **Install** touches the **tools volume** (`/data/cli-tools`) and is serialized by the install service's
    **own per-provider lock** (A.3.1) — one in-flight install per provider, different providers concurrent.
  - **The §4.1.0a gate** touches the **auth volume** (`<JARVIS_CLI_NEUTRAL_BASE>` `0600` token dirs) and is
    serialized by the server-wide admission mutex over the **mux enumeration** (base §4.1.0a).
  - These are **disjoint by LOCK** (separate mutexes) and the **§4.1.0a gate is disjoint by the AUTH
    volume**: an install never enumerates mux sessions and never holds the admission mutex; a `launch` never
    takes a per-provider install lock. So an install MAY proceed while a live chat session exists, and
    vice-versa, with no cross-blocking. (`installProvider` is a non-session verb, §A.2 — it does not pass
    through admission at all.)
  - **Tools-volume sharing (R6 — precise).** Install and live-chat are NOT disjoint on the **tools** volume:
    a live CLI and an in-flight install of the **same provider** both touch `/data/cli-tools`. This is safe
    by construction: the A.3.5 atomic `current`-flip guarantees PATH **never resolves to a half-state**
    (PATH always points at a fully-verified release or the prior one), and an **already-`exec`'d CLI keeps
    its already-resolved inode** for its lifetime (a same-version re-install promotes byte-identical bytes; a
    version bump is an operator-initiated action). So a concurrent install never corrupts a running session —
    it only changes which release the **next** launch resolves. No cross-blocking, no half-state.
- **Streaming verb caveat (frozen MVP = single request/response).** If the optional progress stream (A.2.2)
  is ever implemented, the api's RPC client (`ChatEngineRpcClient`, base §3.5) MUST special-case
  `installProvider` as a **streaming verb** — i.e. keep reading interim `RpcOk`/`RpcInstallProgress` frames
  (`complete:false`) until the terminal `RpcInstallProviderResult`, exactly as it would for any future
  multi-frame verb. **For the frozen MVP, `installProvider` is a plain single-request/single-response verb**
  and the client needs no such special-casing; this note only reserves the seam.

---

## A.6 SUPPLY-CHAIN SECURITY

### A.6.1 Threat

Installing a provider means **fetching and executing third-party CLI code** (`@anthropic-ai/claude-code`,
`@openai/codex`, the Antigravity `agy` artifact) plus their transitive npm dependency trees, from the npm
registry / a vendor artifact host. The threats:

- **Malicious/compromised package or version** (a hijacked publish, a typosquat, a poisoned `latest`/`next`
  dist-tag, a dependency-confusion package).
- **Mutable install drift:** `latest`/range pins, or CLI **self-update**, swap the verified binary for an
  unverified one at any later time.
- **Tampered artifact in transit / on the mirror** (the agy artifact host or a redirect).
- **Secret exfiltration by the installer or a postinstall script** — the install runs code; if it had app
  secrets/DB/vault in its env or mounts, a malicious postinstall could read them.
- **Partial/poisoned install on PATH** — a half-written or failed install left runnable.

### A.6.2 Layered mitigations (each maps to an A.x clause)

| Layer | Mitigation | Where |
| --- | --- | --- |
| **Sidecar isolation** | The installer + CLIs run in the cli-runner sidecar, which mounts **no** vault, **no** model-cache, **no** DB, and gets **no** app `env_file` — so even arbitrary install-time code execution cannot read app secrets or private data (mounts are container-level — process-stripping alone is insufficient). | base §7.2/§8; A.3.3 |
| **Allowlist-only** | The catalog IS the allowlist; a provider absent or `blocked` is rejected (`bad_request`). No user-/env-supplied package or URL — the recipe is a frozen module constant. | A.1; A.2.3 |
| **Pinned exact versions** | npm `pkg@<exact>` (no `^`/range/`latest`/dist-tag); validated at load (A.1.4). The version is also re-verified against the binary's own `--version` before promote. | A.1.1/A.1.4; A.3.4 |
| **Transitive-tree integrity (committed lockfile + `npm ci`)** | Every `supported` npm recipe carries a **committed `npm-shrinkwrap.json`** in which EVERY resolved package (top-level + full transitive tree) has a `sha512` `integrity`; install is **`npm ci`**, which enforces the lockfile exactly and fails on any drift — so the transitive tree never resolves fresh semver (the top npm attack vector). A recipe with no full-tree-integrity lockfile is demoted to `blocked` at load. | A.1.1/A.1.4; A.3.3/A.3.4 |
| **No lifecycle scripts (`--ignore-scripts`)** | `npm ci --ignore-scripts` blocks all `pre/post/install` scripts during the verify window; codex's native binary is resolved EXPLICITLY from the lockfile-pinned per-arch package (so `--omit=optional` is unneeded and no script runs). Arbitrary postinstall code never executes. | A.1.3; A.3.3 |
| **Artifact SHA512** | the artifact recipe's **pinned SHA512** verified (constant-time) **before** the binary is ever executable/on-PATH. | A.1.1; A.3.4 |
| **TOCTOU close (verify→promote)** | the promote target's SHA512 is pinned at verify time and **re-verified immediately after promote**; a mismatch rolls back. Closes the window between verify and atomic promote. | A.3.4/A.3.5 |
| **Self-update DISABLED (concrete key)** | All providers carry a **concrete `recipe.selfUpdateDisable`** (env key on the §7.2 allowlist, or a config fragment written at install) that the pinned version honors; a hard precondition for agy's unblocking. Keeps the pinned/checksummed binary from silently mutating. | A.1.1/A.3.7 |
| **Installer-env allowlist (NO app secrets)** | The installer subprocess gets the §7.2 allowlist (HOME/PATH/npm prefix/locale) **PLUS only** the non-secret registry/proxy vars an npm install needs (`HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, `NPM_CONFIG_REGISTRY`) — no `BETTER_AUTH_SECRET`/`JARVIS_AI_SECRET_KEY`/DB URLs/vault/RPC secret/socket path. A poisoned package finds nothing to exfiltrate. | base §7.2; A.3.3 |
| **Atomic-promote-only-after-verify (one form per kind)** | PATH only ever points at a fully verified install; promote is frozen to ONE atomic same-fs form per recipe kind — npm = per-provider `current` symlink-flip under the shared `NPM_CONFIG_PREFIX`; artifact = atomic `rename`; any failure rolls back leaving the prior install intact. No partial binary is ever runnable. | A.3.2/A.3.4/A.3.5 |
| **No shell `curl \| bash` for npm/artifact** | npm invoked non-interactively via execFile-style `TmuxIo.run` as `npm ci --ignore-scripts --prefix`; the artifact is fetch→verify→promote, never fetch-and-run. | A.3.3 |
| **No DB reach from cli-runner** | The install verb does NOT let cli-runner write state — the api is the sole admin-RLS writer of `provider_install_state`; cli-runner only reports the result over the socket. | A.4 |
| **Redaction at the boundary** | The terminal `message` and any error cross the socket already redacted (§6.4) and are persisted through the same chokepoint (table `message` ≤2000, never a secret). | A.2.1/A.4.1 |

### A.6.3 Residual limitation (carried from base §13 / #347)

Installed CLIs still run under the **§4.1.0a single-active-user gate** (`JARVIS_CLI_RUNNER_SINGLE_USER`,
default ON) and the **same-UID limitation** (base §13): the installer and all provider CLIs run as the
single `JARVIS_HOST_UID`, so per-session `0600` token files are **not** a cross-user boundary, and the
installed tools volume is shared instance-wide (one install per house, ADR 0007). The installer itself runs
same-UID, so it can read the tools volume it writes — acceptable (it is the writer).

**Runtime-tamper residual (R6, named honestly).** The pin/checksum/`npm ci`/`--ignore-scripts`/TOCTOU
re-hash machinery verifies integrity **at install/reinstall time**, and the idempotent re-verify (A.3.6)
re-hashes only when an install is re-triggered — there is **no launch-time hash verification** of the
resolved binary. Because the installer and all provider CLIs share one UID and a **writable** tools volume,
a same-UID compromised CLI could in principle mutate `/data/cli-tools` **after** a clean install and go
undetected until the next reinstall. This is the **same #347 same-UID trust-domain residual** (not a new
exposure introduced by this addendum): the controls here ensure the *installed* code is pinned, checksummed,
non-self-updating, and installed with no app secrets in reach, but they do **not** harden the post-install
runtime against a same-UID tamper. **Deferred hardening, tracked with #347** (the same fast-follow that
gates lifting the single-active-user flag): launch-time hash verification of the resolved binary, and/or a
**read-only** tools mount for the CLI-launch path with a separate writable installer path/UID. **Full
per-UID separation is deferred to #347.** This addendum does **not** change that posture.

---

## A.7 Acceptance criteria

1. **Catalog is the allowlist, with TWO distinct rejection paths.** A `provider` value that is NOT an
   `RpcProviderKind` returns `bad_request` via the `isProviderKind` mirror ("unknown provider"); a value that
   IS a kind but is `status:"blocked"` / absent (agy until its spike) returns `bad_request` via the
   **distinct catalog-blocked path** (different message, `blockedReason`) — neither closes (§3.7). Pin
   validation (A.1.4) rejects, at load, any non-exact npm version / npm recipe **without a committed
   full-tree-`sha512` lockfile** (demoted to `blocked`) / missing per-arch `archBinaryPackage` /
   non-versioned-or-unchecksummed artifact / missing-or-placeholder `selfUpdateDisable` / any `<PINNED_*>`
   placeholder.
2. **Additive verb, no frozen-shape change.** `"installProvider"` is appended to `RpcMethod`; it reuses the
   §3.4 envelope, §3.6 hello, §3.2 framing, §6.4 redaction, §4.7 mapping. No base type/method/envelope is
   modified. The new wire types live in `install-contract.ts` importing `RpcProviderKind` read-only.
3. **Transitive integrity + no scripts (tested).** Each `supported` npm recipe installs via
   **`npm ci --ignore-scripts`** against its **committed lockfile** (full-tree `sha512` integrity enforced;
   any drift fails); no `pre/post/install` lifecycle script runs; the lockfile is regenerated only at the
   pin step, never at install.
4. **Install service invariants** hold (tested): per-provider serialized lock — a separate instance from the
   §4.1.0a admission mutex (concurrent same-provider → `bad_request`); staging on the same fs under
   `/data/cli-tools/.staging`; verify (binary + `--version` = pinned version; SHA512 for artifact) BEFORE
   promote; **verify-time SHA512 pinned and RE-VERIFIED immediately after promote (TOCTOU close)**; promote
   is the ONE frozen form per kind (npm = **`rename` verified tree into `providers/<provider>/releases/<rand>`
   then `current` symlink-flip** under shared `NPM_CONFIG_PREFIX` — `current` never points into `.staging`,
   the just-promoted release is never deleted, only the superseded prior release is GC'd; artifact = atomic
   `rename`); rollback leaves the prior install intact on any failure (a post-promote re-hash mismatch flips
   `current` back); idempotent re-install of the pinned version is a no-op safe re-verify that **re-computes
   the on-disk SHA512 vs the recipe/pinned hash** (`alreadyInstalled:true`) — a **hash mismatch ⇒ reinstall**,
   not a no-op; self-update disabled via the recipe's concrete `selfUpdateDisable` — and for `kind:"env"` the
   `key=value` is **sourced into the cli-runner `process.env` at boot (`main.ts`) so the §7.2 passthrough
   actually delivers it to the launched CLI** (allowlisting alone is a no-op, R6), asserted by a test on the
   launched-CLI env (not just the allowlist).
5. **codex per-arch** native binary resolves EXPLICITLY from the lockfile-pinned `archBinaryPackage` (no
   lifecycle script, no `--omit=optional`), the host-arch key mapped from `os.arch()` (a missing entry is a
   defined verify failure, not an undefined deref), and `codex --version` runs on both `linux/amd64` and
   `linux/arm64` before promote; an install that leaves no runnable binary is a verify failure → rollback.
6. **Installer-env allowlist**: the installer subprocess env = the §7.2 allowlist **PLUS only**
   `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`/`NPM_CONFIG_REGISTRY` — and **nothing secret** (no
   `BETTER_AUTH_SECRET`/`JARVIS_AI_SECRET_KEY`/DB URL/vault/RPC secret/socket path).
7. **State machine: TOTAL + correct table.** The transition table is total over the start states the api can
   send `installProvider` from (`{not_installed, installed, ready, needs_login, error} → installing`) and
   reconciled with the ASCII diagram. The **api** persists `installing` before the RPC and the terminal
   `installed`/`error` after, under an **admin** actor, into **`app.provider_install_state`** (the
   authoritative 0103 name, §A.0); the **cli-runner never writes the DB**. A failed install is an
   `RpcOk{ result.state:"error" }`, not an `RpcErr`. A stale `installing` row is corrected by the A.4.2
   projection (probe ready/needs_login ⇒ installed; probe not_installed ⇒ not_installed).
8. **Onboarding**: the admin-gated install route in `onboarding-routes.ts` (A.5.1) is the sole trigger;
   `installState?` reflects the persisted row; `cliPresent` is re-probed after install (PATH in cli-runner)
   and flips true only when the binary is actually present; the in-container path does not use
   `JARVIS_HOST_CLIS`.
9. **agy** ships `blocked` unless the pinning spike yields a versioned URL + pinned SHA512 + a concrete
   honored `selfUpdateDisable`; claude + codex are the certain MVP.

## A.8 Out of scope (unchanged from base + plan)

Login presentation layer + per-provider smoke gates (Phase 3); the agy/Antigravity pinning + transcript/auth
spike resolution (a build task that flips the catalog entry); per-UID separation (#347); GLM/opencode
provider; API-key chat engine (rejected). This addendum freezes the catalog **shape + policy** and the
install verb/service/state-ownership; the concrete pinned version literals are a reviewed pin step (A.1.2).
