# Prod CLI Provider Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding production CLI providers such as Codex a repeatable, durable workflow that installs the provider binary, satisfies runtime prerequisites, completes auth, registers model routes, and verifies chat end to end.

**Architecture:** Jarv1s runs provider CLIs in the `cli-runner` sidecar, not inside the repo checkout and not inside the API process. Provider onboarding should flow through the existing install/login/provider-state seams: pinned recipe catalog -> `/data/cli-tools` install -> `/data/cli-auth` login -> `app.provider_install_state` readiness -> `app.ai_configured_models` and `app.instance_settings` routing -> chat verification.

**Tech Stack:** Docker `node:24-bookworm-slim`, Debian runtime packages, Jarv1s production Compose, cli-runner provider install/login RPC, `app.provider_install_state`, `app.ai_provider_configs`, `app.ai_configured_models`, Codex CLI `@openai/codex@0.141.0`.

---

## Context

Prod symptom observed on June 24, 2026:

- A chat test reached prod and persisted.
- The request routed to `openai-compatible` model `gpt-5.5`.
- The assistant response was `Chat timed out before the model finished responding.`
- The `cli-runner` sidecar initially had Claude installed but no `codex` binary.
- Installing Codex through the runner RPC succeeded.
- Codex login then failed because the runtime image had no native root CA bundle.
- After manually installing `ca-certificates` in the live container, `codex login --device-auth` could issue an OpenAI device-auth code.

This proved the permanent fix is broader than “add one model row”: prod provider onboarding needs provider installation, runtime dependencies, auth, database readiness, route configuration, and a verification checklist.

## Files

- Modify: `Dockerfile`
- Create/modify: `docs/superpowers/plans/2026-06-24-prod-cli-provider-onboarding.md`
- No migration files for the current Codex fix.
- No committed files under `/home/ben/JarvisProd`.
- No committed prod env files or secrets.

## Provider Onboarding Checklist

For every new CLI provider, including Codex:

1. Confirm the provider has a pinned install recipe in `packages/cli-runner/src/catalog.ts`.
2. Confirm the runtime image contains OS dependencies needed by that provider.
3. Install the provider into `/data/cli-tools` via the cli-runner install seam.
4. Authenticate the provider into `/data/cli-auth`.
5. Mark `app.provider_install_state` accurately.
6. Register provider model rows in `app.ai_configured_models`.
7. Route capabilities through `app.instance_settings` key `ai.capability_routes`.
8. Verify a chat turn persists and returns a non-timeout assistant response.

## Task 1: Add Runtime Prerequisites For Codex

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add CA certificates to the runtime image**

Change:

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux git \
  && rm -rf /var/lib/apt/lists/*
```

to:

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
```

Reason: Codex's native runtime needs trusted root CAs for OpenAI HTTPS/WebSocket calls and device-auth login. Without this package, `codex doctor` reports `no native root CA certificates found`.

- [ ] **Step 2: Confirm the diff is scoped**

Run:

```bash
git diff -- Dockerfile
```

Expected: the only Dockerfile behavior change is adding `ca-certificates` to the runtime apt install line.

## Task 2: Verify The Runtime Image

**Files:**
- Read: `Dockerfile`

- [ ] **Step 1: Build the runtime image**

Run from repo root:

```bash
docker build --target runtime -t jarv1s-api:ca-cert-test .
```

Expected: exit code `0`.

- [ ] **Step 2: Confirm the CA bundle exists**

Run:

```bash
docker run --rm jarv1s-api:ca-cert-test sh -lc \
  'test -s /etc/ssl/certs/ca-certificates.crt && echo ca-certificates-present'
```

Expected output:

```text
ca-certificates-present
```

## Task 3: Install A CLI Provider In Prod

**Files:**
- Read: `packages/cli-runner/src/catalog.ts`
- Read: `packages/cli-runner/src/install-service.ts`
- Read: `packages/module-registry/src/onboarding-install.ts`

- [ ] **Step 1: Confirm the provider recipe exists**

For Codex, verify `packages/cli-runner/src/catalog.ts` contains an `openai-compatible` recipe with:

```ts
pkg: "@openai/codex",
version: "0.141.0",
binary: "codex"
```

- [ ] **Step 2: Trigger provider install**

Preferred path: use the authenticated onboarding API route from the UI:

```http
POST /api/onboarding/provider-install
Content-Type: application/json

{"providerKind":"openai-compatible"}
```

Emergency operator path, only when UI auth is unavailable and the runner socket secret is already inside the container:

```bash
docker exec jarv1s-cli-runner-prod sh -lc 'command -v codex || true'
```

If absent, use the cli-runner install RPC for `installProvider` with provider `openai-compatible`, then verify:

```bash
docker exec jarv1s-cli-runner-prod sh -lc 'command -v codex; codex --version'
```

Expected output includes:

```text
/data/cli-tools/bin/codex
codex-cli 0.141.0
```

- [ ] **Step 3: Persist install state**

If the API route was used, it should persist state automatically. If the emergency runner RPC path was used, reconcile prod DB manually:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "INSERT INTO app.provider_install_state (provider, state, version, message, updated_at)
   VALUES ('openai-compatible','installed','0.141.0',NULL,now())
   ON CONFLICT (provider) DO UPDATE
   SET state=EXCLUDED.state, version=EXCLUDED.version, message=NULL, updated_at=now();
   SELECT provider, state, version, message, updated_at
   FROM app.provider_install_state
   ORDER BY provider;"
```

Expected: `openai-compatible` shows `installed` until login is complete.

## Task 4: Authenticate The Provider

**Files:**
- Read: `packages/cli-runner/src/login-adapters.ts`
- Read: `packages/chat/src/live/cli-chat-engine.ts`

- [ ] **Step 1: Verify Codex can reach OpenAI auth**

Run:

```bash
docker exec jarv1s-cli-runner-prod sh -lc \
  'test -s /etc/ssl/certs/ca-certificates.crt && timeout 20s codex login --device-auth 2>&1 || true'
```

Expected output includes:

```text
https://auth.openai.com/codex/device
```

and a one-time device code.

- [ ] **Step 2: Complete device auth in a persistent pane**

Run:

```bash
docker exec jarv1s-cli-runner-prod sh -lc \
  'tmux kill-session -t =jarv1s-login-openai-compatible 2>/dev/null || true; tmux new-session -d -s jarv1s-login-openai-compatible "codex login --device-auth"; sleep 2; tmux capture-pane -p -t =jarv1s-login-openai-compatible: -S -80'
```

The operator opens `https://auth.openai.com/codex/device` and enters the displayed one-time code before it expires. Do not commit, log, or paste secrets into repo files.

- [ ] **Step 3: Verify login status**

Run:

```bash
docker exec jarv1s-cli-runner-prod sh -lc 'codex login status; echo rc:$?'
```

Expected:

- Codex reports logged in.
- `rc:0`.

- [ ] **Step 4: Mark provider ready**

Run:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "UPDATE app.provider_install_state
   SET state='ready', version='0.141.0', message=NULL, updated_at=now()
   WHERE provider='openai-compatible';
   SELECT provider, state, version, message, updated_at
   FROM app.provider_install_state
   ORDER BY provider;"
```

Expected: `openai-compatible` shows `ready`.

## Task 5: Register Models And Capability Routes

**Files:**
- Read: `packages/ai/src/auto-register.ts`
- Read: `packages/ai/src/routes.ts`
- Prod DB only for the manual backfill.

- [ ] **Step 1: Confirm the active provider config**

Run:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "SELECT id, provider_kind, display_name, status, auth_method
   FROM app.ai_provider_configs
   WHERE provider_kind='openai-compatible'
   ORDER BY created_at DESC;"
```

Expected: one active OpenAI-compatible provider is selected for model rows.

- [ ] **Step 2: Insert known Codex/OpenAI model names**

Use the active provider config id. For the current prod setup, the intended model ids are:

```text
default
gpt-5.5
gpt-5.5-pro
gpt-5.4
gpt-5.4-pro
gpt-5.4-mini
gpt-5.4-nano
```

Insert rows into `app.ai_configured_models` with `status='active'`, appropriate chat/tool capabilities, and `provider_config_id` pointing to the active OpenAI-compatible provider.

- [ ] **Step 3: Route capabilities to the intended model**

Set `app.instance_settings.key='ai.capability_routes'` so chat and related capabilities point to the selected Codex model row, for example `gpt-5.5`.

- [ ] **Step 4: Verify routes**

Run:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "SELECT key, value
   FROM app.instance_settings
   WHERE key='ai.capability_routes';
   SELECT m.id, p.display_name, m.provider_model_id, m.status
   FROM app.ai_configured_models m
   JOIN app.ai_provider_configs p ON p.id=m.provider_config_id
   WHERE p.provider_kind='openai-compatible'
   ORDER BY m.provider_model_id;"
```

Expected:

- Capability routes reference existing active model ids.
- The OpenAI-compatible provider has active rows for the configured model names.

## Task 6: Verify Chat End To End

**Files:**
- No repo files.
- Prod runtime only.

- [ ] **Step 1: Check service health**

Run:

```bash
cd /home/ben/JarvisProd
curl -fsS http://localhost:3000/health/ready
```

Expected output:

```json
{"ok":true,"db":"ok","pgboss":"ok"}
```

- [ ] **Step 2: Send a chat message through the UI**

Open the Jarv1s web UI and send a short message.

Expected: the assistant returns a non-timeout response.

- [ ] **Step 3: Confirm the persisted turn used the configured provider**

Run:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "SELECT role, left(body, 160) AS body, model_metadata, created_at
   FROM app.chat_messages
   WHERE created_at > now() - interval '20 minutes'
   ORDER BY created_at DESC
   LIMIT 10;"
```

Expected:

- The recent user message is present.
- The assistant message is not `Chat timed out before the model finished responding.`
- Assistant `model_metadata` shows `provider` as `openai-compatible`.

## Task 7: Commit And PR

**Files:**
- Commit: `Dockerfile`
- Commit: `docs/superpowers/plans/2026-06-24-prod-cli-provider-onboarding.md`

- [ ] **Step 1: Run final status check**

Run:

```bash
git status --short
```

Expected:

```text
 M Dockerfile
?? docs/superpowers/plans/2026-06-24-prod-cli-provider-onboarding.md
```

- [ ] **Step 2: Commit scoped files**

Run:

```bash
git add Dockerfile docs/superpowers/plans/2026-06-24-prod-cli-provider-onboarding.md
git commit -m "fix(prod): document CLI provider onboarding"
```

- [ ] **Step 3: Push and open PR**

Run:

```bash
git push -u origin fix/prod-cli-ca-certificates
gh pr create \
  --base main \
  --head fix/prod-cli-ca-certificates \
  --title "fix(prod): support Codex provider onboarding" \
  --body "## Summary
- add Debian ca-certificates to the production runtime image for Codex/OpenAI HTTPS auth
- document the repeatable prod CLI provider onboarding flow
- cover provider install, login, model registration, route setup, and chat verification

## Verification
- docker build --target runtime -t jarv1s-api:ca-cert-test .
- docker run --rm jarv1s-api:ca-cert-test sh -lc 'test -s /etc/ssl/certs/ca-certificates.crt && echo ca-certificates-present'

## Notes
- Live prod was hotfixed by installing ca-certificates inside jarv1s-cli-runner-prod, but this PR makes that runtime prerequisite durable.
- Codex still requires operator device auth before OpenAI-compatible chat can return non-timeout responses."
```

Expected: GitHub opens a PR against `main`.

## Self-Review

- Spec coverage: this covers adding a CLI provider such as Codex from install recipe through runtime dependencies, auth, install state, model rows, capability routing, and chat verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified verification remains.
- Type and path consistency: provider names use the existing `openai-compatible` literal; prod-only commands stay under `/home/ben/JarvisProd`; committed files are limited to `Dockerfile` and this plan.
