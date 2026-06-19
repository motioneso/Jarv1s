# Spec - OTNR P3 AI gateway residual hardening

**Issue:** #123
**Status:** approved for build planning
**Date:** 2026-06-18

## Goal

Close the live residuals from the OTNR P3 AI Gateway & Provider Security bundle without reopening
items that have already landed. The remaining work is confirmation lifecycle correctness and CLI MCP
token launch hygiene.

## Current State

Already fixed and out of scope for this slice:

- Recalled memory / replay prompt injection was mitigated with prompt-safety escaping.
- `validateToolInput` was replaced with fuller schema validation.
- Gateway tool-result egress now applies output-schema projection and rendered-size caps before
  model/MCP/REST exposure.
- Session tokens have a TTL backstop and activity refresh.
- `chat.extract-facts` is no longer a no-op; it performs provider-routed extraction with an explicit
  output-token cap.
- `GenerateChatInput.maxOutputTokens` is threaded through the HTTP adapter for Anthropic,
  OpenAI-compatible, and Google requests. The remaining Anthropic fallback literal is a default, not
  the missing caller-threading gap from the original finding.
- AI secret current-key guarding moved into the shared `JsonSecretCipher`.
- AI credential typing/guard residuals are tracked separately by #114.

Live residuals:

- `AssistantToolGateway.confirmAndRun` creates the pending row, emits the `action_request`, then calls
  `ConfirmationRegistry.awaitResolution`. A very fast Approve between emit and waiter registration
  can still be dropped.
- Pending `ai_assistant_action_requests` rows survive process restarts with status `pending` even
  though their in-memory waiter can never resume.
- Codex launches with `JARVIS_MCP_TOKEN=<token> codex ...` inline in the multiplexer shell line. That
  token-bearing launch string can appear in process listings, backend diagnostics, or pane history.

## Build Scope

### 1. Register confirmation waiters before notification

Change the confirmed-tool flow so the in-memory waiter is registered before the UI can resolve the
action. A minimal acceptable shape is:

1. Create the pending action-request row.
2. Start `awaitResolution(action.id, timeout)` and keep the promise.
3. Emit the `action_request` notification.
4. Await the previously-created promise.

The confirm-after-timeout guard must remain fail-closed: an Approve after timeout must not execute the
tool or mark the row `confirmed`.

### 2. Reconcile stale pending action requests

Add a startup/recovery path that marks old, unrunnable pending assistant actions as `cancelled` after
a conservative grace window. The implementation can use a repository method, a small SECURITY DEFINER
helper, or another existing DB-owned maintenance path, but it must respect these constraints:

- It must not cancel freshly pending actions from a live wait.
- It must set `resolved_at` and `updated_at` consistently with the existing table check constraint.
- It must preserve RLS/user visibility: users should see stale requests as terminal/cancelled rather
  than forever pending.
- It must be safe to run repeatedly.

Document the restart behavior in the relevant chat/AI operations or module docs.

### 3. Remove MCP bearer tokens from CLI launch command strings

The provider launch path must avoid placing `jst_...` MCP bearer tokens directly in the assembled
shell line passed to the multiplexer.

For Codex, prefer one of these approaches:

- extend the `Multiplexer.open` seam with an environment map and have the backend inject
  `JARVIS_MCP_TOKEN` out-of-band; or
- use a per-session `0600` token/config file if the CLI supports it; or
- use another backend-specific mechanism that keeps the token out of argv/launch strings.

The launch command may still reference a stable variable name such as `JARVIS_MCP_TOKEN`, but it must
not contain the token value.

If the selected mechanism leaves token material on disk, it must be written under the per-user neutral
directory with `0600` permissions and removed when the session is killed/reaped if practical.

### 4. Regression tests

Add focused tests for:

- An Approve immediately after `action_request` emission unblocks and executes; no lost wakeup.
- An Approve after timeout remains non-executing and does not mark the row `confirmed`.
- Stale pending action requests are cancelled by the recovery path while fresh pending rows remain
  pending.
- Codex launch strings and multiplexer backend calls do not include `JARVIS_MCP_TOKEN=jst_` or raw
  `Bearer jst_` token material.
- Existing redaction still catches token-shaped material on error paths.

## Acceptance Criteria

- Confirmed tools cannot lose an Approve between notification and waiter registration.
- Restart/stale pending action requests have a documented, tested terminal cleanup path.
- Codex MCP tokens are no longer embedded directly in multiplexer launch command strings.
- The existing MCP session token TTL/revoke behavior remains intact.
- Existing gateway, MCP transport, and live-chat tests continue to pass.
- `pnpm verify:foundation` passes.

## Non-Goals

- Replacing the full human-confirmation product flow.
- Making confirmation waiters durable across restarts. This slice only cleans up orphaned pending
  rows after restart/grace.
- Rebuilding all provider launch mechanics from scratch.
- Changing tool risk policy or removing the human approval requirement for write/destructive tools.
- Reworking #114 credential type/guard residuals.
