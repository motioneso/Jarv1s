# Prod Codex Provider Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add Codex/OpenAI-compatible as a production chat provider through Jarv1s without manual container surgery, DB backfills, trust-prompt interaction, or broken UI rendering when SSE is unavailable.

**Architecture:** Codex is a CLI-backed provider that runs only inside the `cli-runner` sidecar. The product flow must wire together the existing provider install/login seams, pre-seed Codex runtime state under `/data/cli-auth`, register usable model rows for capability routing, and make the chat UI render the completed `POST /api/chat/turn` response even if `/api/chat/stream` cannot connect.

**Tech Stack:** Docker `node:24-bookworm-slim`, Debian runtime packages, cli-runner install/login RPC, Codex CLI `@openai/codex@0.141.0`, Codex config TOML at `$HOME/.codex/config.toml`, `app.provider_install_state`, `app.ai_provider_configs`, `app.ai_configured_models`, React chat drawer.

---

## Production Findings That Drive This Plan

Observed on June 24, 2026 while enabling Codex in `/home/ben/JarvisProd`:

- Chat requests reached the API and persisted, but timed out while Codex was not installed or not launch-ready.
- The active route correctly selected `openai-compatible` / `gpt-5.5`, so routing was not the root cause.
- `cli-runner` had Claude installed but no `codex` binary until `installProvider(openai-compatible)` was invoked.
- Codex install succeeded once the install RPC was called.
- Codex auth initially failed because the production runtime image lacked root CA certificates.
- `codex login --device-auth` worked after installing `ca-certificates`; the default `codex login` flow used a localhost callback and is wrong for a remote/headless container.
- After auth, the first Jarv1s chat still blocked on Codex’s directory trust prompt for `/data/cli-auth/chat/<actorUserId>`.
- After trust was recorded under `$HOME/.codex/config.toml`, chat completed through Codex.
- Firefox could not establish the SSE connection to `/api/chat/stream`; the backend stored the reply, but the UI did not render it until a POST-response fallback was added.
- The fallback initially duplicated records when SSE did work; visible fallback records must be deduped against live stream records.

## Invariants

- Do not commit prod env files, auth files, tokens, or anything under `/home/ben/JarvisProd`.
- Runtime app/worker roles must not gain access to CLI auth/tool volumes; `cli-runner` remains the provider CLI boundary.
- Provider recipes stay pinned and lockfile-backed. No `latest`, no floating install.
- Codex credentials live only under `/data/cli-auth/.codex` inside the cli-runner auth volume.
- Model rows and capability routes must point to active provider/model ids; no orphan route ids.
- The UI should prefer SSE records when available and use POST response records only as a fallback.

## Files

- Modify: `Dockerfile`
- Modify: `packages/cli-runner/src/login-adapters.ts`
- Modify: `packages/cli-runner/src/provider-first-run.ts`
- Modify: `packages/cli-runner/src/provider-first-run.test.ts` or create a focused unit test beside the existing cli-runner tests.
- Modify: `packages/ai/src/auto-register.ts`
- Modify: `packages/ai/src/auto-register.test.ts` or create a focused unit test beside existing AI tests.
- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Add/modify: focused unit tests for chat fallback/dedupe if practical; otherwise cover with existing `pnpm typecheck` and `pnpm build:web`.
- Modify: `docs/superpowers/plans/2026-06-24-prod-codex-provider-onboarding.md`

## Task 1: Ship Codex Runtime Prerequisites In The Image

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add OS packages required for Codex**

Change the runtime apt install layer to include root CAs. Also consider adding `bubblewrap` so Codex does not fall back to its bundled sandbox helper.

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux git ca-certificates bubblewrap \
  && rm -rf /var/lib/apt/lists/*
```

If `bubblewrap` adds unacceptable image weight or capability friction, keep `ca-certificates` as required and document why bundled bubblewrap is acceptable. `ca-certificates` is non-negotiable: without it, Codex auth/model calls fail with `no native root CA certificates found`.

- [ ] **Step 2: Verify the built image has the CA bundle**

Run:

```bash
docker build --target runtime -t jarv1s-api:codex-runtime-test .
docker run --rm jarv1s-api:codex-runtime-test sh -lc \
  'test -s /etc/ssl/certs/ca-certificates.crt && echo ca-certificates-present'
```

Expected:

```text
ca-certificates-present
```

- [ ] **Step 3: Verify the CLI runner still boots**

Run the existing prod/smoke compose path appropriate for the branch, then verify:

```bash
curl -fsS http://localhost:3000/health/ready
```

Expected:

```json
{"ok":true,"db":"ok","pgboss":"ok"}
```

## Task 2: Make Codex Login Use Device Auth

**Files:**
- Modify: `packages/cli-runner/src/login-adapters.ts`

- [ ] **Step 1: Change the OpenAI-compatible login adapter**

Update the `openai-compatible` adapter from:

```ts
loginArgv: ["codex", "login"],
```

to:

```ts
loginArgv: ["codex", "login", "--device-auth"],
```

Reason: `codex login` starts a localhost callback flow (`http://localhost:1455`) that cannot be reached from the operator’s browser when Codex runs in the remote/headless `cli-runner` container. `--device-auth` prints `https://auth.openai.com/codex/device` plus a one-time code, which is the correct operator flow.

- [ ] **Step 2: Update login adapter tests**

Add or update a test asserting:

```ts
expect(LOGIN_ADAPTERS["openai-compatible"]?.loginArgv).toEqual([
  "codex",
  "login",
  "--device-auth"
]);
```

Run the relevant cli-runner/login test file.

## Task 3: Parse Codex Device-Auth Surface Correctly

**Files:**
- Modify: `packages/cli-runner/src/login-adapters.ts`
- Test: login adapter parser tests

- [ ] **Step 1: Confirm the URL allowlist covers device auth**

Ensure `CODEX_AUTH_URLS` allows:

```ts
{ host: "auth.openai.com", pathPrefix: "/codex/device" }
```

Keep the existing `/authorize` and `/oauth` entries only if tests prove they are still needed.

- [ ] **Step 2: Tighten the user-code parser**

Codex device codes observed in prod look like:

```text
4DUN-GY7Y3
```

Add a provider-specific code pattern for Codex:

```ts
const CODEX_DEVICE_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{5}$/;
```

Use it for `openai-compatible` instead of the broad generic token pattern. This prevents incidental words like `Starting` from being treated as user codes.

- [ ] **Step 3: Add parser tests**

Test with representative pane output:

```text
Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device

2. Enter this one-time code (expires in 15 minutes)
   4DUN-GY7Y3
```

Expected:

```ts
expect(surface).toEqual({
  authorizationUrl: "https://auth.openai.com/codex/device",
  userCode: "4DUN-GY7Y3"
});
```

Also add a regression where `Starting` appears in output and is not returned as `userCode`.

## Task 4: Pre-Seed Codex Trust For Jarv1s Neutral Chat Directories

**Files:**
- Modify: `packages/cli-runner/src/provider-first-run.ts`
- Test: `packages/cli-runner/src/provider-first-run.test.ts` or equivalent

- [ ] **Step 1: Add Codex first-run setup**

Extend `ensureProviderLaunchReady(homeBase, provider, neutralDir)` so `openai-compatible` writes a trusted-project entry before launch:

```toml
[projects."/data/cli-auth/chat/<actorUserId>"]
trust_level = "trusted"
```

This must be idempotent. A second launch for the same neutral dir must not duplicate TOML sections.

- [ ] **Step 2: Preserve existing Codex config**

The installer already writes:

```toml
check_for_update_on_startup = false
```

The trust writer must preserve existing top-level keys and other `[projects.*]` sections. Use a small TOML-aware helper if one already exists; otherwise implement a narrow line-based helper that:

- reads `$homeBase/.codex/config.toml` if present,
- appends the exact project section only when absent,
- creates parent directories with `0700`,
- writes the config with `0600` permissions.

- [ ] **Step 3: Add tests**

Add tests for:

- creates `.codex/config.toml` when missing,
- appends a trusted project while preserving `check_for_update_on_startup = false`,
- does not duplicate the same project section on repeated calls,
- does nothing for unsupported/no-op providers except existing Claude behavior.

- [ ] **Step 4: Verify live behavior**

After deploying the change, launch a Codex chat session and capture the pane:

```bash
docker exec jarv1s-cli-runner-prod sh -lc \
  'tmux capture-pane -p -t =jarv1s-live-<actorUserId>: -S -120'
```

Expected: no `Do you trust the contents of this directory?` prompt appears.

## Task 5: Register Codex Models Automatically

**Files:**
- Modify: `packages/ai/src/auto-register.ts`
- Test: AI auto-register tests

- [ ] **Step 1: Define Codex/OpenAI-compatible default model set**

The current manual prod rows were:

```text
default
gpt-5.5
gpt-5.5-pro
gpt-5.4
gpt-5.4-pro
gpt-5.4-mini
gpt-5.4-nano
```

Add a code-owned model seed for CLI-backed `openai-compatible` providers. Keep `default` as the sentinel that omits `--model`; make `gpt-5.5` the preferred explicit chat route while the user’s account supports it.

- [ ] **Step 2: Insert rows idempotently**

On provider creation or provider-ready transition, ensure `app.ai_configured_models` contains active rows for the configured Codex model ids for that provider config. The operation must be idempotent and must not resurrect revoked providers.

Expected row shape:

- `provider_config_id`: active OpenAI-compatible provider config id
- `provider_model_id`: one of the model ids above
- `display_name`: human-readable model name
- `capabilities`: includes at least `chat`; include `tool-use`, `json`, `summarization`, and `vision` only if the existing capability schema supports those assignments
- `status`: `active`
- `tier`: match existing model-tier conventions
- `allow_user_override`: match existing default model behavior

- [ ] **Step 3: Route chat to an existing row**

If no `ai.capability_routes.chat` exists, or it points to a missing/inactive model, set it to the preferred active Codex model row. Do not overwrite a valid existing user/admin route unless the onboarding flow explicitly asks to make Codex the default.

- [ ] **Step 4: Add tests**

Add tests that:

- creating/readying an OpenAI-compatible CLI provider creates the model rows,
- running the seeder twice creates no duplicates,
- a valid existing route is preserved,
- an orphan route is repaired to an active model id.

## Task 6: Surface Install/Login/Ready State In The UI

**Files:**
- Inspect/modify: `apps/web/src/onboarding/provider-connect-machine.ts`
- Inspect/modify: `apps/web/src/onboarding/cli-auth-step.tsx`
- Inspect/modify: `apps/web/src/api/onboarding-connect-client.ts`

- [ ] **Step 1: Confirm install route is available from UI**

The UI should call:

```http
POST /api/onboarding/provider-install
{"providerKind":"openai-compatible"}
```

and then show `installed` / `needs_login` / `ready` based on `app.provider_install_state`.

- [ ] **Step 2: Confirm login flow displays device auth**

For Codex, the UI should display:

- authorization URL: `https://auth.openai.com/codex/device`
- user code: the device code from the login adapter
- polling status until `ready`

The UI must not display raw auth tokens, refresh tokens, or auth JSON.

- [ ] **Step 3: Add a user-facing retry path**

If device auth expires or login returns `error`, the UI should let the user restart login without reinstalling Codex.

## Task 7: Render Chat Replies When SSE Is Unavailable

**Files:**
- Modify: `apps/web/src/chat/chat-drawer.tsx`
- Test: existing web/unit tests or a new focused component/helper test

- [ ] **Step 1: Keep the POST-response fallback**

`ChatDrawer` must render the successful `sendChatTurn()` response locally:

```ts
const postResponseRecords: readonly TranscriptRecord[] = [
  { kind: "user", text: trimmed },
  { kind: "reply", text: result.reply }
];
```

This is required because Firefox can fail to connect to:

```text
http://<host>:5173/api/chat/stream
```

while `POST /api/chat/turn` still completes and persists the reply.

- [ ] **Step 2: Dedupe fallback records against SSE records**

Visible fallback records must be filtered against current stream records:

```ts
function sameTranscriptRecord(a: TranscriptRecord, b: TranscriptRecord): boolean {
  return a.kind === b.kind && a.text === b.text;
}
```

Expected behavior:

- If SSE is down: one user bubble and one assistant bubble appear from the POST response.
- If SSE is up: no duplicate user or assistant records appear.
- If SSE arrives before POST resolves: fallback records are not displayed.
- If POST resolves before SSE arrives: fallback records display immediately and disappear once equivalent SSE records arrive.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm exec prettier --check apps/web/src/chat/chat-drawer.tsx
pnpm typecheck
pnpm build:web
```

Expected: all pass.

## Task 8: Add Operational Verification Commands

**Files:**
- Modify: this plan or add a short runbook under `docs/operations/`

- [ ] **Step 1: Codex install verification**

```bash
docker exec jarv1s-cli-runner-prod sh -lc 'HOME=/data/cli-auth command -v codex; HOME=/data/cli-auth codex --version'
```

Expected:

```text
/data/cli-tools/bin/codex
codex-cli 0.141.0
```

- [ ] **Step 2: Codex auth verification**

```bash
docker exec jarv1s-cli-runner-prod sh -lc 'HOME=/data/cli-auth codex login status; echo rc:$?'
```

Expected:

```text
Logged in using ChatGPT
rc:0
```

- [ ] **Step 3: Codex model-call verification**

```bash
docker exec jarv1s-cli-runner-prod sh -lc \
  'HOME=/data/cli-auth timeout 60s codex exec --skip-git-repo-check -s read-only -m gpt-5.5 "Reply with exactly OK."'
```

Expected: Codex returns `OK`.

- [ ] **Step 4: Jarv1s chat verification**

Send a UI chat and verify:

```bash
docker exec jarv1s-postgres-prod psql -U postgres -d jarv1s -c \
  "SELECT role, left(body, 160) AS body, model_metadata, created_at
   FROM app.chat_messages
   WHERE created_at > now() - interval '20 minutes'
   ORDER BY created_at DESC
   LIMIT 10;"
```

Expected:

- one user row,
- one assistant row,
- assistant row is not `Chat timed out before the model finished responding.`,
- assistant `model_metadata.executed.provider` is `openai-compatible`,
- assistant `model_metadata.executed.model` is the routed Codex model.

## Task 9: Full Verification Gate

Run the focused checks first:

```bash
pnpm exec prettier --check Dockerfile packages/cli-runner/src/login-adapters.ts packages/cli-runner/src/provider-first-run.ts packages/ai/src/auto-register.ts apps/web/src/chat/chat-drawer.tsx
pnpm typecheck
pnpm build:web
```

Run focused tests added by this plan:

```bash
pnpm exec vitest run <login-adapter-test-file> <provider-first-run-test-file> <ai-auto-register-test-file>
```

Before merge, run the repo gate if time/resources allow:

```bash
pnpm verify:foundation
```

Expected: focused checks pass before PR; full gate passes before merge unless a known unrelated environment blocker is documented.

## Task 10: PR Shape

Commit in focused slices:

1. `fix(prod): add Codex runtime prerequisites`
2. `fix(cli-runner): use Codex device auth`
3. `fix(cli-runner): pretrust Codex chat directories`
4. `fix(ai): seed Codex chat models`
5. `fix(chat): render POST reply when stream is unavailable`
6. `docs(prod): document Codex provider onboarding`

PR body should include:

```markdown
## Summary
- make Codex install/login work through the product flow
- add required runtime prerequisites for Codex/OpenAI HTTPS
- pre-seed Codex trust for Jarv1s neutral chat dirs
- seed Codex model rows and safe capability routing
- render chat replies from POST responses when SSE is unavailable

## Verification
- pnpm typecheck
- pnpm build:web
- focused Vitest files for login adapter / provider first-run / AI model seeding
- docker build --target runtime -t jarv1s-api:codex-runtime-test .
- docker run --rm jarv1s-api:codex-runtime-test sh -lc 'test -s /etc/ssl/certs/ca-certificates.crt && echo ca-certificates-present'

## Prod Notes
- No prod secrets or env files are committed.
- Codex auth remains an operator device-auth step, but it is launched and tracked by Jarv1s.
```

## Acceptance Criteria

- A user/admin can add OpenAI-compatible/Codex from the UI without shelling into the container.
- Provider install state progresses through install/login to `ready`.
- Codex login uses device auth, not localhost callback auth.
- Codex model rows are present without manual SQL.
- Chat capability route points to an active model row.
- First Codex chat launch does not show a trust prompt.
- A Codex-backed chat turn persists and renders in the UI.
- If `/api/chat/stream` fails, the UI still displays the POST response.
- If `/api/chat/stream` works, no duplicate fallback records are shown.

## Self-Review

- Spec coverage: covers every prod issue observed: missing Codex binary, missing CA bundle, wrong login flow, auth state, trust prompt, manual model rows, capability routing, SSE UI failure, duplicate fallback records.
- Placeholder scan: no `TBD`, `TODO`, or unspecified verification remains.
- Type/path consistency: provider literal is `openai-compatible`; Codex home is `/data/cli-auth/.codex`; neutral chat dirs are `/data/cli-auth/chat/<actorUserId>`; committed files stay in repo, prod-only commands stay operational examples.
