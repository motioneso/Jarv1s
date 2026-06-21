# Plan — v0.1.4 deploy fixes (MCP gateway URL + Google-done status refresh)

Branch `v014-deploy-fixes` off main `7d4896e`. Tier: sensitive (F1 touches MCP gateway URL source).
Handoff: `docs/coordination/handoffs/2026-06-21-v014-deploy-fixes.md`. Plan PRE-APPROVED by Ben (both fixes); coordinator gates the plan.

## Fix 1 — MCP gateway URL honored from env (container CLI gets tools)

Root cause confirmed: `apps/api/src/server.ts` `resolveApiServerConfig()` (lines 79-87) HARDCODES
`mcpServerUrl: http://127.0.0.1:${port}/api/mcp` and never reads `JARVIS_MCP_SERVER_URL`. In the container
deploy the CLI runs in the separate `cli-runner` container, so `127.0.0.1:3000` is itself → MCP gateway
unreachable → zero Jarvis tools. The compose env `JARVIS_MCP_SERVER_URL` (default `http://api:3000/api/mcp`)
exists but is set only on `cli-runner`, NOT `api`, AND the config never reads it.

### Task 1.1 (TDD) — `resolveApiServerConfig` honors `JARVIS_MCP_SERVER_URL`
- Test first: `tests/unit/api-server-config.test.ts` (new). Import `resolveApiServerConfig` from
  `apps/api/src/server.js`. Cases:
  1. env sets `JARVIS_MCP_SERVER_URL=http://api:3000/api/mcp` → config.mcpServerUrl equals it (PORT ignored).
  2. env unset → fallback `http://127.0.0.1:${PORT}/api/mcp` (assert with a custom PORT, e.g. 4100, to prove
     the loopback default is preserved for dev/non-container runs).
  - Pass an explicit `env` object to `resolveApiServerConfig(env)` (already parameterized — no global stubbing).
- Impl: line 85 →
  `mcpServerUrl: env.JARVIS_MCP_SERVER_URL ?? \`http://127.0.0.1:${port}/api/mcp\``.
- Do NOT touch host/port resolution or the MCP gateway auth/allowlist/token-mint path. URL source only.

### Task 1.2 — compose: add `JARVIS_MCP_SERVER_URL` to the `api` service
- `infra/docker-compose.prod.yml` `api.environment` (currently lines 187-197): add
  `JARVIS_MCP_SERVER_URL: ${JARVIS_MCP_SERVER_URL:-http://api:3000/api/mcp}` with a short comment that the
  api now forwards this to the CLI launch (the cli-runner container resolves `api` via compose DNS).
- Leave it on `cli-runner` (line 290) unchanged. Worker does NOT compose chat/MCP (no chat engine, no MCP
  route registration in worker.ts) → not added to worker. Non-code change, no separate test (compose isn't
  unit-tested; correctness is the env-honoring test in 1.1 + the literal compose value).

## Fix 2 — Google connect success refreshes onboarding status (recap stops saying "skipped")

Root cause confirmed: `connectors.done ⇔ a connector account exists`
(`packages/settings/src/repository.ts:713`). The Google completeMutation onSuccess
(`apps/web/src/connectors/use-google-connect-flow.ts:48`) invalidates ONLY `queryKeys.connectors.accounts`,
never `queryKeys.onboarding.status`, so `founderSteps.connectors.done` stays stale-false and the Finish
recap (`onboarding-wizard.tsx:392`) shows "skipped." Revoke path (`google-connector-step.tsx:56`) has the
same gap but recap correctness on connect is the reported bug.

No DOM/renderHook test environment in this repo (root suite uses `react-dom/server` renderToString only).
So extract the invalidation key set into a pure exported helper and unit-test the helper — same
"extract pure logic, test without DOM" idiom the repo already uses.

### Task 2.1 (TDD) — pure helper for the connect-success invalidation keys
- Test first: `tests/unit/google-connect-invalidation.test.ts` (new). Import the new helper from
  `apps/web/src/connectors/use-google-connect-flow.js`. Assert the returned key list contains BOTH
  `queryKeys.connectors.accounts` AND `queryKeys.onboarding.status` (so a successful connect refreshes the
  status the recap reads). Guards against regressing back to accounts-only.
- Impl: add `export const GOOGLE_CONNECT_SUCCESS_QUERY_KEYS = [queryKeys.connectors.accounts,
  queryKeys.onboarding.status] as const;` and in completeMutation.onSuccess invalidate each key in that list
  (replacing the single `connectors.accounts` invalidation). Keep behavior identical otherwise (clears
  fields, fires `onConnected`).

### Task 2.2 — apply the same refresh on revoke (cheap, in-scope correctness)
- `google-connector-step.tsx:56` revoke onSuccess: also invalidate `queryKeys.onboarding.status` (reuse no
  helper needed — single extra key) so disconnecting the last account flips `connectors.done` back to false
  consistently. If the coordinator considers this out-of-scope vs the reported bug, drop it — the required
  fix is 2.1. (Flagging, not deciding.)

## Gate + finish
- `pnpm verify:foundation` full gate, REAL exit code (capture VF_EXIT). DB `JARVIS_PGDATABASE=jarvis_qa_v014`.
- Pre-push trio (`format:check && lint && typecheck`) + fresh rebase on origin/main.
- `coordinated-wrap-up`: push `v014-deploy-fixes`, open PR (title/body per handoff), report PR# + head SHA +
  VF_EXIT + files to coordinator. No board/milestone/merge.

## Invariants honored
- F1 does NOT weaken MCP auth/allowlist/token-mint — only the URL source; loopback default preserved for dev.
- No secrets in logs/payloads/prompts. `@jarv1s/shared` untouched. `git add` explicit paths only (shared tree).
- Co-Authored-By: Claude Opus 4.8.
