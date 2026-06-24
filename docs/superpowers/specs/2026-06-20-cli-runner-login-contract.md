# Spec (ADDENDUM): cli-runner login presentation layer contract — #342 Phase 3

- **Status:** **FROZEN v1** (Phase-3 build contract) — frozen 2026-06-20 after a cross-model adversarial
  review (Codex gpt-5.x, 4 rounds: REVISE→REVISE→REVISE→**APPROVED**; 1 BLOCKER + 4 HIGH + 4 MED folded;
  decision D22 in `~/jarvis-342-build/OVERNIGHT-DECISIONS.md`). **ADDITIVE addendum** to the two
  FROZEN contracts it builds on:
  - the base RPC contract `docs/superpowers/specs/2026-06-20-cli-runner-rpc-contract.md` ("base contract")
  - the Phase-2 installer addendum `docs/superpowers/specs/2026-06-20-cli-runner-install-contract.md`
    ("install addendum")

  This document **adds** login-orchestration RPC verbs, new wire types, a server-side per-provider login
  adapter, a login service, the `needs_login`/`ready` state-transition writers, the per-provider smoke
  gate, and the onboarding login routes. **It changes NO frozen shape** — every existing envelope, method,
  type, env var, mount, ownership rule, and the §4.1.0a single-active-user gate stand unchanged. New
  verbs/types are additive only (§L.0).

- **Date:** 2026-06-20
- **Owner:** #342 in-container CLI chat (overnight build, Ben-delegated approvals — see
  `~/jarvis-342-build/OVERNIGHT-DECISIONS.md`).
- **GitHub:** #342 (epic #47). Plan: `docs/superpowers/plans/2026-06-20-in-container-cli-chat.md`
  (Phase 3 items **11–12**). #347 (UID-separation) stays **BLOCKING** for concurrent multi-user.
- **Grounded-on:** merged `origin/main` `a5eb338` (Phases 0/1/1.5/2 merged: PRs #348/#349/#350/#351), in
  the worktree `~/jarvis-342-p3` (`342/phase3`). Phase-2 code read: `engine-host.ts`,
  `connection.ts`, `cli-chat-engine.ts` (probe surface), `install-service.ts`, `provider-install-state.ts`,
  `onboarding-routes.ts`, `sanitized-env.ts`, `redact.ts`, `0103_provider_install_state.sql`,
  `onboarding-api.ts`.
- **Builds on, does not re-freeze:** base §3 transport/framing/hello, §4 methods (esp. `probeProvider`
  §4.8), §4.1.0a single-active-user gate, §6 secrets discipline + §6.4 redaction chokepoint, §7.2
  sanitized-env allowlist, §8 volume matrix, §9 state machine; install addendum §A.4 transition table
  (the two Phase-3 login edges it left "out of scope, for completeness" are filled HERE), §A.5 onboarding
  routes, §A.5.1 trigger/concurrency seam. Read those first; this addendum fills the Phase-3-deferred login
  presentation layer (base §2 "Out", §15; install §A.8).

> **This document is FROZEN (when sealed) and additive.** The Phase-3 login lane builds against it with no
> further coordination on SHAPE. The concrete per-provider adapter VALUES (`loginArgv`, parser regexes, host
> allowlists) are **normative and committed IN THIS SPEC** (§L.1.2) — the lane copies them into the
> `login-contract.ts` constants and the §L.9.2 smoke validates them in the PR (the same reviewed-constant
> model the install addendum uses for the catalog pins, which #351 resolved). Where a value is not specified
> here, that is a contract gap — escalate, do **not** invent. The base + install
> framing/hello/envelope/redaction/single-active-user rules are inherited verbatim.

---

## L.0 Additive-only invariant (what this addendum MUST NOT touch)

The base + install contracts are FROZEN. This addendum is layered strictly on top:

- **No frozen shape changes.** `RpcRequest`/`RpcOk`/`RpcErr`/`RpcError`, `MAX_FRAME_BYTES`, the §3.6 hello
  frames, every existing `Rpc*Params`/`Rpc*Result`, the `CliChatEngine` interface, `RpcLaunchParams`, the
  `installProvider` verb, and the §4.1.0a gate are unchanged.
- **`RpcMethod` is EXTENDED additively** — four verbs are appended to the existing union (base §3.4):
  `"beginLogin"`, `"pollLogin"`, `"submitLoginToken"`, `"cancelLogin"`. The new verbs reuse the **same**
  §3.4 request/ok/err envelope, the **same** §3.6 auth hello, the **same** §3.2 length-prefixed framing,
  the **same** §6.4 redaction, and the **same** §4.7 error→HTTP mapping. **No new envelope, no new error
  code** (they reuse `unavailable`/`bad_request`/`internal`).
- **The login verbs are NON-SESSION** — exactly like `listLiveSessions` (§4.6), `probeProvider` (§4.8), and
  `installProvider` (§A.2): **no `sessionKey`**, instance-wide (login is house-global per-provider auth —
  ADR 0007, one house, one cred set per provider), gated solely by the §3.6 connection auth hello (only the
  api holds `JARVIS_CLI_RUNNER_RPC_SECRET`; the CLI subprocesses are excluded from it, §7.2). Login is
  **NOT** a chat launch: no MCP token is minted/injected/required, no replay, no persona, **no per-session
  neutral dir** (login auth lands in the provider's own `HOME` config, not in `<neutralBase>/<sessionKey>`).
- **`ProviderInstallState`** (base §9.2 enum, `onboarding-api.ts:44-50`) and the table
  `app.provider_install_state` (`packages/settings/sql/0103_provider_install_state.sql`) are reused
  **verbatim** — this addendum adds **no states and no columns**. It only defines **who writes the
  `needs_login` / `ready` transitions, when** (filling the install addendum §A.4 rows already declared
  `who: "api-phase3"`, `kind: "phase3-login"` in `provider-install-state.ts:113-115`).
- **A new wire-type file** `packages/chat/src/live/login-contract.ts` holds the login verbs' params/result/
  status shapes + the login-adapter type, and **imports** `RpcProviderKind` from `rpc-contract.ts` and
  `ProviderInstallState` from `@jarv1s/shared` read-only. It does NOT re-declare any base/install wire type.
  (Mirrors `install-contract.ts`.)
- **The §4.1.0a single-active-user gate is REUSED, not weakened.** Login participates in the **same**
  server-wide admission gate as chat `launch` (§L.6.1): at most one untrusted CLI touches the auth/home
  volume at a time. No new flag; `JARVIS_CLI_RUNNER_SINGLE_USER` (default ON) governs login too.

---

## L.1 PER-PROVIDER LOGIN ADAPTER (server-side, the auth-flow allowlist)

Login is provider-specific (claude is OAuth paste-back; codex's headless flow is a spike, §L.9). Rather than
hardcode a flow, the cli-runner holds a **typed, server-side, compile-time-constant per-provider login
adapter** — analogous to the install catalog (§A.1). **The adapter set IS the allowlist: a provider absent
(or whose catalog status is `blocked`, e.g. agy pre-spike) is rejected `bad_request` (§L.2.4).**

### L.1.1 Adapter type (frozen shape; concrete values are a reviewed build/spike step)

Lives in `packages/chat/src/live/login-contract.ts`. `RpcProviderKind` imported from `rpc-contract.ts`.

```typescript
import type { RpcProviderKind } from "./rpc-contract.js";

/** How the provider's login completes once the user acts in the browser. */
export type LoginMode =
  /** The CLI auto-detects completion (it polls its own backend); the api just re-probes. */
  | "poll"
  /** The CLI prints a URL, the browser yields a code, the user pastes it back (submitLoginToken). */
  | "paste";

/**
 * The strict, allowlisted surface the server may forward to the api/UI from the captured login
 * pane. ONLY these fields ever cross the socket — never raw stdout / capture-pane (§L.6.2). Both
 * are public authorization material (a URL to open, a short user/device code to display), NOT a
 * bearer token; they are USELESS without the user completing the browser auth with their own
 * credentials.
 */
export interface LoginSurface {
  /** The authorization URL to open. https: only, host-allowlisted per provider (§L.6.2). */
  readonly authorizationUrl?: string;
  /** A short device/pairing code to display (tight regex, §L.6.2). NOT a secret token. */
  readonly userCode?: string;
}

/**
 * The per-provider login adapter (frozen SHAPE). The concrete command argv + parser regexes are a
 * REVIEWED build/spike step (like the §A.1.2 `<PINNED_*>` catalog values) — a placeholder MUST NOT
 * merge as `supported`. agy has NO adapter while blocked (§L.9).
 */
export interface LoginAdapter {
  readonly provider: RpcProviderKind;
  /**
   * argv to START the login flow in the captured login tmux session (execFile-style, NOT a shell
   * string — same discipline as the rest of cli-runner). e.g. claude: ["claude", "/login"] or
   * ["claude", "setup-token"]; codex: ["codex", "login"]. Resolved at the build/spike step.
   * NEVER carries a token/secret (login produces the cred; it does not consume one as argv).
   */
  readonly loginArgv: readonly string[];
  /** Whether completion is poll-detected or needs a pasted code (§L.2). */
  readonly mode: LoginMode;
  /**
   * Extract ONLY the allowlisted LoginSurface from a captured-pane snapshot. MUST return at most
   * { authorizationUrl, userCode } and NEVER echo raw input/output. Applies the §L.6.2 https +
   * per-provider host+path allowlist to authorizationUrl and `userCodePattern` to userCode; a value
   * failing the guard is DROPPED (not surfaced). A pure function over the snapshot string. The login
   * SERVICE additionally (a) NEVER calls this to surface a userCode AFTER a submitLoginToken (§L.2.3 —
   * post-submit status comes from `probeProvider` only, so the pasted code typed into the pane can
   * never be re-surfaced), and (b) drops any extracted value byte-equal to the in-flight pasted token
   * and runs `redactExact` over the result (§L.6.2/§L.6.3).
   */
  readonly extractSurface: (paneSnapshot: string) => LoginSurface;
  /**
   * Per-provider host+path allowlist for authorizationUrl (§L.6.2). A URL whose scheme is not https,
   * whose host does not match a pattern, or whose PATH is not a known authorize endpoint is NOT
   * surfaced (host-match alone is insufficient — a magic-link path could carry session material in
   * the query, MED-1). Concrete MVP values in §L.1.2.
   */
  readonly authUrlAllowlist: readonly { readonly host: string; readonly pathPrefix: string }[];
  /** Tight regex the displayed device/pairing code MUST match, else it is dropped (§L.6.2). */
  readonly userCodePattern: RegExp;
}

/** The single source of truth. NOT env-overridable, NOT user-supplied — a frozen module constant. */
export type LoginAdapterRegistry = Readonly<Partial<Record<RpcProviderKind, LoginAdapter>>>;
```

### L.1.2 Registry values (MVP — NORMATIVE, committed in this spec)

These are the **frozen build targets** the lane copies into `login-contract.ts` and the §L.9.2 smoke
validates against the real pinned CLI versions (catalog: claude `@anthropic-ai/claude-code@2.1.183`, codex
`@openai/codex@0.141.0`). They are concrete, not a deferred spike — a value the smoke disproves is a PR-blocking
correction, not a re-spec.

```typescript
export const LOGIN_ADAPTERS: LoginAdapterRegistry = {
  anthropic: {
    provider: "anthropic",
    // `claude setup-token` is the headless/long-lived-token OAuth flow: it prints an
    // authorization URL and waits for the user to paste the code from the browser back into the
    // prompt. (Interactive `/login` assumes a local browser; the container has none, so setup-token
    // is the headless path.) Verified by the L.9.2 smoke against the pinned claude version.
    loginArgv: ["claude", "setup-token"],
    mode: "paste",
    authUrlAllowlist: [
      { host: "claude.ai", pathPrefix: "/oauth" },
      { host: "console.anthropic.com", pathPrefix: "/oauth" }
    ],
    userCodePattern: /^[A-Za-z0-9_-]{6,128}$/, // paste codes are opaque; bound length, no whitespace
    extractSurface: extractAnthropicLoginSurface // pure parser (committed with the constant)
  },
  "openai-compatible": {
    provider: "openai-compatible",
    // `codex login` default opens a localhost:1455 OAuth callback + a browser — which a remote
    // headless container's browser cannot reach. The L.9.2 smoke MUST confirm a headless-usable
    // flow against the pinned codex version; if `codex login` cannot complete headlessly, the lane
    // pins the documented headless variant the pinned version supports (a device/paste flow) and
    // records it here, OR — if codex has NO headless OAuth at the pinned version — codex login ships
    // BLOCKED (no adapter) exactly like agy until a headless flow exists. This is the one MVP value
    // the smoke may force to "blocked"; claude is the certain login MVP.
    loginArgv: ["codex", "login"],
    mode: "paste", // refined to the pinned version's actual headless mechanism by the L.9.2 smoke
    // NON-ROOT path prefixes (MED — host-only "/" is too broad, §L.1.3). The exact authorize path is
    // confirmed by the L.9.2 smoke against the pinned codex version; a candidate set is committed, not "/".
    authUrlAllowlist: [
      { host: "auth.openai.com", pathPrefix: "/authorize" },
      { host: "auth.openai.com", pathPrefix: "/oauth" }
    ],
    userCodePattern: /^[A-Za-z0-9_-]{6,128}$/,
    extractSurface: extractCodexLoginSurface
  }
  // google (agy): NO adapter — install-blocked + login spike unresolved (§L.9). Absence = the allowlist.
} as const;
```

`google` (agy) has **no adapter** (absent ⇒ rejected) until its pinning+login spike resolves (§L.9).
**Install-support and login-support are SEPARATE axes:** a provider may be install-`supported` (§A.1) yet
have **no login adapter** — install works, but `beginLogin` returns the catalog/adapter-blocked `bad_request`
and the provider can never reach `ready` (this is codex's fallback if its headless-login smoke fails, §L.9.2).
The §L.1.3 registry assertion enforces the consistency that actually matters (no ORPHAN adapter; a present
adapter is complete) — it does **not** require every install-`supported` provider to have an adapter. claude
having a working adapter is a **merge/smoke gate** (§L.9.2), not a load-time assertion. The
`extractAnthropicLoginSurface` / `extractCodexLoginSurface` parsers are committed alongside the constant;
each applies §L.6.2 (https + host+path allowlist + `userCodePattern` + redaction) and is unit-tested
(§L.8).

### L.1.3 Adapter validation (rejects a bad adapter at load)

A startup assertion + unit test rejects an inconsistent registry so a half-wired provider can never ship:

- **No ORPHAN adapter:** a provider that has a login adapter MUST be install-`status:"supported"` (an
  adapter for an install-`blocked`/absent provider, e.g. agy, is a load-time failure — absence is the
  allowlist). The converse does NOT hold: an install-`supported` provider MAY have **no** adapter, which
  simply means login is unavailable for it (codex's headless-smoke fallback, §L.9.2) — that is NOT a load
  failure. (claude having a working adapter is a merge/smoke gate, §L.9.2, not a load assertion.)
- **A PRESENT adapter MUST be complete + non-placeholder:** non-empty `loginArgv`, a `mode`, an
  `extractSurface`, a non-empty `authUrlAllowlist`, and a `userCodePattern`. A present-but-incomplete or
  placeholder adapter is a load-time failure (fix it or omit it).
- `authUrlAllowlist` entries must be non-empty `{host, pathPrefix}` patterns, and **`pathPrefix` MUST NOT be
  `"/"` or empty** (host-only allowlisting is too broad — MED — it permits any path/magic-link on the host);
  a `"/"` pathPrefix fails the assertion and demotes the provider to `blocked`. `loginArgv[0]` must equal the
  provider's catalog `binary` (§A.1.1) so login runs the same pinned binary install placed.

---

## L.2 LOGIN RPC VERBS (additive; mirror the §3.4 envelope)

Four verbs appended to `RpcMethod`. All **non-session** (no `sessionKey`, like `installProvider`). They
reuse the entire frozen transport, hello, framing, redaction, and error→HTTP mapping. An opaque
server-minted **`loginId`** correlates a begin with its later poll/submit/cancel and rejects a stale handle.

### L.2.1 Wire types (additive — `login-contract.ts`)

```typescript
import type { RpcProviderKind } from "./rpc-contract.js";

/** The status a login flow reports (a SUPERSET-free projection — NOT a persisted lifecycle state). */
export type LoginFlowStatus =
  /** Awaiting the user to authorize in the browser; surface carries the URL/code to display. */
  | "awaiting_authorization"
  /** (paste mode) Awaiting the user to paste the code back via submitLoginToken. */
  | "awaiting_token"
  /** Login completed AND the smoke check passed → the provider is authenticated (§L.9). */
  | "ready"
  /** Login failed (CLI error, timeout, smoke failed) — recoverable; the user re-triggers. */
  | "error";

/** params for "beginLogin". */
export interface RpcBeginLoginParams {
  readonly provider: RpcProviderKind;
}
/** result for "beginLogin". */
export interface RpcBeginLoginResult {
  /** Opaque server-minted handle for this login flow; echoed by poll/submit/cancel. */
  readonly loginId: string;
  readonly status: LoginFlowStatus;
  /** ONLY the allowlisted surface (§L.6.2) — never raw pane text. Present while awaiting. */
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  /** Redacted (§6.4) human-readable detail on "error". Safe to log. */
  readonly message?: string;
}

/** params for "pollLogin". */
export interface RpcPollLoginParams {
  readonly provider: RpcProviderKind;
  readonly loginId: string;
}
/** result for "pollLogin" — same shape as begin (loginId echoed for symmetry). */
export interface RpcPollLoginResult {
  readonly loginId: string;
  readonly status: LoginFlowStatus;
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  readonly message?: string;
}

/** params for "submitLoginToken" (paste mode). The `token` is AUTH MATERIAL (§L.6.3). */
export interface RpcSubmitLoginTokenParams {
  readonly provider: RpcProviderKind;
  readonly loginId: string;
  /**
   * The authorization code/token the user pasted from the browser. Crosses api → cli-runner ONLY
   * in this socket payload — NEVER logged (frame bodies never logged, §6.4), NEVER persisted, NEVER
   * echoed in any result, NEVER placed in argv/env/launch-line. The server feeds it into the
   * captured login pane via `tmux load-buffer` (from a 0600 temp file) → `paste-buffer` — argv-free,
   * NOT via send-keys-with-the-token (which would land in /proc/cmdline). The pane is read only by the
   * §L.1.1 extractSurface, which never echoes input. Redacted in any error (§L.6.3).
   */
  readonly token: string;
}
/** result for "submitLoginToken". */
export interface RpcSubmitLoginTokenResult {
  readonly loginId: string;
  readonly status: LoginFlowStatus;
  readonly message?: string;
}

/** params for "cancelLogin". */
export interface RpcCancelLoginParams {
  readonly provider: RpcProviderKind;
  readonly loginId: string;
}
/** result for "cancelLogin" — idempotent (cancelling an absent/already-ended login is ok). */
export interface RpcCancelLoginResult {
  readonly ok: true;
}
```

### L.2.2 `beginLogin`

- Two ordered validation gates (§L.2.4), both `bad_request`: (1) kind guard (`isProviderKind`); (2)
  catalog/adapter gate — a provider that is `blocked`/absent or has no login adapter (agy) is rejected with
  the distinct catalog-blocked message. Only a valid + `supported` + adapter-bearing provider proceeds.
- **Admission (§L.6.1):** under the server-wide admission mutex, admit only if **no live chat session AND no
  other login is in flight** (the unified exclusivity gate). Otherwise `RpcErr code "unavailable"` (redacted)
  — the same `unavailable` path, no new wire shape.
- On admission: mint a `loginId`, register the login as the exclusive activity, start `adapter.loginArgv` in
  a **captured login tmux session** named `jarv1s-login-<provider>` (distinct prefix — invisible to the
  chat `listLiveSessions`/reconciliation/gate-by-`jarv1s-live-` enumeration, §L.6.1), with HOME =
  `JARVIS_CLI_HOME` (= `/data/cli-auth`) so the cred lands on the auth/home volume. Read the captured pane,
  run `adapter.extractSurface`, and return `awaiting_authorization` (or `awaiting_token` for paste mode once
  the URL/code appear). If the provider was ALREADY authenticated (an immediate `probeProvider === "ready"`),
  return `ready` directly and tear down (no flow needed).
- **Errors:** a login start failure (multiplexer down, binary missing, pane never yields a URL within the
  bound) → `RpcErr code "unavailable"` (redacted) OR a settled `status:"error"` per §L.2.4 (a failed _flow_
  is a normal terminal outcome, like a failed install — see §L.2.4). On any failure the login session is
  killed and the admission reservation released (§L.6.1).

### L.2.3 `pollLogin` / `submitLoginToken` / `cancelLogin`

- **`pollLogin`** re-derives status via `probeProvider(provider)` (§4.8, reused) + the captured pane:
  - `probeProvider === "ready"` → run the **runtime smoke** (§L.9.1); pass ⇒ `ready` (then kill the login
    session + release the gate); fail ⇒ `error`.
  - still `needs_login` and the pane is waiting → `awaiting_authorization` / `awaiting_token` (with the
    refreshed surface). Poll **extends** the login's idle deadline (keepalive, §L.6.1).
  - flow error / timeout → `error` (kill + release).
  - A `loginId` that does not match the in-flight login ⇒ `RpcErr code "bad_request"` (stale/no-such-login;
    does NOT close, §3.7).
- **`submitLoginToken`** (paste mode) feeds the pasted code into the captured login pane via the argv-free
  `load-buffer`→`paste-buffer` mechanism (§L.6.3),
  then re-derives status exactly like `pollLogin`. A wrong/expired code surfaces as continued
  `awaiting_token` or `error` (per the CLI). `loginId` mismatch ⇒ `bad_request`.
- **`cancelLogin`** kills the `jarv1s-login-<provider>` session, clears the in-flight login, and releases the
  admission reservation. **Idempotent** — cancelling an absent/ended login is `{ ok: true }`, never an error.

### L.2.4 Errors (reuse base §3.4 codes — NO new code)

| Condition                                                         | `RpcErrorCode`                     | Notes                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider` not an `RpcProviderKind`                               | `bad_request`                      | `isProviderKind` mirror rejects FIRST ("unknown provider"); does NOT close (§3.7).                                                                                                                                                            |
| valid kind but catalog `blocked`/absent or no login adapter (agy) | `bad_request`                      | **distinct** catalog/adapter-blocked rejection (different message ≈ `"provider not loginable: <reason>"`, redacted §6.4). agy-while-blocked lands HERE.                                                                                       |
| a chat session is live, or another login is in flight             | `unavailable`                      | the §L.6.1 unified exclusivity gate (redacted message). Same `unavailable` code as chat-busy — no new shape.                                                                                                                                  |
| `loginId` does not match the in-flight login (poll/submit/cancel) | `bad_request`                      | stale/no-such-login (does NOT close). cancel is the exception — idempotent `{ ok:true }`.                                                                                                                                                     |
| the login FLOW fails (CLI error, timeout, smoke failed)           | `RpcOk{ status:"error", message }` | a failed _flow_ is a normal terminal OUTCOME on `pollLogin`/`submitLoginToken`/`beginLogin`, NOT a transport error — mirrors install's "failed install is an RpcOk error" (§A.2.3). Reserve `RpcErr internal` for an unexpected server fault. |
| oversize/malformed frame                                          | (transport)                        | inherited from §3.2/§3.7 — closes the connection.                                                                                                                                                                                             |

> **Why a failed flow is an `RpcOk{status:"error"}`, not `RpcErr`** (same rationale as §A.2.3): the api needs
> the redacted `message` + fact-of-failure to persist `error` into `provider_install_state` and offer a
> retry in onboarding; modelling it as a transport error would conflate "login failed" with "the socket
> failed" (which triggers reconnect+reconciliation, §3.5/§5.3 — wrong response to a failed OAuth).

### L.2.5 Dispatch (engine-host + connection, additive)

Mirrors the non-session verbs in `connection.ts:219-242` and `engine-host.ts`:

- `connection.ts invoke()` gains four `case` arms. Each: validate `params.provider` via `isProviderKind`
  (→ `BadRequestError("unknown provider")`); validate `loginId` is a non-empty string where required
  (→ `BadRequestError`); then call the host method. The catalog/adapter-blocked gate lives inside the host's
  login service (a distinct `LoginBadRequestError` mapped to `bad_request` by `errorCode()` — add the class
  alongside `InstallBadRequestError`, `connection.ts:267`).
- `CliChatEngineHost` gains `beginLogin/pollLogin/submitLoginToken/cancelLogin` that delegate to the **login
  service** (§L.3). They run under the **§L.6.1 admission mutex** (login is auth-volume exclusive — UNLIKE
  install, which is volume-disjoint and lock-only, §A.5.1). They do **not** go through the per-`sessionKey`
  queue (no session).

---

## L.3 LOGIN SERVICE contract

A new module under cli-runner (e.g. `packages/cli-runner/src/login-service.ts`) that runs the login flow
**entirely inside the cli-runner sidecar** under the §7.2 sanitized CLI env (no app secrets), in a captured
`jarv1s-login-<provider>` tmux session with HOME = `/data/cli-auth`. Frozen invariants:

### L.3.1 ONE login at a time (the exclusivity reservation)

- The login service holds **at most one** in-flight login across all providers (`{ provider, loginId,
startedAt, deadline }`). It is registered through the **§L.6.1 admission gate** so it is mutually exclusive
  with chat `launch` AND with another login. A second `beginLogin` while one is in flight is rejected
  `unavailable` (§L.2.4).
- **Bounded lifetime (the D15 NEW-1 lesson — a hung flow MUST NOT freeze the gate forever).** The login has
  an overall `loginTimeoutMs` (generous, e.g. 10 min — a human-in-the-loop browser round-trip) AND an idle
  deadline that `pollLogin`/`submitLoginToken` extend (keepalive). On either timeout the service kills the
  login session, clears the reservation, and the next `pollLogin` returns `error`. So an abandoned login can
  never strand the admission gate — release is guaranteed by completion, cancel, timeout, AND startup sweep.
- **Late-success orphan reap (the §4.1.0a chat-launch lesson, `engine-host.ts:134-181`).** The mux-create for
  the `jarv1s-login-<provider>` session is itself bounded by a timeout. If the create TIMES OUT, the service
  releases the reservation and best-effort kills the session by canonical name — but the raw create promise
  may still be running and create the session AFTER that one-shot kill fired. So, exactly as chat launch does,
  the service attaches a continuation to the raw create promise that kills the `jarv1s-login-<provider>`
  session the instant it settles late — otherwise a wedged tmux that frees up late would leave an orphan
  login session that re-enters the §L.6.1 disk enumeration and blocks ALL future chat + login until a restart.
  Reservation release (on timeout) and orphan reap (on late settle) are SEPARATE — release must not wait for
  the reap.

### L.3.2 Captured login session (no token, no neutral dir)

- The login runs in `jarv1s-login-<provider>` (sanitize the provider literal; it is a fixed enum so this is
  trivial). It is a **non-chat, non-session** flow: NO MCP token minted/injected, NO persona, NO replay, and
  **NO `<neutralBase>/<sessionKey>` neutral dir** — login auth lands in the provider's own config under HOME
  (`~/.claude`, `~/.codex`), which is the intended durable result on the auth/home volume.
- The service reads the captured pane (`capture-pane`-equivalent via the runner I/O) and runs
  `adapter.extractSurface` to obtain the allowlisted `LoginSurface`. **Raw pane text NEVER leaves the
  service** (§L.6.2).

### L.3.3 Completion + the runtime smoke gate

- Completion is detected by `probeProvider(provider) === "ready"` (§4.8 reused) — NOT by scraping a token
  from the pane. On `ready`, the service runs the **runtime smoke** (§L.9.1) before reporting `ready`; a
  smoke failure reports `error`.
- On `ready` or `error` the service kills the login session and releases the reservation. A `ready` leaves
  the provider authenticated on the auth/home volume; the api persists `ready` (§L.4).

### L.3.4 Startup sweep (extends the engine-host clean-slate sweep)

The engine-host `startupSweep()` (`engine-host.ts:293`) clean-slate sweep is **extended** to ALSO kill every
`jarv1s-login-*` mux session before accepting connections (a container/process restart wipes the in-memory
login reservation while a forked login pane could survive a fast in-place restart). No on-disk neutral-base
cleanup is needed for login (it writes provider config under HOME, the intended durable cred — a
half-finished login simply leaves the probe at `needs_login`, self-corrected on the next status load, §L.4).

---

## L.4 STATE MACHINE — who writes the `needs_login` / `ready` transitions

The states + table are frozen (base §9, `0103`, `ProviderInstallState`; install §A.4). The install addendum
declared the two Phase-3 edges `installed → needs_login` and `needs_login → ready` with `who: "api-phase3"`,
`kind: "phase3-login"` (`provider-install-state.ts:113-115`) and left them out of scope. **This addendum
fills them and makes the post-install lifecycle TOTAL** over the states a provider can be in once its binary
is present (`{installed, needs_login, ready, error}`). **The api is the SOLE writer** (admin actor, `0103`
write RLS `current_actor_is_admin()`); the **cli-runner NEVER writes the DB** — it only reports flow status
over the socket.

```
   installed ──probe ready──▶ ready
       │                        ▲
   probe needs_login            │ login success + smoke (pollLogin → ready)
       ▼                        │
   needs_login ────beginLogin/pollLogin/submitLoginToken───┘
       │  │
       │  └── login fail/timeout/smoke fail ──▶ error ──(retry: beginLogin)──▶ needs_login
       │
   ready ──re-probe shows cred gone (needs_login)──▶ needs_login   (re-derivation)
   {installed, needs_login, ready, error} ──re-probe binary absent──▶ not_installed  (§A.5/install §A.4)
```

| Transition                                               | WHO     | HOW                                                                                                                                                     |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installed → needs_login`                                | **api** | post-install / status-load `probeProvider` (§4.8) returns `needs_login` (binary present, not authed). Written by the §L.4.2 login-reconcile projection. |
| `installed → ready`                                      | **api** | post-install probe returns `ready` (the provider was already authed, e.g. a re-install of a logged-in provider). §L.4.2 projection.                     |
| `needs_login → ready`                                    | **api** | `pollLogin`/`submitLoginToken` settles `ready` (login + smoke passed). The login route persists `ready`.                                                |
| `needs_login → error`                                    | **api** | login flow fails (`status:"error"`). The login route persists `error` + redacted `message`. Recoverable.                                                |
| `ready → needs_login`                                    | **api** | a re-probe shows the cred expired/revoked. §L.4.2 projection (re-derivation).                                                                           |
| `error → {needs_login, ready}`                           | **api** | a retry `beginLogin`, or a status-load probe showing the cred is actually present. §L.4.2 projection + the login route.                                 |
| `{installed, needs_login, ready, error} → not_installed` | **api** | binary absent on re-probe (install §A.4 / §A.5 reprobe-absent).                                                                                         |

**Strictly additive to the merged Phase-2 table (HIGH — do NOT rewrite frozen rows).** The two existing rows
in `INSTALL_TRANSITIONS` (`provider-install-state.ts:113-115`: `installed → needs_login` and
`needs_login → ready`, declared `who: "api-phase3"`, `kind: "phase3-login"`) are **left exactly as they are
— their `who`/`kind` values are NOT changed.** This addendum only **appends the remaining login edges not
already present** (`needs_login → error`, `ready → needs_login`, `installed → ready`, `error → needs_login`,
`error → ready`) as new rows with `kind: "phase3-login"`. Both the pre-existing `api-phase3` rows and the new
rows denote api-written edges (the `api-phase3` tag was the Phase-2 placeholder marker; treat it as "api,
Phase-3 owned"). The table stays total over `{installed, needs_login, ready, error}` and test-assertable; **no
existing row is modified or removed.**

### L.4.1 The login driver (api-side, additive)

A new driver `runLoginProvider` in `provider-install-state.ts` (mirrors `runInstallProvider`):

```typescript
export interface LoginProviderRpc {
  beginLogin(p: RpcBeginLoginParams): Promise<RpcBeginLoginResult>;
  pollLogin(p: RpcPollLoginParams): Promise<RpcPollLoginResult>;
  submitLoginToken(p: RpcSubmitLoginTokenParams): Promise<RpcSubmitLoginTokenResult>;
  cancelLogin(p: RpcCancelLoginParams): Promise<RpcCancelLoginResult>;
}
```

- The driver persists the terminal lifecycle from a settled flow status: `status:"ready"` ⇒ persist `ready`
  (clear message); `status:"error"` ⇒ persist `error` + redacted `message`. The intermediate
  `awaiting_*` statuses are **not** persisted (mid-flow); the durable state stays `needs_login` until the
  flow settles. begin, on entering the flow from `installed`, persists `needs_login` (collapse, mirroring
  install's collapse-to-`installing`) so the wizard reflects "logging in".
- A transport `RpcErr` (`bad_request`/`internal`) THROWS (mapped §4.7); the durable row is left for the
  §L.4.2 projection to re-derive on the next status load — never clobbered to a guessed state.

### L.4.2 Login-reconcile projection (FROZEN, pure — the lifecycle self-heals on every status load)

A new pure function `reconcileLogin(persisted, probe)` (additive, alongside `reconcileInstalling`):

- **Identity off the post-install states** — applies ONLY to `persisted ∈ {installed, needs_login, ready,
error}`; returns `not_installed`/`installing` unchanged (those belong to the install machine + §A.4.2).
- For an applicable `persisted`, map by the fresh `probeProvider` result:
  - `probe === "ready"` ⇒ `ready` (authenticated).
  - `probe === "needs_login"` ⇒ `needs_login` (present, not authed).
  - `probe === "not_installed"` ⇒ `not_installed` (binary gone — reprobe-absent).
  - `probe === "multiplexer_unavailable"` or `"error"` ⇒ **leave `persisted` unchanged** (transient/opaque —
    do NOT downgrade on a probe we cannot trust; re-reconcile next load).
- The status resolver composes the two projections in order: `reconcileInstalling(persisted, probe)` →
  `reconcileLogin(that, probe)` → final. `reconcileInstalling` handles `installing`; `reconcileLogin` handles
  the rest. A completed install whose probe says `ready` thus lands at `ready` in one load
  (`installing`→`installed`→`ready`). Corrections are persisted under the admin actor (§L.4.3).

### L.4.3 Persistence mechanics

Identical to install §A.4.1: the api persists via the settings/onboarding module's repository under an
**admin** `AccessContext` (the `0103` write RLS is `current_actor_is_admin()`). One row per provider
(`provider PRIMARY KEY`, instance-global, ADR 0007). `message` is the **redacted** string (§6.4, `≤ 2000`
per `message_len_ck`). The frozen Phase-2 `upsertProviderInstallState` (`repository.ts:629`) persists the
`version` column **only** for `state === "installed"` and clears it otherwise — so `ready`/`needs_login` rows
carry no `version` column (the binary version is recoverable via a re-install/probe); this addendum does NOT
change that frozen write behavior. `message` is cleared on every non-`error` state.

---

## L.5 ONBOARDING LOGIN ROUTES

The onboarding cli-auth step drives login via the api over the socket and reflects the persisted state.
Mirrors §A.5 install exactly (same module `packages/settings/src/onboarding-routes.ts`, same
`resolveAccessContext` + admin gate + admin-scoped `withDataContext` wiring, same module-isolation port
pattern — **settings declares ports, never imports `@jarv1s/chat`**; the composition root
(`packages/module-registry/src/onboarding-install.ts` + a sibling `onboarding-login.ts`) wires the RPC client
to the port).

Four new **admin-gated** routes:

| Route                                              | Body                               | Drives             | Persists                              |
| -------------------------------------------------- | ---------------------------------- | ------------------ | ------------------------------------- |
| `POST /api/onboarding/provider-login/begin`        | `{ providerKind }`                 | `beginLogin`       | `needs_login` (collapse)              |
| `POST /api/onboarding/provider-login/poll`         | `{ providerKind, loginId }`        | `pollLogin`        | terminal `ready`/`error` when settled |
| `POST /api/onboarding/provider-login/submit-token` | `{ providerKind, loginId, token }` | `submitLoginToken` | terminal `ready`/`error` when settled |
| `POST /api/onboarding/provider-login/cancel`       | `{ providerKind, loginId }`        | `cancelLogin`      | (none — stays `needs_login`)          |

- **Reject a `blocked`/no-adapter provider (agy) CLEANLY** with a 400 (the catalog/adapter installability
  port, reused from §A.5) BEFORE any RPC — surfacing the redacted `blockedReason`.
- **The admin gate AND the `0103` write RLS are the SAME actor** (the route resolves an admin
  `AccessContext` and persists inside it) — no privilege mismatch (identical to the install route).
- **Response surface (the ONLY login data the UI receives):** `begin`/`poll` return `{ providerKind,
loginId, status, authorizationUrl?, userCode?, installState, message? }`; `submit-token` returns
  `{ providerKind, loginId, status, installState, message? }`; `cancel` returns `{ ok, installState }`.
  `installState` is the persisted lifecycle for the wizard. **The pasted `token` is request-only — never in
  any response, never persisted, never logged (§L.6.3).**
- **`installState?` on the founder status** (`OnboardingCliProviderDto.installState`, already frozen
  `onboarding-api.ts:52-63`) is populated from the persisted row, now reflecting `needs_login`/`ready` as the
  login lifecycle advances. The status resolver runs the composed §L.4.2 reconcile so the wizard always sees
  a truthful, self-healed lifecycle.
- The new request/response DTOs + JSON schemas are added to `packages/shared/src/onboarding-api.ts`
  (additive; `additionalProperties:false` per existing convention). `installState` reuses the frozen
  `ProviderInstallState` enum.

---

## L.6 SECURITY (the Phase-3 core — auth material NEVER escapes)

### L.6.1 Unified exclusivity gate (login is auth-volume-exclusive with chat)

Login runs a real, third-party provider CLI subprocess **same-UID** (base §13 / #347). While it runs it
could read a concurrent chat session's per-session `0600` MCP-token files, and a concurrent chat CLI could
read login-in-progress auth material — the same cross-trust concern the §4.1.0a gate exists to bound. So
login is folded into the **same** server-wide admission gate (NOT a new flag; `JARVIS_CLI_RUNNER_SINGLE_USER`
default ON governs it):

- **Liveness is measured on DISK + the in-memory reservation, never a Map alone** (the D13/D14 lesson). The
  gate computes, under the admission mutex:
  - `liveChat` = `listLiveMuxSessions` (`jarv1s-live-*`, §4.6) ∪ the chat reservation set (`engine-host.ts:73`).
  - `loginActive` = enumeration of `jarv1s-login-*` mux sessions ∪ the in-memory login reservation.
  - **Helper surface (MED-2 completeness; HIGH — do NOT reuse the chat-prefix helpers).** The existing
    `killMuxSessionByName` (`cli-chat-engine.ts:638-644`) and `listLiveMuxSessions` (`:652-661`) are
    **hardwired to `SESSION_PREFIX = "jarv1s-live-"`** — `killMuxSessionByName(io, "jarv1s-login-anthropic")`
    would target `=jarv1s-live-jarv1s-login-anthropic` and **miss the real login session**, leaving an orphan
    that blocks the gate. So the build adds **dedicated login primitives** with a new
    `LOGIN_SESSION_PREFIX = "jarv1s-login-"` (additive, same file):
    `listLoginMuxSessions(io): Promise<string[]>` (mirrors `listLiveMuxSessions` but strips the login prefix)
    and `killLoginMuxSession(io, provider): Promise<void>` (forms `=${LOGIN_SESSION_PREFIX}${provider}` and
    kills it with the **same leading-`=` exact-name guard** as `killMuxSessionByName`, `:643`). The provider
    is a fixed enum literal (no traversal risk). The chat helpers (`jarv1s-live-` only) are UNCHANGED, so
    login sessions never pollute chat `listLiveSessions`/§5 reconciliation, and the login helpers never touch
    chat sessions. (A prefix-parameterized refactor of the shared body is an acceptable equivalent, provided
    the existing exports keep their `jarv1s-live-` behaviour.)
- **Admit `beginLogin`** only if `liveChat` is empty AND `loginActive` is empty; then register the login
  reservation. **Admit chat `launch`** only if `loginActive` is empty AND the existing §4.1.0a different-key
  check passes; the launch path adds `loginActive`-empty to its admission predicate (an added conjunct on the
  existing check — **no wire change**, reuses `unavailable`).
- The login reservation is released on completion, cancel, timeout, OR startup sweep — **release is
  guaranteed by settle AND by timeout** (the D15 NEW-1 fail-safe), so a hung browser round-trip can never
  freeze the gate. The startup sweep kills `jarv1s-login-*` (§L.3.4).

This upholds the #347 stand-in invariant: **at most one untrusted CLI touches the auth/home volume at a
time.** Lifting it (concurrent multi-user login/chat) stays gated on #347, exactly like chat.

### L.6.2 Surface chokepoint — only the authorization URL + user code ever cross the socket

The login pane may contain a bearer/access token the CLI echoes, AND — in paste mode — the code the user
pasted via `paste-buffer` (which lands in the pane/scrollback). **Raw stdout / capture-pane NEVER crosses the
socket.** The per-provider `adapter.extractSurface` (§L.1.1) is the chokepoint: it returns **only**
`{ authorizationUrl?, userCode? }`, applying:

- `authorizationUrl`: **`https:` scheme required** AND the URL must match a per-provider `authUrlAllowlist`
  entry on **BOTH host and path-prefix** (§L.1.1/§L.1.2) — host-match alone is insufficient (MED-1: a
  magic-link path could carry session material in the query). A URL failing scheme, host, OR path is
  **DROPPED, not surfaced** (also defends against a compromised/buggy CLI printing a phishing URL).
- `userCode`: must match the adapter's `userCodePattern` (§L.1.2) — a value not matching is dropped.
- **Pasted-code echo guard (HIGH-2).** Two layers stop the user's pasted code from being re-surfaced as a
  `userCode`: (1) **after a `submitLoginToken`, the login service NEVER calls `extractSurface` to surface a
  `userCode`** — post-submit status is derived from `probeProvider` ONLY (§L.2.3), so the typed code that is
  now in the pane is never parsed back out; and (2) belt-and-suspenders, the service **drops any extracted
  value byte-equal to the in-flight pasted token** before returning. (The genuine device/pairing `userCode`
  is surfaced only in the pre-paste `awaiting_authorization` phase, before any code is typed.)
- **Exact + pattern redaction before the wire.** `redactSecrets` (§6.4, `packages/ai/src/adapters/redact.ts`
  — `Bearer\s+\S+`, `jst_…`, `JARVIS_MCP_TOKEN=…`) runs over the extracted strings, AND a new additive
  `redactExact(text, secret)` (§L.6.3) scrubs the **exact** in-flight pasted-token value (which `redactSecrets`'
  MCP-token patterns do NOT match — HIGH-1).

The authorization URL + user code are **authorization material for DISPLAY**, not bearer secrets — they MUST
be shown for the flow to work, and are useless without the user's own browser credentials. They legitimately
reach the api response + the UI. **But the api MUST NOT LOG the `authorizationUrl` or `userCode`** (MED-1: a
URL query/fragment could carry single-use state/PKCE material — treat them as display-only, not log-safe;
the §L.5 route returns them to the client but never writes them to a log line). Everything else the CLI
prints stays inside the cli-runner.

### L.6.3 The pasted authorization code is auth material — same discipline as the MCP token

In paste mode the user's pasted code (`submitLoginToken.token`) is auth material in transit. It follows the
**exact** discipline frozen for the MCP bearer (base §6.1/§6.3):

- Crosses api → cli-runner **ONLY** in the socket payload (the `0600` private socket). **Never** logged
  (frame bodies are never logged on either side, §6.4 — only `{method,id,sessionKey,bytes}`), **never**
  persisted, **never** echoed in any RPC result or HTTP response, **never** placed in argv (`/proc/cmdline`),
  env, or a tmux launch line.
- The server feeds it into the captured login pane via **`tmux load-buffer` (from a `0600` temp file on the
  auth volume) → `paste-buffer`** — the same argv-free mechanism `TmuxMultiplexer.submit`
  (`tmux-multiplexer.ts:65-73`) uses for arbitrary text. This keeps the code **out of `/proc/cmdline`**
  (a bare `send-keys <token>` would place it in the `tmux` client's argv, which IS world-readable to the
  same UID — so send-keys is NOT used for the token); the temp file is removed immediately after the paste.
  The pane is read only by `extractSurface`, which never echoes input. The transient pane visibility is safe
  **because login is exclusive (§L.6.1)** — no other untrusted CLI runs concurrently to `capture-pane` it
  (the residual same-UID reader is the #347 class, gated).
- It transits api process memory transiently (api → socket); the api has **no CLI-data mount** so it cannot
  write it anywhere durable. The resulting provider cred lands on the auth/home volume **only** via the CLI
  exchanging the code.
- **Exact-value redaction (HIGH-1 — `redactSecrets` is NOT enough).** `redactSecrets`
  (`packages/ai/src/adapters/redact.ts:12-18`) only matches the MCP-token shapes (`Bearer …`, `jst_…`,
  `JARVIS_MCP_TOKEN=…`) — an arbitrary OAuth/device/paste code a CLI echoes into stderr/error text would NOT
  be scrubbed. So the login service holds the in-flight pasted token in memory for the duration of the flow
  and, before ANY error `message` or surfaced string crosses the socket, runs a new additive
  `redactExact(text, secret)` helper (in `redact.ts`, additive — a literal-substring scrub of the exact held
  value, applied IN ADDITION TO `redactSecrets`). The held value is zeroed/dropped the instant the flow
  settles (`ready`/`error`/cancel/timeout). This is additive (a new exported helper), not a frozen-shape
  change.
- The HTTP layer MUST NOT log the `submit-token` request body (the `token` field). Acceptance test: the
  pasted token is absent from all logs, from `/proc/<pid>/cmdline`, from `capture-pane` forwarded to the api,
  and from every RPC/HTTP response field — including when a CLI echoes it into an error message (the
  `redactExact` path).

### L.6.4 Resulting provider cred stays on the auth/home volume

The provider credential the login produces (`~/.claude`, `~/.codex` auth) is written by the CLI under HOME =
`/data/cli-auth` (the auth/home volume, cli-runner-RW-only, base §8). The api/worker/web mount **none** of
it. The api persists **only** the lifecycle state (`needs_login`/`ready`) + a redacted `message` into
`provider_install_state` — **never** the cred, the token, the device code, or raw pane text. Base invariant
"secrets never escape" holds: no auth material reaches pg-boss payloads, logs, the DB (beyond lifecycle),
api responses (beyond the displayable URL/code), or AI prompts.

### L.6.5 Residual limitation (carried from base §13 / #347)

The login CLI runs same-UID with any (gated-out) chat CLI and with the installer; the §L.6.1 exclusivity gate

- the same-UID limitation (base §13) are the Phase-3 posture. Full per-UID separation is deferred to **#347**
  (the same fast-follow that gates lifting `JARVIS_CLI_RUNNER_SINGLE_USER`). This addendum does not change that
  posture; it extends the existing gate to cover login.

---

## L.7 Acceptance criteria

1. **Additive verbs, no frozen-shape change.** `beginLogin`/`pollLogin`/`submitLoginToken`/`cancelLogin` are
   appended to `RpcMethod`; they reuse the §3.4 envelope, §3.6 hello, §3.2 framing, §6.4 redaction, §4.7
   mapping. No base/install type/method/envelope is modified. New wire types live in `login-contract.ts`
   importing `RpcProviderKind` read-only. The §4.1.0a gate is reused, not altered in shape.
2. **Adapter is the allowlist, TWO distinct rejection paths.** A `provider` not an `RpcProviderKind` →
   `bad_request` ("unknown provider"); a valid kind that is `blocked`/no-adapter (agy) → `bad_request` via
   the **distinct** catalog/adapter-blocked path (different message). The §L.1.3 registry assertion rejects,
   at load, an ORPHAN adapter (an adapter for an install-`blocked` provider) and a present-but-incomplete/
   placeholder adapter; a **missing** adapter on an install-`supported` provider is allowed (login unavailable
   for it — codex's headless-smoke fallback).
3. **Exclusivity gate (tested).** With a live chat session, `beginLogin` is rejected `unavailable`; with a
   login in flight, a chat `launch` for a different key is rejected `unavailable`; the login reservation is
   released on completion, cancel, AND timeout (a hung login does not freeze the gate); a **late-success
   login session created after a create-timeout is reaped** (no orphan blocks the gate, §L.3.1); the startup
   sweep kills `jarv1s-login-*` via the **dedicated** `listLoginMuxSessions` + `killLoginMuxSession`
   (NOT the chat-prefix `killMuxSessionByName`, which is `jarv1s-live-`-bound — §L.6.1/§L.3.4).
4. **Surface chokepoint (tested).** `extractSurface` returns only `{authorizationUrl?,userCode?}`; a URL
   failing scheme OR host OR **path-prefix** is dropped; the `userCode` must match `userCodePattern`; raw pane
   text never crosses the socket; the api never **logs** the URL/code (MED-1); **post-submit, no `userCode` is
   surfaced** and any value byte-equal to the held pasted token is dropped (HIGH-2).
5. **Pasted-token discipline (tested).** `submitLoginToken.token` is absent from logs, `/proc/<pid>/cmdline`,
   forwarded `capture-pane`, and every RPC/HTTP response; it crosses only via the socket payload and is fed
   via the argv-free `load-buffer`→`paste-buffer`; **scrubbed by `redactExact` even when a CLI echoes it into an error message** (HIGH-1 —
   `redactSecrets` alone does not match an arbitrary code).
6. **State machine: total + correct (additive).** The post-install lifecycle is total over `{installed,
needs_login, ready, error}`; the two existing `phase3-login` rows are **left unchanged** and the remaining
   login edges are **appended** to `INSTALL_TRANSITIONS` (HIGH-4 — no frozen row rewritten); the **api** persists
   `needs_login` (collapse on begin) and the terminal `ready`/`error` under an **admin** actor into
   `app.provider_install_state`; the **cli-runner never writes the DB**. A failed login is
   `RpcOk{status:"error"}`, not `RpcErr`. `reconcileLogin` self-heals the lifecycle on every status load
   (composed after `reconcileInstalling`).
7. **Onboarding routes.** Four admin-gated login routes mirror the install route (admin gate == `0103` write
   RLS actor); a `blocked`/no-adapter provider is rejected 400 before any RPC; `installState?` reflects the
   advancing lifecycle; the `submit-token` body is never logged.
8. **Completion via probe + runtime smoke.** `ready` is reported only when `probeProvider === "ready"` AND the
   §L.9.1 runtime smoke passes; the login session is torn down + the gate released on settle.
9. **claude is the certain login MVP** (adapter + smoke MUST pass before merge); **codex login is
   smoke-contingent** — if the §L.9.2 headless smoke fails at the pinned version, codex install stays
   `supported` but codex LOGIN ships `blocked` (no adapter ⇒ `beginLogin` → `bad_request`), like agy. **agy
   stays blocked** unless its pinning+login spike yields a pinnable/checksummed artifact (§A.1) AND a concrete
   login adapter + passing smoke (§L.9). A guarded-live login proof (`JARVIS_LIVE_LOGIN_TEST=1`, §L.9.2)
   exercises a real login end-to-end where feasible, or the manual runbook documents why and verifies it.

---

## L.8 Testing

- **Unit (cli-runner):** the login service flow — `beginLogin` returns `awaiting_authorization` with a parsed
  surface from a fake pane; `pollLogin` returns `ready` when the fake `probeProvider` flips to ready + smoke
  passes; `submitLoginToken` feeds the code (asserted via the fake `TmuxIo` load-buffer/paste-buffer capture) and never
  echoes it; `cancelLogin` is idempotent; the §L.1.3 adapter-registry assertion; the §L.6.2 extractSurface
  guards (https + host allowlist + userCode regex + redaction); a wrong `loginId` → `bad_request`.
- **Unit (gate):** extend `cli-runner-server.test.ts`'s fake-mux harness so `jarv1s-login-*` sessions are
  enumerable (`listLoginMuxSessions`); assert the §L.6.1 mutual exclusivity (chat-live ⇒ beginLogin
  unavailable; login-in-flight ⇒ launch unavailable), the timeout/cancel/startup-sweep release, AND the
  **late-success orphan reap** (wedge the login mux-create past its timeout; assert the late session is killed
  and a subsequent launch is admitted — mirrors the chat-launch UNPROVEN-1 test).
- **Unit (redaction):** `redactExact(text, secret)` scrubs the exact held value (incl. when embedded in a
  larger error string) AND composes with `redactSecrets`; the api does not log the surfaced URL/code.
- **Unit (api):** `runLoginProvider` persists `needs_login` on begin and the terminal `ready`/`error`;
  `reconcileLogin` projection truth table (incl. transient-probe = unchanged) and its composition with
  `reconcileInstalling`; the login routes' admin gate + blocked-provider 400 + the request-body-not-logged
  assertion.
- **RPC round-trip:** each login verb across the in-process socket pair (reusing the §11 `chat-rpc-client`
  fake server); the surface/redaction holds across the wire; a failed flow is an `RpcOk{status:"error"}` (not
  an `RpcErr`).
- **Guarded-live (§L.9.2):** behind `JARVIS_LIVE_LOGIN_TEST=1`, a REAL `claude`/`codex` login end-to-end
  where the environment permits, asserting `probeProvider` flips to `ready` and the cred persists across a
  cli-runner restart. **A mocked test is NOT sufficient for a flow that shells out to a real CLI** (the
  Phase-2 native-binary trap lesson) — where the live test cannot be automated (codex's headless callback
  spike, §L.9), the manual runbook (`docs/operations/manual-install-smoke.md`, extended) is the proof and the
  PR states precisely why.
- **Host-mode suites stay GREEN, unchanged** (login is a containerized-path feature behind the socket; the
  in-process fallback path is untouched — base §7.1 note).

## L.9 PER-PROVIDER SMOKE GATE (plan item 12)

A provider is **login-supported** (can reach `ready` — a login adapter is present and its smoke passes) on a
**separate axis** from install-`status:"supported"` (§A.1, gated by the install smoke). A provider can be
install-`supported` yet NOT login-supported (codex's headless fallback, §L.9.2). This section gates the
**login** axis. Two layers:

### L.9.1 Runtime smoke (the `needs_login → ready` gate)

On `probeProvider === "ready"`, before reporting `ready`, the login service runs a **bounded non-interactive
auth check** — re-running the provider's auth-status command (the §4.8 probe path) and confirming a clean
non-interactive success (NOT an interactive prompt). Only then is `ready` reported + persisted. This ensures
`ready` means "non-interactive auth actually works," not merely "the CLI printed a success line."

### L.9.2 Release smoke (justifies catalog `status:"supported"`)

A per-provider proof, run at the build/spike step + recorded, that ALL hold:

1. Login completes end-to-end via the adapter (URL/code surfaced, browser auth, completion detected).
2. **The token persists across a cli-runner restart** (restart the sidecar; `probeProvider` still `ready`).
3. Non-interactive auth works (a real chat `launch` for the provider succeeds).
4. The transcript format/path is verified (the existing parser handles the provider's transcript — for agy,
   the Gemini-shaped parser spike, base §14).

**Merge criteria (reconciled — claude is the certain login MVP; codex is smoke-contingent).** **claude**'s
adapter + release smoke MUST pass before merge — it is the certain login MVP. **codex** is the MVP _target_,
but its headless-login flow is uncertain (§L.1.2: the default `codex login` uses a localhost callback a
remote headless container's browser cannot reach): the L.9.2 smoke decides it. If the smoke confirms a
headless-usable flow at the pinned codex version, codex login ships `supported`; **if it does not, codex
INSTALL stays `supported` but codex LOGIN ships `blocked`** (the adapter is omitted, so `beginLogin` for codex
returns the catalog/adapter-blocked `bad_request`, and the provider never reaches `ready`) — exactly like agy,
until a headless flow exists. This is the one MVP value the smoke may force to blocked; it is NOT a re-spec.
**agy/Antigravity stays `blocked`** unless its spike yields BOTH a pinnable+checksummed artifact + honored
`selfUpdateDisable` (§A.1) AND a concrete login adapter + a passing release smoke. The release smoke is
automated where feasible (§L.9.2 guarded-live) and otherwise documented + manually verified in the extended
runbook.

## L.10 Out of scope (unchanged from base + install + plan)

Per-UID separation (#347 — the gate stands in); GLM/opencode provider; API-key chat engine (rejected); the
agy artifact+login spike resolution (a build task that flips the catalog + adds the adapter); Phase-4
onboarding end-to-end integration, `JARVIS_HOST_CLIS` removal, deploy docs, and the landed ADR. This addendum
freezes the login adapter **shape + policy**, the four verbs/service/state-ownership, the smoke gate, AND the
concrete MVP adapter VALUES (§L.1.2, normative + committed). The remaining build steps are: (a) the §L.9.2
smoke VALIDATING those committed values against the pinned CLI versions, and (b) the codex headless-login
determination (which may force codex login to `blocked` per §L.9.2) — NOT re-authoring the values.
