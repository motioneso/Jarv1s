# Host Diagnostics Safe Ops

**Status:** Approved
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #255

## Goal

Replace the Advanced host setup placeholders with useful, safe operational diagnostics.

## Current State

Settings -> Admin -> Advanced host setup already has real multiplexer controls:

- `GET /api/admin/chat-multiplexer`
- `PUT /api/admin/chat-multiplexer`
- Host availability for `tmux` and `herdr`

The remaining host controls are placeholders:

- Verbose logging
- Restart-required settings
- Restart server
- Run diagnostics

## Scope

Build the safe first slice:

- `GET /api/admin/host/diagnostics`
  - Admin-only.
  - Returns safe runtime metadata:
    - app/API uptime;
    - configured host/port;
    - current multiplexer choice and availability;
    - database connectivity check;
    - pg-boss connectivity/status check if cheaply available;
    - active module route-registration summary;
    - environment mode and version/commit if available.
  - Never returns environment variable values, DB URLs, secrets, tokens, file paths containing user
    data, or raw stack traces.
- UI "Run diagnostics"
  - Calls the diagnostics route.
  - Shows pass/warn/fail rows with short safe messages.
  - Keeps the existing advanced-gate.
- Verbose logging
  - Prefer documenting/configuring via env or instance setting readout first.
  - If runtime toggling is implemented, make it admin-only, bounded, and explicit about whether it
    survives restart.

## Restart Policy

Do not ship a blind in-process "restart server" button as V1.

Restart is deployment-specific:

- Docker Compose wants the supervisor/container to restart the process.
- systemd wants `systemctl restart`.
- local dev wants the operator terminal.

For V1, the UI may show "Restart required" and link/copy the documented operator command for the
detected deployment mode if that mode is safely knowable. A real restart endpoint is only acceptable
when the host has an explicit configured restart command or supervisor integration, with:

- admin-only access;
- confirmation;
- audit event;
- no arbitrary command input from the UI;
- graceful shutdown path;
- clear response that the request was accepted, not proof that restart completed.

## Guardrails

- Diagnostics are read-only.
- Admin-only for diagnostics and any future restart/logging mutation.
- No secret/env dumping.
- No raw process environment in responses.
- No shell command execution for diagnostics unless each check is fixed and audited.
- Keep outputs small and structured.

## Out Of Scope

- Full log viewer.
- Arbitrary command runner.
- Restart implementation without an approved supervisor/config path.
- Metrics/observability stack.

## Verification

- Integration: non-admin receives 403 for diagnostics.
- Integration: admin diagnostics returns safe fields and DB connectivity status.
- Unit: sanitizer/serializer cannot include known secret env keys or connection URLs.
- UI/manual: advanced host pane runs diagnostics and renders pass/warn/fail rows.
- Manual: restart placeholder no longer claims restart is wired unless a supervisor-backed endpoint
  exists.

## Acceptance Criteria

- Admins can run safe host diagnostics from the advanced pane.
- Diagnostics help debug host setup without exposing secrets.
- Restart remains honest: either supervisor-backed and audited, or clearly operator-managed.
- `pnpm verify:foundation` passes.
