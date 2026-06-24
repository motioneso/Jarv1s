# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Jarv1s app image (ghcr.io/motioneso/jarv1s-api) — deployable-stack §1.
# One multi-stage image runs api / worker / migrate, selected by the container
# command: api = node dist/server.js, worker = node dist/worker.js (bundled, no
# tsx, no per-start install), migrate = tsx scripts/migrate.ts (one-shot; NOT
# bundled because module SQL dirs resolve via import.meta.url — see Task 5).
# ---------------------------------------------------------------------------

# ---- deps: install the full workspace (incl. native binaries) -------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.6.2 --activate
# Copy manifests first for layer caching, then the workspace, then install.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY . .
# onlyBuiltDependencies (onnxruntime-node, sharp) in pnpm-workspace.yaml ensures
# the embedding native binaries are fetched (the worker needs them, §3).
RUN pnpm install --frozen-lockfile

# ---- build: compile resident entrypoints to dist/ -------------------------
FROM deps AS build
WORKDIR /app
RUN pnpm build:api && pnpm build:worker

# ---- runtime: FROM build (full, self-consistent deps incl. tsx + source) ---
# DECISION (Codex R2): we do NOT prune to prod-deps and we do NOT cherry-pick
# tsx/esbuild out of the pnpm store. pnpm lays node_modules out as symlinks into
# .pnpm with transitive deps; copying individual dirs (node_modules/tsx, etc.)
# produces a broken, non-self-consistent tree and `tsx scripts/migrate.ts` fails.
# Instead the runtime IS the build stage with: tmux client added, source pruned to
# what the three roles need, writable mount points, and a non-root user. This keeps
# ONE image for all three roles (api/worker bundled `node dist/...`; migrate
# `tsx scripts/migrate.ts`) with a fully consistent node_modules. The cost is a
# larger image (dev deps included) — an accepted tradeoff for correctness in a
# single-operator household deploy; the bundled dist/ still gives fast api/worker
# startup.
FROM build AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Default cache location for the embedding model weights (§3); the prod Compose
# mounts a named volume here so weights survive restarts.
ENV HF_HOME=/app/.cache/huggingface
# tmux + git (#342 in-container CLI chat): the cli-runner sidecar forks its OWN
# tmux SERVER inside the container and runs the provider CLIs (claude/codex/agy)
# there — no host tmux socket (ADR 0008 reversed by ADR 0010). The same image
# runs api/worker/migrate (which don't use tmux) AND the cli-runner; bundling the
# tmux server here keeps ONE image for every role. git is commonly required by the
# provider CLIs. --no-install-recommends keeps the layer small.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# cli-runner sidecar entrypoint (#342): sets the CLI-tooling env (NPM prefix on
# the tools volume, PATH+=/data/cli-tools/bin, HOME on the auth/home volume) and
# execs the Lane B RPC server. Used ONLY by the cli-runner compose service; the
# api/worker/migrate commands are unaffected.
COPY infra/cli-runner-entrypoint.sh /usr/local/bin/cli-runner-entrypoint.sh
RUN chmod 0755 /usr/local/bin/cli-runner-entrypoint.sh
# Put the installed provider CLIs (tools volume bin) on PATH for the tmux PANE shells
# the cli-runner opens for chat + login (#342). The entrypoint exports PATH for the
# cli-runner PROCESS, but tmux launches each pane as a login shell that re-runs
# /etc/profile and RESETS PATH — so without this snippet a bare `claude`/`codex` in a
# pane is "command not found" (login surfaces no OAuth URL; chat can't launch the CLI).
RUN printf '%s\n' 'export PATH="${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin:$PATH"' \
  > /etc/profile.d/jarvis-cli-path.sh \
  && chmod 0644 /etc/profile.d/jarvis-cli-path.sh
# The full workspace src + node_modules (tsx, esbuild, workspace symlinks) and the
# SQL tree (infra/postgres, packages/*/sql) are ALREADY present from the build
# stage at their real repo-relative paths, so `tsx scripts/migrate.ts` resolves the
# workspace and every module's import.meta.url-relative ../sql correctly. The
# .dockerignore must NOT exclude packages, apps, scripts, or infra/postgres (Task 4).
# Writable mount points for an arbitrary runtime uid (the prod Compose runs as the
# host operator uid, which may differ from the image node uid — High UID finding).
RUN mkdir -p "$HF_HOME" /data/vaults \
  && chown -R node:node /app /data \
  && chmod -R 0777 "$HF_HOME" /data/vaults
USER node
EXPOSE 3000
# Default role is the api; worker overrides `command:`; migrate uses tsx (Compose).
CMD ["node", "dist/server.js"]
