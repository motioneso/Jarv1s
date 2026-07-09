# On-demand Herdr install and mux-aware attach hint (#866)

**Status:** Approved — RFA after AGY/Fable review fixes and Ben approval  
**Date:** 2026-07-08  
**Issue:** #866  
**Grounded on:** `~/Jarv1s/apps/web/src/settings/settings-admin-panes.tsx`,
`~/Jarv1s/packages/settings/src/routes.ts`,
`~/Jarv1s/packages/settings/src/host-diagnostics.ts`,
`~/Jarv1s/packages/settings/src/runtime-config-keys.ts`,
`~/Jarv1s/packages/ai/src/adapters/multiplexer-resolve.ts`,
`~/Jarv1s/packages/module-registry/src/chat-multiplexer.ts`, and
`~/Jarv1s/infra/docker-compose.prod.yml`.

## Problem

The production image currently forces `JARVIS_MULTIPLEXER=tmux`, and the Host Runtime pane says chat
sessions run in tmux with a hardcoded `docker compose exec jarv1s tmux ...` attach command.

Herdr support exists in the multiplexer resolver, but Herdr is not bundled in the base image. An
operator who wants the richer Herdr pane experience needs a safe way to install it, and the UI needs
to stop hardcoding tmux once Herdr may be present.

## Decision

Do not let the web app install Herdr.

Admin/owner power in Jarv1s is configuration power, not host mutation. A web-triggered endpoint that
downloads a binary, marks it executable, and drops it into a persistent PATH is too much power for
the API process. Instead, Settings should detect Herdr availability and show a pinned, copy/paste
host-level install command or script path for the infrastructure operator to run outside Jarv1s.

The UI does not override runtime mux precedence. If `JARVIS_MULTIPLEXER=tmux` is set, tmux remains
the active runtime multiplexer until deployment configuration changes. The UI must say that plainly.

## Design

### Host-level install guidance

Add no install route and no job.

Settings may show a fixed command or script reference for operators, for example:

```txt
docker compose exec jarv1s /app/scripts/install-herdr.sh
```

The script, if added, must be reviewed like normal repo code:

- pinned Herdr release artifact URL;
- pinned SHA-256 checksum;
- per-architecture artifact selection using `uname -m`, with a pinned URL and SHA-256 pair for each
  supported architecture;
- no arguments required for the common path;
- no `curl | sh`;
- installs to `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr`;
- idempotent if the pinned version is already installed.

Running that script is an operator action, not an API action.

### Availability and Runtime Selection

Keep the existing mux precedence from `multiplexer-resolve.ts`:

1. `JARVIS_MULTIPLEXER` env override wins.
2. Admin setting is honored only if the selected binary is usable.
3. `auto` probes installed multiplexers.

After the operator installs Herdr, `GET /api/admin/chat-multiplexer` should reflect Herdr
availability on the next fetch. Herdr is usable only when the binary exists and a root pane is configured
(`JARVIS_HERDR_ROOT_PANE` or `HERDR_PANE_ID`), matching the existing resolver.

If the production compose file still sets `JARVIS_MULTIPLEXER=tmux`, selecting Herdr in the UI must
not imply active runtime use. The control should show a short env-override note.

### Attach Hint

Replace the hardcoded tmux note in `HostPane` with mux-aware copy.

- Active tmux: keep the current `docker compose exec jarv1s tmux ls` and attach command.
- Active Herdr: show Herdr-specific list/read/attach guidance using `docker compose exec jarv1s herdr
pane list` as the discovery command.
- Env override present: show the override source so operators understand why the selected setting may
  not match active runtime behavior.
- Herdr installed but not usable: show that a root pane is required.

## Non-goals

- No bundled Herdr in the base image.
- No marketplace/plugin installer.
- No web API route that downloads, writes, chmods, or executes a binary.
- No live migration of existing chat sessions between tmux and Herdr.
- No attempt to change `JARVIS_MULTIPLEXER` from the web UI.

## Acceptance Criteria

- No Jarv1s API endpoint can trigger Herdr installation.
- Settings shows Herdr availability and clear host-level install guidance when Herdr is absent.
- Any repo-provided install script uses per-architecture pinned release artifacts and verifies the
  matching SHA-256 before installing.
- Re-running the host-level install script is safe and does not corrupt an existing binary.
- Installation persists across container replacement when installed into the existing CLI tools
  volume.
- Multiplexer availability refreshes after installation.
- The Host Runtime pane renders attach guidance for the active mux instead of hardcoding tmux.
- If env override pins tmux, the UI does not claim Herdr is active just because it is installed.
- `pnpm verify:foundation` passes for the implementation PR.
