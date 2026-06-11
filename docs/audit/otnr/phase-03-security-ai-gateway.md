## Phase 3 — AI Gateway & Provider Security

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 3
- MED: 6
- LOW: 4
- INFO: 2

### Findings

#### [HIGH] No rate limiting or cost ceiling on any AI / chat / MCP route
**File:** `apps/api/src/server.ts:59-65` (and `packages/chat/src/live-routes.ts:37`, `packages/chat/src/mcp-transport.ts:38`)  
**Invariant violated / concern:** Review dimension "Rate limiting & cost controls: per-user guard against runaway token spend" — missing.  
**Detail:** The rate-limit plugin is registered with `global: false`, so it throttles only routes that opt in via per-route `config.rateLimit`. The only opt-ins are `/api/auth/*` (`server.ts:174`) and the connectors OAuth route. The token-spending surfaces — `POST /api/chat/turn` (drives a live CLI turn against the user's paid model), `POST /api/mcp` `tools/call`, and `POST /api/ai/assistant-tools/:name/invoke` — have **no** request throttling and **no** per-user token/cost budget anywhere in the codebase (grep for `max_tokens|budget|costLimit|tokenLimit` finds only the single hardcoded `max_tokens: 8192` in the HTTP adapter). A logged-in user (or a stolen session) can submit unlimited turns in a tight loop, each launching/feeding a CLI agent or a paid HTTP completion, with the only natural backpressure being `ChatTurnInFlightError` (one turn at a time per user — but a script can fire the next the instant the prior returns). For a project whose threat model includes paid provider keys, this is an uncapped financial-DoS vector.  
**Suggested fix:** Add `config.rateLimit` to `/api/chat/turn`, `/api/mcp`, and `/api/ai/assistant-tools/:name/invoke` (per-IP and ideally per-`actorUserId`). Separately, introduce a per-user rolling token/turn budget enforced in `ChatSessionManager.submitTurn` / the capability router, surfaced as a 429 when exceeded.

#### [HIGH] MCP gateway tool allowlist is not enforced for `openai-compatible` (Codex) and is fragile for Gemini
**File:** `packages/chat/src/live/cli-chat-engine.ts:236-256`  
**Invariant violated / concern:** Hard invariant — least-privilege agent sandbox / "MCP gateway: allowlist enforced server-side?"; the engine relies on per-CLI client-side flags to constrain the agent, and the Codex path omits any MCP tool allowlist.  
**Detail:** For Claude the launch pins `--allowedTools "mcp__jarvis__*"` (or `--tools ""`) plus `--strict-mcp-config`, a tight allowlist. The Codex command (`buildCodexCommand`) sets `--sandbox read-only`, `-a never`, `features.shell_tool=false`, `features.apply_patch_tool=false`, but configures **no MCP tool allowlist** — every tool the Jarvis MCP server advertises is callable, and Codex's own non-shell builtins are not denied the way Claude's `--tools ""` denies native tools. The Gemini path (`buildGeminiCommand`) restricts MCP *servers* with `--allowed-mcp-server-names jarvis` and sets `tools.core: []` in settings.json, but there is no per-tool allowlist. Because the gateway itself (`gateway.ts`) is the real server-side chokepoint — it validates input, applies the risk policy, and scopes to the token's user — the blast radius is bounded to Jarvis tools the user already owns; but the comment header at lines 15-22 calls these flags "SECURITY-CRITICAL," and the protection is inconsistent across providers and lives entirely in untrusted client process args rather than being enforced server-side at the gateway.  
**Suggested fix:** Make the gateway the single enforcement point: have `listTools`/`callTool` filter against a per-session allowlist (capability/permission based) so even if a CLI requests an out-of-scope tool the server rejects it. Bring Codex/Gemini to parity with Claude's per-tool allowlist, and add a regression test asserting an out-of-allowlist `tools/call` is rejected server-side regardless of CLI flags.

#### [HIGH] MCP transport authenticates but is not rate-limited, enabling session-token brute force / abuse
**File:** `packages/chat/src/mcp-transport.ts:38-49`  
**Invariant violated / concern:** Defense-in-depth on the secret-bearing endpoint; combined with the no-rate-limit gap above, the `/api/mcp` Bearer-token check is unthrottled.  
**Detail:** Every `/api/mcp` request verifies a `jst_<uuid>` session token via `SessionTokenRegistry.verify`. Tokens are random UUIDv4 (unguessable), so brute force is not practically feasible — but the endpoint is bound to `0.0.0.0` in production (`server.ts` host default) and has no rate limit, so an attacker on the LAN can hammer `tools/call` with a valid-but-leaked token (e.g. one exposed via the Codex `ps`-visible env var, see LOW below) entirely unthrottled, each call dispatching a real module operation under the victim's RLS scope. Token verification failures are also unlogged, so abuse is invisible.  
**Suggested fix:** Add per-IP rate limiting to `/api/mcp`; log (rate-limited) token-verification failures at warn level with no token material; consider binding the MCP listener to loopback only (the engine connects via `127.0.0.1`, so `0.0.0.0` exposure is unnecessary for this route).

#### [MED] Prompt-injection: recalled memory and prior turns are concatenated into the system context without delimiter escaping
**File:** `packages/chat/src/live/recall-seed.ts:29-54`, `packages/chat/src/live/chat-session-manager.ts:179-186,364-374`  
**Invariant violated / concern:** Review dimension "Prompt injection: user content passed to AI without delimiting/sandboxing?"  
**Detail:** `renderMemorySeedBlock` wraps recalled chunks in `<memory>…</memory>` and `renderReplayBlock` wraps prior turns in `<conversation>…</conversation>`, then both are joined and `engine.submit()`-ed as a seed turn. The chunk/turn text is interpolated raw — a stored message body containing the literal string `</memory>` or `</conversation>` (or `</conversation>\nSystem: …`) breaks out of the delimiter and can inject instructions into what the model treats as framing/system context. Because the content is the *same user's* own past turns (RLS-scoped), this is self-injection rather than cross-user — lowering severity — but agents reached real tools via the MCP gateway, so a user who pastes adversarial text once can have it re-injected as quasi-system context on every subsequent session launch.  
**Suggested fix:** Escape or strip the closing delimiter tokens from interpolated content (e.g. replace `</memory>`/`</conversation>` in chunk/turn text), or switch to a non-XML framing that cannot be closed by content. Add a test feeding a turn whose body contains the closing tag.

#### [MED] Anthropic HTTP adapter hardcodes `max_tokens: 8192`; provider request shapes are hardcoded per provider
**File:** `packages/ai/src/adapters/http-api.ts:61-120`  
**Invariant violated / concern:** Provider-agnostic AI invariant (#7) — features must not hardcode provider/model specifics; also incidental-complexity / cost-control smell.  
**Detail:** `buildRequest` hardcodes a per-provider branch (`anthropic`/`openai-compatible`/`google`) with a fixed Anthropic `max_tokens: 8192`, no `max_tokens` for OpenAI/Google, and no way for the caller (capability router) to pass a token cap, temperature, or system prompt. The model id is correctly threaded from the router (`input.model.provider_model_id`), so the provider/model is *selected* by the router — good — but the request envelope is a fixed switch that bakes in provider quirks and a magic token ceiling. This both undermines a clean provider-agnostic contract and removes the natural place to enforce a per-call token budget (see HIGH above).  
**Suggested fix:** Thread a `maxTokens` (and optional system prompt) field through `GenerateChatInput` from the router/policy layer; default it from configuration rather than a literal. Keep the per-provider serialization but drive limits from the request, not constants.

#### [MED] CLI engine command construction joins user-controlled paths into a single shell line
**File:** `packages/chat/src/live/cli-chat-engine.ts:196-266` (and `adapters/tmux-bridge.ts:31-42`)  
**Invariant violated / concern:** Injection surface — `buildLaunchCommand` builds a string that is sent verbatim to `tmux send-keys` and parsed by a shell.  
**Detail:** Unlike `createRealTmuxIo.run`, which deliberately uses `execFile` (no shell) "so a shell join would [not] mangle args," the launch path constructs `launchLine` as a single string (`cd <dir> && claude --mcp-config <json> …`) and sends it through `tmux send-keys … "Enter"`, where tmux feeds it to the session's interactive shell. `shellQuote` single-quotes `neutralDir` and `personaPath`, and the MCP JSON is single-quoted — but `mcpServerUrl` and `mcpToken` are embedded inside JSON that is then single-quoted as a whole, and the Codex path interpolates `opts.mcpServerUrl` directly into `-c 'mcp_servers.jarvis.url="${opts.mcpServerUrl}"'`. These values are currently server-derived (`http://127.0.0.1:3000/api/mcp`, a minted `jst_` token) so not attacker-controlled today, but the construction is a latent shell/argument-injection sink the moment any of these become user-influenced (e.g. a configurable base URL).  
**Suggested fix:** Drive the CLI via `execFile`-style argv arrays (as the one-shot `run` already does) rather than a shell string, or assert/validate `mcpServerUrl` against a strict allowlist and shell-quote every interpolated value including those inside the Codex `-c` expressions.

#### [MED] `validateToolInput` is a hand-rolled partial JSON-schema validator that under-validates tool input
**File:** `packages/ai/src/gateway/input-validation.ts:23-51`  
**Invariant violated / concern:** Boundary validation / "user content passed to AI tools without sandboxing"; also bespoke-helper-duplicating-canonical-utility smell.  
**Detail:** The validator checks only top-level required keys and a single scalar/array/object `type` per property. It ignores nested schemas, `enum`, `format`, string length, number ranges, additionalProperties, and array item types. So an agent can pass arbitrary extra keys and arbitrarily large/nested values that satisfy the shallow `type` check straight into a module's `execute` handler. The doc comment frankly calls this "deliberately minimal … a full JSON-schema validator can replace this." Given the gateway is "the single chokepoint between Jarvis and every module's real operations," shallow validation pushes the real input-trust burden onto every module handler.  
**Suggested fix:** Replace with a real JSON-schema validator (ajv is already a transitive dep via Fastify) so the gateway enforces the module's declared contract fully, including `additionalProperties: false`, enums, and bounds. This deletes the bespoke validator entirely.

#### [MED] Tool result data is returned to the agent verbatim with no size bound or redaction
**File:** `packages/ai/src/gateway/gateway.ts:94-103`, `packages/chat/src/mcp-transport.ts:110-115`  
**Invariant violated / concern:** Response leakage / "pipeline ever echoes secrets or other users' data" — defense-in-depth on what flows back into the model context.  
**Detail:** `runHandler` returns `result.data` (the owning module's raw handler output) which `gatewayResponseToMcp` serializes with `JSON.stringify(res.data)` straight into the MCP `content[].text` the agent ingests. There is no allowlist of returned fields, no size cap, and no redaction pass. RLS scopes the data to the actor, so this is not cross-user leakage; the risk is (a) a module accidentally returning a secret/credential field that then lands in the model's context (and onward to the provider, violating "secrets never reach AI prompts" if a module is careless), and (b) an unbounded result blowing the context / token budget. The only protection is each module's own discipline.  
**Suggested fix:** Have the gateway enforce that returned data conforms to the tool's declared `outputSchema` (strip undeclared fields) and impose a serialized-size cap, truncating with a marker. This makes "secrets never escape into prompts" a gateway-enforced invariant rather than a per-module convention.

#### [MED] `extract-facts` job handler is a wired no-op TODO carrying provider-router intent
**File:** `packages/chat/src/jobs.ts:104-111`, enqueued at `packages/chat/src/live/persistence.ts:111-116`  
**Invariant violated / concern:** Dead/incomplete code & incidental complexity — a registered queue, payload type, worker slot, and per-turn enqueue exist for a handler that does nothing.  
**Detail:** Every completed non-incognito turn enqueues `CHAT_EXTRACT_FACTS_QUEUE` (`persistence.ts:116`), the worker is registered (`jobs.ts:145-153`), the payload type exists — but `handleExtractFactsJob` is a documented no-op `TODO(phase3-facts)`. This burns a pg-boss round-trip and worker slot per turn for zero effect, and the wiring obscures which fact-extraction path is actually live. Whatever real implementation lands must call the capability router (the comment notes it is blocked on "a clean capability-router call for non-chat completions") — so this is also a provider-agnostic seam that does not yet exist.  
**Suggested fix:** Either stop enqueueing the job until the handler is implemented (delete the enqueue + queue registration in the same pass), or land the real router-driven extraction. Do not keep an enqueued no-op in the per-turn hot path.

#### [LOW] Codex MCP token is passed via a process-visible env var on the tmux launch line
**File:** `packages/chat/src/live/cli-chat-engine.ts:236-256`  
**Invariant violated / concern:** Secrets-never-escape (#5) — a session token (auth material) is visible in `ps`/`/proc` and the tmux command history.  
**Detail:** The code itself documents the tradeoff (lines 238-241): Codex has no file-based token injection, so `JARVIS_MCP_TOKEN=<token> codex …` is sent through `tmux send-keys`, exposing the token in process args / `ps` output to any local user. Claude (file-free `--mcp-config` header) and Gemini (settings.json header) avoid this. The token is short-lived and process-scoped on a single-user host, so impact is low, but it is a genuine secret-on-the-command-line exposure that should be tracked rather than only commented.  
**Suggested fix:** Prefer writing the token into a Codex config/auth file with `0600` perms if/when Codex supports it; until then, ensure the token TTL is minimal and revoked promptly (it is revoked on reap/clear — confirm idle-reap is aggressive). Track as an accepted risk in the threat model.

#### [LOW] Lost-wakeup race between pending-action creation and confirmation waiter registration
**File:** `packages/ai/src/gateway/gateway.ts:105-148`, `packages/ai/src/gateway/confirmation-registry.ts:32-34`  
**Invariant violated / concern:** Non-atomic multi-step orchestration — a fast resolve can be dropped.  
**Detail:** `confirmAndRun` (1) inserts the pending DB row, (2) emits the action_request to the UI, then (3) calls `awaitResolution` which registers the in-memory waiter. `ConfirmationRegistry.resolve` does `waiters.get(id)?.settle(...)` — if an Approve arrives (via the resolve endpoint) after the DB row exists but before step 3 registers the waiter, `resolve` finds no waiter, silently no-ops, and the tool call blocks until `confirmTimeoutMs` (150s) even though the user approved. Requires a UI round-trip faster than two awaited DB/emit calls, so it is unlikely in practice, but it is a real lost-wakeup.  
**Suggested fix:** Register the waiter before (or atomically with) emitting the action_request, or have `resolve` record a "resolved-before-waiter" state that `awaitResolution` checks on entry.  

#### [LOW] In-memory session-token and confirmation registries lose all state on restart with no recovery
**File:** `packages/ai/src/gateway/session-tokens.ts:19-47`, `packages/ai/src/gateway/confirmation-registry.ts:12-13`  
**Invariant violated / concern:** Error-handling/durability — accepted-cost design, flagged for completeness.  
**Detail:** Both registries are plain in-memory `Map`s. A mid-wait restart orphans every blocked tool call (acknowledged in the confirmation-registry comment) and invalidates every minted MCP token, so a live CLI session's subsequent `tools/call` 401s until the engine relaunches. Action-request rows persist in the DB but the in-memory waiter does not, so the pending DB row is stranded as `pending` forever (no reconciliation on boot). Low severity for a single-node single-user deployment but worth a documented recovery story.  
**Suggested fix:** On startup, optionally mark long-pending action_requests as `cancelled`/`expired`; document the restart behavior alongside the existing comment.

#### [LOW] AI-secret keyring uses a non-null assertion on the current key
**File:** `packages/ai/src/crypto.ts:18`  
**Invariant violated / concern:** TypeScript — unjustified non-null assertion masking a real failure mode.  
**Detail:** `encryptJson` does `this.keyring.keys.get(this.keyring.currentKeyId)!`. If `currentKeyId` is somehow absent from `keys` (misconfigured `JARVIS_AI_SECRET_KEYS`/`_KEY_ID`), this returns `undefined` and `createCipheriv` throws an opaque crypto error instead of a clear "current key id not present in keyring" message. The encryption itself (AES-256-GCM, random 12-byte IV, auth tag, versioned envelope, legacy multi-key decrypt) is otherwise sound and matches invariant #5.  
**Suggested fix:** Replace the `!` with an explicit guard throwing a descriptive error when `currentKeyId` is missing from `keys`.

#### [INFO] Provider/model selection correctly flows through the capability router (invariant #7 upheld)
**File:** `packages/ai/src/repository.ts:264-277`, `packages/chat/src/live/persistence.ts:50-62`  
**Invariant violated / concern:** None — positive confirmation.  
**Detail:** `selectModelForCapability` resolves the active model by capability under RLS (active model + active provider, newest first), and the live runtime asks for capability `"chat"` rather than naming a provider. The HTTP adapter and CLI engine receive the resolved `provider_kind`/`provider_model_id` — so no feature hardcodes a provider/model for *selection*. The remaining hardcoding (request envelope, `max_tokens`) is in the transport adapter and flagged separately (MED above).

#### [INFO] Secret hygiene on the provider/model API surface is correct
**File:** `packages/ai/src/repository.ts:283-311,400-418`, `packages/ai/src/routes.ts:581-600`  
**Invariant violated / concern:** None — positive confirmation.  
**Detail:** `safeProviderQuery` selects `encrypted_credential IS NOT NULL AS has_credential` and never returns the ciphertext; `serializeProvider` exposes only `hasCredential` (and forces it `false` for CLI auth). The only path that loads `encrypted_credential` (`selectProviderWithCredential`) is documented for in-process worker decryption and is not wired to any serializer. The HTTP adapter never includes the API key in error messages (`http-api.ts:52-54`), and route/live error handlers sanitize messages before returning them. No secret reaches a frontend response in the reviewed paths.
