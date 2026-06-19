# Route-local junk-credential rate-limit gates — Implementation Plan

> **For agentic workers:** execution skills are disabled in this repo by design; the build agent
> drives this plan task-by-task under coordinator approval. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make route-local rate-limit keys fall malformed bearer credentials back to the peer-IP
bucket while keeping per-principal buckets for valid browser/session (UUID) and MCP (`jst_<uuid>`)
tokens.

**Architecture:** Replace the bearer-agnostic `sessionRateLimitKey` in `@jarv1s/module-sdk` with two
shape-gated key generators backed by one shared internal helper. `sessionRateLimitKey` gates the
bearer on the session-UUID shape (mirroring the global limiter `authPrincipalRateLimitKey`);
`mcpSessionRateLimitKey` gates on the `jst_<uuid>` MCP token shape. Both hash matched credentials
(#113 discipline) and fall back to `ip:<peer>` for unmatched shapes. `POST /api/mcp` moves to the
MCP generator; chat-turn / assistant-tools / persona-preview stay on the session generator.

**Tech Stack:** TypeScript, Fastify (`@fastify/rate-limit` route-local `config.rateLimit`), Vitest.

## Global Constraints (verbatim from spec)

- Limiter keys must never contain raw bearer tokens or raw cookie values (#113).
- Keep valid browser/session callers and valid MCP tokens on per-session/principal buckets.
- Do not build the #183 API-key system; do not remove the legacy session-bearer auth path; do not
  change Better Auth cookie semantics; do not make MCP tokens interchangeable with session tokens;
  do not stack route-local + global limiters.
- Namespace choice (DECISION): valid MCP tokens hash into a distinct `mcp:` namespace (not `bearer:`)
  to reinforce non-interchangeability with session bearers.
- DB/test commands use `JARVIS_PGDATABASE=jarv1s_207_rate_limit`.

## Grounding facts (verified)

- `packages/module-sdk/src/rate-limit-key.ts` — current `sessionRateLimitKey`; hashes ANY non-empty
  bearer → `bearer:<hash>` (the bug). Cookie → `cookie:<hash>`. Else `ip:<ip>`. `hash()` =
  sha256 hex sliced to 32.
- Global limiter copy: `apps/api/src/server.ts:446 authPrincipalRateLimitKey` already UUID-gates the
  bearer using `SESSION_UUID` (`server.ts:431`).
- MCP token shape: `jst_${randomUUID()}` (`packages/ai/src/gateway/session-tokens.ts:67`).
- Valid session bearers ARE UUID-shaped (test ids e.g. `40000000-0000-4000-8000-000000000001`), so
  UUID-gating keeps valid session callers on `bearer:` buckets.
- Call sites of `sessionRateLimitKey`: `packages/chat/src/live-routes.ts:59` (`/api/chat/turn`),
  `packages/ai/src/routes.ts:489` (`/api/ai/assistant-tools/:name/invoke`),
  `packages/chat/src/mcp-transport.ts:56` (`/api/mcp` → MOVE to MCP policy),
  `packages/settings/src/persona-routes.ts:87` (`/api/me/persona/preview` → browser route, KEEP).
- Env knobs: `JARVIS_RL_CHAT_MAX` (default 20), `JARVIS_RL_MCP_MAX` (default 120).
- `tests/unit` IS in the gate (`verify:foundation` runs `pnpm test:unit`).

---

### Task 1: Shape-gated key generators in `@jarv1s/module-sdk`

**Files:**
- Modify: `packages/module-sdk/src/rate-limit-key.ts`
- Modify: `packages/module-sdk/src/index.ts` (export `mcpSessionRateLimitKey`)
- Test: `tests/unit/session-rate-limit-key.test.ts`

**Interfaces:**
- Produces: `sessionRateLimitKey(request: FastifyRequest): string` (unchanged signature; new
  UUID-gated behavior), `mcpSessionRateLimitKey(request: FastifyRequest): string`.
- Internal: `credentialOrIpRateLimitKey(request, policy)` where
  `policy = { bearerMatches: (token: string) => boolean; bearerNamespace: string; allowCookie: boolean }`.

- [ ] **Step 1: Write/extend failing unit tests.** In `tests/unit/session-rate-limit-key.test.ts`
  import both `sessionRateLimitKey` and `mcpSessionRateLimitKey`. Assert:
  - UUID bearer → `bearer:<hash(uuid)>`, key excludes raw token.
  - two DIFFERENT non-UUID bearers from same IP → both equal `ip:<ip>` (shared bucket).
  - valid better-auth cookie (plain + `__Secure-` prefix) → `cookie:<hash>`.
  - empty bearer → `ip:<ip>`.
  - no credential → `ip:<ip>`.
  - `mcpSessionRateLimitKey`: `jst_<uuid>` bearer → `mcp:<hash>`, excludes raw token; two different
    NON-`jst` bearers same IP → shared `ip:<ip>`; `jst_` + non-uuid suffix → `ip:<ip>`; no
    credential → `ip:<ip>`; raw token absent from key.
- [ ] **Step 2: Run, verify fail.** `JARVIS_PGDATABASE=jarv1s_207_rate_limit pnpm test:unit` →
  FAIL (new behavior / missing export).
- [ ] **Step 3: Implement.** Add local `SESSION_UUID` and `MCP_TOKEN` (`/^jst_<uuid>$/i`) regexes
  with a "kept in sync with apps/api copy" comment. Implement `credentialOrIpRateLimitKey`: if
  `Bearer <token>` present and non-empty and `policy.bearerMatches(token)` → `<bearerNamespace>:<hash(token)>`;
  else if `policy.allowCookie` and a session cookie value present → `cookie:<hash(value)>`; else
  `ip:<request.ip>`. Re-express `sessionRateLimitKey` via UUID policy (`allowCookie: true`,
  namespace `bearer`) and `mcpSessionRateLimitKey` via MCP policy (`allowCookie: false`, namespace
  `mcp`). Rewrite the file's doc comment so it no longer claims arbitrary bearers get per-session
  buckets — state the shape gate + IP fallback.
- [ ] **Step 4: Run, verify pass.** `JARVIS_PGDATABASE=jarv1s_207_rate_limit pnpm test:unit` → PASS.
- [ ] **Step 5: Commit** (`packages/module-sdk/src/rate-limit-key.ts`,
  `packages/module-sdk/src/index.ts`, `tests/unit/session-rate-limit-key.test.ts`).

### Task 2: Route wiring + comments

**Files:**
- Modify: `packages/chat/src/mcp-transport.ts` (import + use `mcpSessionRateLimitKey`; update comment)
- Modify: `packages/chat/src/live-routes.ts` (comment only — keep `sessionRateLimitKey`)
- Modify: `packages/ai/src/routes.ts` (comment only — keep `sessionRateLimitKey`)
- Modify: `packages/settings/src/persona-routes.ts` (comment only — keep `sessionRateLimitKey`)

- [ ] **Step 1: Swap MCP keyGenerator** to `mcpSessionRateLimitKey`; update any nearby comment that
  implies arbitrary bearers get per-session buckets.
- [ ] **Step 2: Update stale comments** on the three session routes to state UUID-gating + IP
  fallback (no behavior change). Audit confirms persona-preview is a browser/session route → keeps
  UUID policy.
- [ ] **Step 3: typecheck** `pnpm typecheck` → PASS.
- [ ] **Step 4: Commit** the four route files.

### Task 3: Integration coverage (route-local 429 under junk bearers)

**Files:**
- Modify: `tests/integration/chat-live-api.test.ts` (or sibling) — chat-turn junk-bearer 429
- Modify: `tests/integration/chat-mcp-transport.test.ts` — MCP junk-bearer 429

- [ ] **Step 1: Write failing integration tests.** Chat: with low `JARVIS_RL_CHAT_MAX`, send 3+
  DIFFERENT malformed (non-UUID) bearers from the same peer to `POST /api/chat/turn` → they share
  the `ip:` bucket and hit `429` by the threshold; a valid UUID session bearer keeps its own bucket.
  MCP: with low `JARVIS_RL_MCP_MAX`, 3+ different malformed (non-`jst`) bearers from same peer →
  shared `ip:` bucket → `429`; a valid `jst_<uuid>` token keeps per-session separation. (Set the env
  knob before `createApiServer`; restore after — match existing env-restore pattern in these files.)
- [ ] **Step 2: Run, verify fail** (or fail before Task 1/2 land — if run after, confirm they
  exercise the new path). `JARVIS_PGDATABASE=jarv1s_207_rate_limit pnpm db:up && pnpm db:migrate`
  then `JARVIS_PGDATABASE=jarv1s_207_rate_limit vitest run tests/integration/chat-mcp-transport.test.ts tests/integration/chat-live-api.test.ts`.
- [ ] **Step 3: Assert no raw credential leakage** in the 429 response body/headers in these tests.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** the integration test files.

### Task 4: Gate

- [ ] Pre-push trio + rebase, then full gate:
  `JARVIS_PGDATABASE=jarv1s_207_rate_limit pnpm verify:foundation`. Hand off to coordinated-wrap-up.

## Self-review

- Spec §Tests unit bullets → Task 1. Integration bullets → Task 3. §Route wiring → Task 2.
  §Acceptance: no unbounded buckets (Task 1+3), valid session per-principal (Task 1+3), valid MCP
  per-session (Task 1+3), no raw creds in keys/logs/responses (Task 1 + Task 3 step 3).
- No placeholders; namespace decision recorded; types/names consistent (`credentialOrIpRateLimitKey`
  policy shape stable across tasks).
