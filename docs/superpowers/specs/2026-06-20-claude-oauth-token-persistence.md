# Spec — claude login token capture + persistence (#363)

**Status:** APPROVED 2026-06-20 (claude-scoped injection / plaintext-0600 / anthropic-only). Still
requires an independent auth/crypto review of the implementation before merge (the verification-discipline
norm for credential-handling code).
**Tracks:** GitHub #363. Follow-up to #362 (in-container install/login completion). Part of #342.
**Provider scope:** `anthropic` (claude) only. codex/gemini persist their own on-disk credentials at
login and are out of scope here (noted under [Other providers](#other-providers)).

## Problem

The cli-runner logs claude in via `claude setup-token` (the headless OAuth flow — the container has no
local browser for the interactive `/login` callback). After the user authorizes and the pasted code is
submitted, claude **prints** a long-lived token (`sk-ant-oat…`, valid ~1 year) to the pane and instructs
the user to `export CLAUDE_CODE_OAUTH_TOKEN=<token>`. It does **not** write a credential that
`claude auth status` recognizes.

Consequences (observed on the 2026-06-20 deploy test):

- The login completion probe (`probeClaudeAuth` → `claude auth status`) keeps returning
  `{"loggedIn":false}`, so `LoginService.deriveStatus` never settles the flow to `ready`.
- Chat launches `claude` expecting an authenticated CLI; it is not authenticated.

Verified mechanism: `CLAUDE_CODE_OAUTH_TOKEN=<token> claude auth status` →
`{"loggedIn":true,"authMethod":"oauth_token"}` (rc=0). So the token works as an env var; the missing
work is **capture → secure persist → inject** for the probe and the chat launch.

## Goals / Non-goals

- **Goal:** after a successful `setup-token` paste, the cli-runner captures the minted token, persists
  it `0600` in the cli-auth volume, and injects it as `CLAUDE_CODE_OAUTH_TOKEN` for (a) the claude auth
  probe and (b) the claude chat launch — so login settles `ready` and chat works, surviving restarts.
- **Goal:** the token NEVER appears in a log, an RPC result, a job payload, an AI prompt, the api/web
  responses, an export, or any tmux argv / pane scrollback beyond the unavoidable `setup-token` render
  (which is torn down with the login session).
- **Non-goal:** changing the codex/gemini login model (they persist on-disk creds themselves).
- **Non-goal:** rotation/refresh of the long-lived token (a later concern; note its ~1yr lifetime).

## Design

### 1. Capture (`LoginService.submitToken`)

After the paste + Enter, claude exchanges the code and renders
`✓ Long-lived authentication token created successfully!` followed by the `sk-ant-oat…` token. Add a
bounded **poll** of the login pane (mirrors the URL poll in `start()`) until a new adapter matcher
`tokenCapturePattern` (`/sk-ant-oat[A-Za-z0-9_-]+/` for anthropic) matches, then extract it. The token
is held in memory only as long as needed to persist it (like `flow.heldToken`), and added to the flow's
`redactExact` set so it can never cross the wire.

### 2. Persist (new `provider-token-store.ts` in cli-runner)

- `persistProviderToken(homeBase, provider, token)` → writes `<homeBase>/.jarvis/cli-tokens/<provider>`
  mode `0600`, parent dir `0700` (in the cli-auth volume, owned by the runtime uid). Atomic write
  (temp + rename).
- `readProviderToken(homeBase, provider)` → returns the token or `undefined`.
- The store is the single source of truth; it survives restarts (named volume).

### 3. Inject — claude-scoped, NOT the global allowlist (the key decision)

`CLAUDE_CODE_OAUTH_TOKEN` is **not** added to the §7.2 `ALLOWED_KEYS` passthrough (which would leak
claude's credential into every codex/gemini pane env too). Instead inject it only where claude runs:

- **Probe:** `probeProvider`/`probeClaudeAuth` gain an optional `credentialEnv?: NodeJS.ProcessEnv`
  (or a `credentialEnv(provider)` resolver) supplied by the cli-runner engine-host from the token
  store. `probeClaudeAuth` runs `io.run("claude", ["auth","status"], { env: credentialEnv })` — the
  sanitized IO already layers `opts.env` over the allowlisted base (per-call, no global leak).
- **Chat launch:** `buildClaudeCommand` prefixes the launch line with
  `CLAUDE_CODE_OAUTH_TOKEN="$(cat <shellQuote(tokenFile)>)" claude …`. The secret is read at runtime
  via `cat` — it is NEVER in the tmux argv / pane-typed string (same posture as the §6.2
  mcp-config-file path). The engine resolves `<tokenFile>` from the store path for `anthropic`.

### 4. Completion

With the token injected, `claude auth status` returns `loggedIn:true` → `deriveStatus` runs the §L.9.1
double-probe smoke → settles `ready`. The login session is torn down as today (its scrollback, holding
the rendered token, dies with it). The §L.6.2 surface suppression already drops `userCode` post-submit;
ensure the captured token is likewise never surfaced.

## Security considerations (REQUIRES auth/crypto review)

- The persisted token is a long-lived (~1yr) first-party credential. It lives ONLY in the cli-auth
  volume (`0600`), which the api/worker/web do not mount — same isolation boundary as the rest of the
  provider auth (the cli-runner is the isolation container).
- Claude-scoped injection keeps it out of other providers' CLI envs (defense-in-depth vs a compromised
  codex/gemini CLI). `$(cat file)` keeps it out of argv/scrollback; same-uid `/proc/<pid>/environ`
  exposure during a claude run is bounded by the single-active-user gate (#347), the same boundary the
  §13 token-file model already documents.
- The token must be in EVERY redaction/exfil chokepoint: RPC results, login outcomes, logs, the
  `redactExact` flow set, and the §L surface extractor (never surfaced as a URL/userCode).
- At-rest encryption: the cli-auth volume is not encrypted at rest today (provider auth dirs already
  live there in plaintext, e.g. `~/.claude`, `~/.codex`). This token is consistent with that existing
  posture; encrypting the whole cli-auth volume is a separate, broader decision — call out explicitly
  in review whether plaintext-`0600`-in-cli-auth is acceptable (recommendation: yes, matches existing
  provider-auth storage; revisit with volume-level encryption later).

## Other providers

- **codex** (`codex login`) and **gemini** write their own credential files under HOME
  (`~/.codex`, `~/.gemini`) at login, which their probes read — no token-capture needed. This spec is
  anthropic-only; the `tokenCapturePattern` adapter field is absent for them (capture is skipped).

## Test plan

- Unit: `provider-token-store` round-trip + `0600`/`0700` modes + atomic overwrite.
- Unit (`cli-runner-login`): submitToken captures `sk-ant-oat…` from a faked pane, persists it, and
  NEVER returns it in the outcome (assert the token string is absent from the serialized result).
- Unit (`cli-chat-engine`): `probeClaudeAuth` injects `credentialEnv` into the `auth status` run;
  `buildClaudeCommand` emits the `CLAUDE_CODE_OAUTH_TOKEN="$(cat …)"` prefix and the token literal is
  NOT in the launch string.
- Regression: assert `CLAUDE_CODE_OAUTH_TOKEN` is NOT in the §7.2 `ALLOWED_KEYS` (claude-scoped only).
- E2E (manual, the deploy test): authorize → paste → flow settles `ready` → chat smoke returns a
  streamed reply from the real claude CLI (the third verdict the deploy test could not reach).

## Open questions for review

1. Claude-scoped injection vs adding `CLAUDE_CODE_OAUTH_TOKEN` to the global allowlist (simpler,
   consistent with `DISABLE_AUTOUPDATER`, but leaks to other panes). **Recommendation: claude-scoped.**
2. Plaintext `0600` in cli-auth vs deferring to a future volume-encryption pass. **Recommendation:
   plaintext-0600 now (matches existing `~/.claude` storage), revisit with volume encryption.**
3. Token store path/format (`<homeBase>/.jarvis/cli-tokens/<provider>`, raw token) — bikeshed.
