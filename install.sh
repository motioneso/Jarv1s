#!/bin/sh
# ===========================================================================
# Jarv1s install.sh — one-command host-side deploy launcher.
#
# The "hand this to someone else" entrypoint. The operator runs ONE command;
# this script derives the real host vars (uid/gid, HOME, multiplexer, CLI dirs),
# generates every boot secret via the in-container setup service, launches the
# prod stack, waits for readiness, and opens the onboarding URL. The host needs
# ONLY Docker — no node, no repo checkout when a published image is used.
#
# POSIX sh (dash/ash/bash-as-sh): no bashisms, no node required on the host.
#
# Override via env: JARVIS_IMAGE_TAG, JARVIS_PROJECT, JARVIS_API_PORT,
# JARVIS_WEB_PORT, JARVIS_DOCKER_SUBNET, JARVIS_EMBED_PROVIDER, JARVIS_BUILD
# (auto|1|0; auto builds only if the image is absent locally).
#
# It finds the prod compose as ./docker-compose.prod.yml (clean deploy dir, the
# "hand-off" case) or ./infra/docker-compose.prod.yml (repo root). It runs from
# the compose file's directory so env.production.local + the setup bind-mount
# (`.`) + `--env-file ./env.production.local` all land in the same place.
#
# Steps: (1) preflight, (2) detect host vars, (3) generate secrets + record
# bridge paths, (4) launch, (5) wait for /health/ready, (6) open onboarding URL.
# ===========================================================================
set -u

# ---- helpers --------------------------------------------------------------
log()  { printf '\n\033[1m>> %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
warn() { printf '\033[33m   ! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m   x %s\033[0m\n' "$*" >&2; exit 1; }

# ---- defaults (env-overridable) -------------------------------------------
TAG="${JARVIS_IMAGE_TAG:-local}"
PROJECT="${JARVIS_PROJECT:-jarv1s-prod}"
API_PORT="${JARVIS_API_PORT:-3000}"
WEB_PORT="${JARVIS_WEB_PORT:-5173}"
SUBNET="${JARVIS_DOCKER_SUBNET:-10.251.0.0/24}"
EMBED="${JARVIS_EMBED_PROVIDER:-local}"
BUILD_MODE="${JARVIS_BUILD:-auto}"      # auto | 1 | 0
API_IMAGE="ghcr.io/motioneso/jarv1s-api:${TAG}"
WEB_IMAGE="ghcr.io/motioneso/jarv1s-web:${TAG}"

# ---- locate the prod compose (clean deploy dir OR repo root) --------------
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE=""
for c in "./docker-compose.prod.yml" "${SCRIPT_DIR}/docker-compose.prod.yml" "${SCRIPT_DIR}/infra/docker-compose.prod.yml"; do
  if [ -f "$c" ]; then
    COMPOSE_FILE=$(CDPATH= cd -- "$(dirname -- "$c")" && pwd)/$(basename -- "$c")
    break
  fi
done
[ -n "$COMPOSE_FILE" ] || die "docker-compose.prod.yml not found next to install.sh, or at infra/docker-compose.prod.yml."
COMPOSE_DIR=$(dirname -- "$COMPOSE_FILE")
cd "$COMPOSE_DIR" || die "cannot enter $COMPOSE_DIR"
COMPOSE_NAME=$(basename -- "$COMPOSE_FILE")   # now relative to CWD
ENV_FILE="${COMPOSE_DIR}/env.production.local"

# ---- 1. preflight ---------------------------------------------------------
log "Preflight"
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Engine: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose v2 (the 'docker compose' subcommand) not found. Install the compose plugin."
note "docker: $(docker version --format '{{.Client.Version}}' 2>/dev/null || echo ok)"
note "compose: $(docker compose version --short 2>/dev/null || echo ok)"

HOST_UID=$(id -u)
HOST_GID=$(id -g)
[ -n "${HOME:-}" ] || die "HOME is unset; cannot derive host CLI dirs."
note "host uid/gid: ${HOST_UID}/${HOST_GID}  HOME=${HOME}"

# Multiplexer preflight. The container bridge ships ONLY the tmux client, so the
# env file pins JARVIS_MULTIPLEXER=tmux (written by setup); this probe is a host
# sanity check + informational note (the onboarding wizard reports live state).
HAS_HERDR=0
HAS_TMUX=0
if { [ -n "${HERDR_SOCKET_PATH:-}" ] && [ -S "${HERDR_SOCKET_PATH}" ]; } || command -v herdr >/dev/null 2>&1; then
  HAS_HERDR=1
fi
command -v tmux >/dev/null 2>&1 && HAS_TMUX=1
HOST_MUX="none"
if [ "$HAS_HERDR" = "1" ]; then HOST_MUX="herdr"; elif [ "$HAS_TMUX" = "1" ]; then HOST_MUX="tmux"; fi
if [ "$HOST_MUX" = "none" ]; then
  warn "no terminal multiplexer found (neither tmux nor herdr). One is required for"
  warn "the CLI chat bridge — install tmux (or herdr), or the onboarding wizard will"
  warn "report chat as unavailable. Continuing."
else
  note "host multiplexer: ${HOST_MUX}"
fi

# CLIs: warn (do not fail) — the onboarding wizard tests them live.
FOUND_CLI=0
for cli in claude codex gemini agy; do
  command -v "$cli" >/dev/null 2>&1 && FOUND_CLI=1
done
if [ "$FOUND_CLI" = "0" ]; then
  warn "no provider CLI found (claude/codex/gemini). Install at least one and run its"
  warn "login (e.g. 'claude login'); the onboarding wizard tests each live."
else
  note "provider CLI(s) present on host PATH"
fi

# ---- 2. detect host vars (recorded into env file in step 3c) --------------
log "Detect host configuration"
CLAUDE_DIR="${HOME}/.claude"
CODEX_DIR="${HOME}/.codex"
GEMINI_DIR="${HOME}/.gemini"
CHAT_HOME="${HOME}/.jarvis/chat"
TMUX_SOCKET_DIR="/tmp/tmux-${HOST_UID}"
note "api/web ports: ${API_PORT}/${WEB_PORT}  subnet: ${SUBNET}  tag: ${TAG}  project: ${PROJECT}"
note "tmux socket dir: ${TMUX_SOCKET_DIR}"

# ---- 3a. ensure image availability (build only if absent + source present) -
log "Resolve image ${API_IMAGE}"
need_build=0
if [ "$BUILD_MODE" = "1" ]; then
  need_build=1
elif [ "$BUILD_MODE" = "0" ]; then
  need_build=0
elif docker image inspect "$API_IMAGE" >/dev/null 2>&1 && docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
  need_build=0
  note "image present locally — reusing it (no build)"
else
  # Not local + auto mode. If a source tree is present, build it; otherwise
  # PULL the published image from the registry (the distribution path — no repo
  # checkout needed, just the deploy bundle + a published tag).
  if [ -f "../Dockerfile" ] && [ -f "../apps/web/Dockerfile" ]; then
    need_build=1
  else
    note "image not local and no source tree — pulling ${API_IMAGE} (+ ${WEB_IMAGE}) from registry..."
    if docker pull "$API_IMAGE" && docker pull "$WEB_IMAGE"; then
      need_build=0
      note "pulled — using published image (no build)"
    else
      die "could not pull ${API_IMAGE} / ${WEB_IMAGE}. Verify 'docker login ghcr.io' (a read:packages PAT for private images), JARVIS_IMAGE_TAG (=${TAG}), and registry reachability. To build instead, run install.sh from a repo checkout."
    fi
  fi
fi
if [ "$need_build" = "1" ]; then
  note "building api + web images locally (source present)..."
  POSTGRES_PASSWORD=setup JARVIS_IMAGE_TAG="$TAG" \
    docker compose -p "$PROJECT" -f "$COMPOSE_NAME" build api web \
    || die "image build failed. Run from the repo root, or pre-build / pull the image."
fi

# ---- 3b. generate boot secrets via the in-container setup service ---------
# POSTGRES_PASSWORD=setup is scoped to THIS command only (it satisfies the
# ${POSTGRES_PASSWORD:?} parse-time gate; setup ignores it and writes the real
# generated password). It is deliberately NOT exported globally, so the later
# `up` reads the REAL password from --env-file env.production.local.
# -e VAR=VALUE passes the detected host vars INTO the setup container so the
# generated env file records the real uid/gid/ports/embed/tag/subnet.
log "Generate boot secrets (in-container setup service)"
FIRST_RUN=0
if POSTGRES_PASSWORD=setup JARVIS_IMAGE_TAG="$TAG" \
  docker compose -p "$PROJECT" -f "$COMPOSE_NAME" --profile setup run --rm \
    -e JARVIS_HOST_UID="$HOST_UID" -e JARVIS_HOST_GID="$HOST_GID" \
    -e JARVIS_API_PORT="$API_PORT" -e JARVIS_WEB_PORT="$WEB_PORT" \
    -e JARVIS_DOCKER_SUBNET="$SUBNET" -e JARVIS_EMBED_PROVIDER="$EMBED" \
    -e JARVIS_IMAGE_TAG="$TAG" setup; then
  FIRST_RUN=1
  note "wrote ${ENV_FILE} (mode 0600) with generated boot secrets"
else
  setup_rc=$?
  if [ -f "$ENV_FILE" ]; then
    note "${ENV_FILE} already exists — setup refused to overwrite (idempotent). Keeping existing config."
  else
    die "setup service failed (exit ${setup_rc}). See output above."
  fi
fi

# ---- 3c. record host-bridge paths (first run only) ------------------------
# setup-prod.ts writes a FIXED key set (secrets + uid/gid + ports + subnet +
# JARVIS_MULTIPLEXER=tmux + embed). It does NOT write the CLI dirs / chat home
# / tmux socket dir, so we append ONLY those — no duplicate keys. After this the
# env file is fully self-contained: a later `up` needs no host re-detection.
if [ "$FIRST_RUN" = "1" ]; then
  log "Record host-bridge paths into ${ENV_FILE}"
  {
    printf '\n# --- host-bridge paths (appended by install.sh) ---\n'
    printf '# Host CLI-config dirs (mount-only, read-only inside the container).\n'
    printf 'JARVIS_HOST_CLAUDE_DIR=%s\n' "$CLAUDE_DIR"
    printf 'JARVIS_HOST_CODEX_DIR=%s\n' "$CODEX_DIR"
    printf 'JARVIS_HOST_GEMINI_DIR=%s\n' "$GEMINI_DIR"
    printf '# Neutral chat dir — identical absolute path on host and container.\n'
    printf 'JARVIS_CHAT_HOME=%s\n' "$CHAT_HOME"
    printf '# Host per-uid tmux socket dir (container bridge execs tmux against it).\n'
    printf 'JARVIS_TMUX_SOCKET_DIR=%s\n' "$TMUX_SOCKET_DIR"
    printf '# Host multiplexer detected by install.sh: %s (container bridge uses tmux).\n' "$HOST_MUX"
  } >> "$ENV_FILE"
  note "appended host-bridge paths"
fi

# ---- 4. launch ------------------------------------------------------------
log "Launch stack (project=${PROJECT})"
[ -f "$ENV_FILE" ] || die "missing ${ENV_FILE} — setup should have created it above."
UP_FLAGS="-d"
if [ "$need_build" = "1" ]; then
  UP_FLAGS="-d --build"
fi
# --env-file feeds Compose INTERPOLATION (POSTGRES_PASSWORD, ports, subnet,
# bridge vars) AND the services' `env_file:` loads the same file at runtime.
docker compose -p "$PROJECT" -f "$COMPOSE_NAME" --env-file "$ENV_FILE" up $UP_FLAGS \
  || die "docker compose up failed. Inspect: docker compose -p ${PROJECT} -f ${COMPOSE_NAME} --env-file ${ENV_FILE} logs"
note "stack started"

# ---- 5. wait for readiness (cap 120s) -------------------------------------
get_health() {
  url="http://localhost:${API_PORT}/health/ready"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$url" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url" >/dev/null 2>&1
  else
    docker compose -p "$PROJECT" -f "$COMPOSE_NAME" exec -T api \
      node -e "fetch('http://localhost:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
  fi
}

log "Wait for api readiness (http://localhost:${API_PORT}/health/ready)"
ready=0
deadline=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if get_health; then ready=1; break; fi
  sleep 2
done
if [ "$ready" = "1" ]; then
  note "api ready"
else
  warn "api did not report /health/ready within 120s. Inspect logs:"
  warn "  docker compose -p ${PROJECT} -f ${COMPOSE_NAME} --env-file ${ENV_FILE} logs api"
fi

# ---- 6. open the onboarding URL (headless-safe) ---------------------------
ONBOARDING_URL="http://localhost:${WEB_PORT}"
printf '\n\033[1m>> Jarv1s is up: %s\033[0m\n' "$ONBOARDING_URL"
opened=0
if [ -t 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "$ONBOARDING_URL" >/dev/null 2>&1 && opened=1
  elif command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    xdg-open "$ONBOARDING_URL" >/dev/null 2>&1 && opened=1
  fi
fi
if [ "$opened" = "0" ]; then
  note "(no GUI opener / non-interactive shell — open the URL manually)"
fi
note "The onboarding wizard runs in the web UI on first sign-in."
exit 0
