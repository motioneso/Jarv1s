# Route-local junk-credential rate-limit gates

Issue: #207
Status: Approved for build planning
Label: RFA

## Problem

Jarv1s has a global rate-limit key that treats malformed bearer credentials as
unauthenticated traffic and falls back to the peer IP bucket. That prevents an
attacker from varying `Authorization: Bearer <junk-N>` to mint unlimited global
rate-limit buckets.

Some routes install route-local `config.rateLimit` rules with
`sessionRateLimitKey`. Fastify's route-local limiter replaces the global limiter
for that route, so these routes do not inherit the global malformed-bearer
fallback. Today `sessionRateLimitKey` hashes any non-empty bearer value. A caller
can therefore vary junk bearer tokens and create fresh route-local buckets.

The live affected surface is every route that uses `sessionRateLimitKey`,
including:

- `POST /api/chat/turn`
- `POST /api/ai/assistant-tools/:name/invoke`
- `POST /api/mcp`
- any other route-local limiter that reuses the same helper, such as persona
  routes

Invalid credentials still fail authorization before protected AI/tool work, so
this is abuse-surface hardening rather than an immediate AI-spend bypass.

## Goal

Malformed bearer credentials must not create distinct route-local rate-limit
buckets. Route-local limiters should keep per-principal fairness for valid
credential shapes and fall back to `ip:<peer>` for unmatched bearer shapes.

## Non-goals

- Do not build the future API-key system from #183.
- Do not remove the legacy session-bearer auth path.
- Do not change Better Auth cookie semantics.
- Do not make MCP tokens interchangeable with browser/session tokens.
- Do not stack route-local and global Fastify limiters unless a separate design
  proves it is needed.

## Design

Replace the single bearer-agnostic `sessionRateLimitKey` behavior with explicit
token-shape policies.

### Shared helpers

Add small exported helpers in `@jarv1s/module-sdk`:

- `sessionRateLimitKey(request)` for Better Auth/session-backed HTTP routes.
- `mcpSessionRateLimitKey(request)` for MCP session-token routes.
- optional internal `credentialOrIpRateLimitKey(request, policy)` helper to keep
  hashing/cookie/IP fallback behavior in one place.

`sessionRateLimitKey` behavior:

- If `Authorization: Bearer <token>` is present and `<token>` is UUID-shaped,
  return `bearer:<sha256-prefix>`.
- If a bearer token is present but is not UUID-shaped, return `ip:<request.ip>`.
- If no bearer token is present, preserve existing Better Auth cookie hashing.
- If no credential is present, return `ip:<request.ip>`.

`mcpSessionRateLimitKey` behavior:

- If `Authorization: Bearer <token>` is present and `<token>` is
  `jst_<uuid-shaped value>`, return `mcp:<sha256-prefix>` or
  `bearer:<sha256-prefix>` with a documented namespace choice.
- If a bearer token is present but does not match the MCP token shape, return
  `ip:<request.ip>`.
- MCP does not need cookie fallback for identity, but using the same fallback
  helper is acceptable as long as tests document the final behavior.

Keep hashing discipline from #113: limiter keys must never contain raw bearer
tokens or raw cookie values.

### Route wiring

- Keep `POST /api/chat/turn` and `POST /api/ai/assistant-tools/:name/invoke`
  on the UUID-shaped session policy.
- Move `POST /api/mcp` to the MCP token policy.
- Audit other `sessionRateLimitKey` call sites. If they are browser/session
  routes, keep the UUID policy. If they are MCP/session-token routes, move them
  to the MCP policy.
- Update comments in touched routes so they no longer claim arbitrary bearer
  values get per-session buckets.

## Tests

Add or update unit coverage for `@jarv1s/module-sdk`:

- UUID-shaped bearer tokens hash into the bearer namespace.
- different non-UUID bearer tokens from the same IP produce the same `ip:`
  bucket.
- valid Better Auth cookies still hash into the cookie namespace.
- empty bearer values still fall back to IP.
- valid MCP `jst_<uuid>` tokens hash into the MCP/bearer namespace.
- different malformed MCP bearer tokens from the same IP produce the same `ip:`
  bucket.
- raw bearer tokens and raw cookie values are absent from generated keys.

Add integration coverage for at least one route-local limiter:

- with a low `JARVIS_RL_CHAT_MAX`, three different malformed bearer tokens to
  `POST /api/chat/turn` from the same peer hit the shared IP bucket and receive
  `429` by the threshold.
- with a low `JARVIS_RL_MCP_MAX`, three different malformed MCP bearer tokens to
  `POST /api/mcp` from the same peer hit the shared IP bucket and receive `429`
  by the threshold.
- valid credentials keep per-principal separation.

## Acceptance criteria

- No route using a route-local limiter can mint unbounded buckets by varying a
  malformed bearer token.
- Valid browser/session callers still receive per-principal rate-limit buckets.
- Valid MCP session tokens still receive per-session rate-limit buckets.
- Raw credentials never appear in limiter keys, logs, error responses, or test
  snapshots.
- #207 can be closed with the spec-linked implementation PR.
