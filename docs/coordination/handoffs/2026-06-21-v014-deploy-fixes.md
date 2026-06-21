# Build Handoff — v0.1.4 deploy fixes (MCP tools + Google-done status)

**Goal:** fix two bugs found in the v0.1.3 live deploy test. Branch `v014-deploy-fixes` off main `7d4896e`. Tier: **sensitive** (F1 touches the MCP gateway URL/token wiring). Build to that bar.
**Coordinator:** label `Coordinator`, session `11d3e71c-5d93-4983-8b63-6a0d266c28ab` (escalate via herdr-pane-message; re-resolve the live pane by label each time). Invoke `coordinated-build`. Plan PRE-APPROVED (Ben signed off both fixes). Caveman mode to the coordinator.

## Setup

`git fetch origin main && git checkout -b v014-deploy-fixes origin/main` (HEAD `7d4896e`). `[ -d node_modules ] || pnpm install`. JARVIS_PGDATABASE=jarvis_qa_v014 for DB tests.

## Fix 1 — MCP gateway unreachable from the CLI in the container deploy (Jarvis has NO tools)

**Root cause (confirmed live):** `apps/api/src/server.ts` `resolveApiServerConfig()` HARDCODES `mcpServerUrl: http://127.0.0.1:${port}/api/mcp` and ignores `JARVIS_MCP_SERVER_URL`. The api passes that loopback URL to the CLI launch (via the cli-runner RPC params). In the container deploy the CLI runs in the **separate `cli-runner` container**, where `127.0.0.1:3000` is itself — so the launched Claude can't reach the MCP gateway → it loads zero Jarvis tools → "Ask Jarvis to confirm setup" returns a generic MCP-debugging answer. `JARVIS_MCP_SERVER_URL` (compose default `http://api:3000/api/mcp`) exists for exactly this but is only set on the `cli-runner` service, NOT `api`, AND `resolveApiServerConfig` never reads it.

**Fix (both halves needed):**

1. `apps/api/src/server.ts` `resolveApiServerConfig`: read the env with the loopback as fallback —
   `mcpServerUrl: env.JARVIS_MCP_SERVER_URL ?? \`http://127.0.0.1:${port}/api/mcp\``. Keep the dev/loopback default so non-container runs are unchanged.
2. `infra/docker-compose.prod.yml`: add `JARVIS_MCP_SERVER_URL: ${JARVIS_MCP_SERVER_URL:-http://api:3000/api/mcp}` to the **`api`** service env (it's currently only on `cli-runner` ~line 290). Add to `worker` too IF the worker composes chat/MCP (check; likely not needed). Do NOT remove it from `cli-runner`.

**Verify:** with the env set, the api hands the CLI `http://api:3000/api/mcp` (the compose service DNS), the gateway connects, Jarvis tools load. Add a unit test that `resolveApiServerConfig` honors `JARVIS_MCP_SERVER_URL` and falls back to loopback when unset. Do NOT change the MCP gateway auth/allowlist/token-mint path — only the URL source.

## Fix 2 — Google connects but onboarding says "skipped"

**Root cause (confirmed):** `connectors.done` ⇔ a connector account exists (`packages/settings/src/repository.ts` assembler ~line 713). The Google connect flow on success invalidates ONLY `queryKeys.connectors.accounts` (`apps/web/src/connectors/use-google-connect-flow.ts` ~line 48 + `apps/web/src/onboarding/google-connector-step.tsx` ~line 56) — it never invalidates `queryKeys.onboarding.status`. So `founderSteps.connectors.done` stays stale-false after a successful connect, and the Finish recap (`apps/web/src/onboarding/onboarding-wizard.tsx:392` `skippedSteps.has("connectors") || !founderSteps?.connectors.done`) shows "skipped." Ben: "it connected but said it wasn't."

**Fix:** on Google-connect success, ALSO invalidate `queryKeys.onboarding.status` (alongside `connectors.accounts`) so `connectors.done` refreshes to true and the recap is correct. Do it where the connect success handler lives (use-google-connect-flow.ts and/or google-connector-step.tsx — wherever the `connectors.accounts` invalidation is). Same class as #369 B1 (UI not refreshing the status the recap reads).

Optional defense (only if cheap): the recap conflating "not done" with "skipped" is latent for a genuinely-not-connected step — but the actual bug is the stale status; the status-invalidation fix is the required one. Don't over-scope.

**Verify:** add a web unit test that the Google-connect success path invalidates the onboarding-status query key (so the Finish recap would re-read `connectors.done`).

## Constraints

Honor all CLAUDE.md Hard Invariants. No secrets in logs/payloads/prompts. `@jarv1s/shared` no `node:*`. `git add` only your own changed files (never `git add -A` — shared tree). Co-Authored-By your real model. Remove dead vocabulary in the same pass.

## Gate + finish

FULL local gate, REAL exit codes (`pnpm verify:foundation`, capture VF_EXIT; CI unavailable, don't trust it; DB jarvis_qa_v014). Fresh rebase on origin/main before push. Push `v014-deploy-fixes`, open a PR (title `fix: v0.1.4 deploy — MCP gateway URL for container CLI + onboarding-status refresh on Google connect`, body with both root causes + VF_EXIT + SHA). Report PR# + evidence to the coordinator. Do NOT touch board/milestones/merge.
