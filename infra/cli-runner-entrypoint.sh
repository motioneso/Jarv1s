#!/bin/sh
# ===========================================================================
# Jarv1s cli-runner sidecar entrypoint (#342 in-container CLI chat, Lane C).
#
# The cli-runner is the ISOLATION BOUNDARY: it runs the terminal multiplexer
# (tmux) + the provider CLIs (claude/codex/agy) and the RPC server (Lane B)
# that the api drives over a private 0600 Unix socket. It mounts NONE of the
# app secrets/db/vault — only the tools + auth/home + socket volumes
# (RPC-contract §8). See docs/superpowers/specs/2026-06-20-cli-runner-rpc-contract.md.
#
# This script sets the CLI-tooling environment (npm prefix on the tools volume,
# PATH so installed CLIs resolve, HOME on the auth/home volume) and then execs
# the Lane B RPC server. It is the container `command`/entrypoint for the
# cli-runner compose service; it does NOT alter the api/worker images.
#
# POSIX sh (the image base is node:24-bookworm-slim).
# ===========================================================================
set -eu

# --- CLI tooling environment (RPC-contract §7.1). --------------------------
# Tools volume (jarv1s-cli-tools): npm installs the provider CLIs here so the
# install layer is on a writable named volume, never baked into the image.
JARVIS_CLI_TOOLS_PREFIX="${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}"
export JARVIS_CLI_TOOLS_PREFIX
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$JARVIS_CLI_TOOLS_PREFIX}"

# Auth/home volume (jarv1s-cli-auth): HOME for the CLIs — provider auth
# (~/.claude, ~/.codex, ~/.gemini) + transcripts + per-session neutral dirs.
JARVIS_CLI_HOME="${JARVIS_CLI_HOME:-/data/cli-auth}"
export JARVIS_CLI_HOME
export HOME="$JARVIS_CLI_HOME"
# Transcript base for transcriptGlobDir (tmux-bridge.ts): on cli-runner the CLIs
# write ~/.claude|.codex|.gemini under HOME, so the base equals HOME.
export JARVIS_CLI_HOME_BASE="${JARVIS_CLI_HOME_BASE:-$JARVIS_CLI_HOME}"
# Base under which per-<sessionKey> neutral dirs are derived (RPC-contract §4.1.1a).
export JARVIS_CLI_NEUTRAL_BASE="${JARVIS_CLI_NEUTRAL_BASE:-$JARVIS_CLI_HOME/chat}"

# Resolve installed CLIs from the tools volume's bin dir (PATH+=/data/cli-tools/bin).
case ":${PATH}:" in
  *":${JARVIS_CLI_TOOLS_PREFIX}/bin:"*) : ;;          # already present
  *) export PATH="${PATH}:${JARVIS_CLI_TOOLS_PREFIX}/bin" ;;
esac

# The cli-runner forks its OWN tmux server (no host socket) — the bundled tmux.
export JARVIS_MULTIPLEXER="${JARVIS_MULTIPLEXER:-tmux}"

# Ensure the tooling dirs exist on the named volumes (the root-init service
# chowns them to JARVIS_HOST_UID before this runs; mkdir -p is a harmless no-op
# when they already exist).
mkdir -p "$JARVIS_CLI_TOOLS_PREFIX/bin" "$JARVIS_CLI_HOME" "$JARVIS_CLI_NEUTRAL_BASE" 2>/dev/null || true

# --- launch the Lane B RPC server. -----------------------------------------
# The runtime image is FROM the build stage (full source + tsx + node_modules),
# so the server runs via tsx exactly like the migrate one-shot. Lane B owns the
# server source file; its path is OVERRIDABLE via JARVIS_CLI_RUNNER_ENTRY so a
# Lane B placement choice never breaks this entrypoint. Default is the cli-runner's
# BOOT ENTRY (packages/cli-runner/src/main-entry.ts) — the ONLY side-effecting module
# (it calls main()). main.ts is side-effect-free so it can be bundled into the api
# without booting a second runner (#342 install/login blocker fix).
JARVIS_CLI_RUNNER_ENTRY="${JARVIS_CLI_RUNNER_ENTRY:-packages/cli-runner/src/main-entry.ts}"

exec node_modules/.bin/tsx "$JARVIS_CLI_RUNNER_ENTRY"
