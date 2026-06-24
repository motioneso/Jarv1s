#!/usr/bin/env bash
# ===========================================================================
# Jarv1s install.sh — one-command host-side deploy launcher.
#
# The "hand this to someone else" entrypoint. The operator runs ONE command;
# this script derives the real host vars (uid/gid, HOME, multiplexer, CLI dirs),
# generates every boot secret via the in-container setup service, launches the
# prod stack, waits for readiness, and opens the onboarding URL. The host needs
# ONLY Docker — no node, no repo checkout when a published image is used.
#
# Requires bash. Uses bash arrays (COMPOSE_FILES) for multi -f compose assembly;
# install already requires Docker, so bash is a safe assumption on the host.
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
# Steps: (1) preflight, (2) detect host vars, (3) generate secrets + record host
# CLIs, (4) launch, (5) wait for /health/ready, (6) open onboarding URL.
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
SUBNET="${JARVIS_DOCKER_SUBNET:-}"      # empty ⇒ auto-pick a free /24 in preflight
EMBED="${JARVIS_EMBED_PROVIDER:-local}"
BUILD_MODE="${JARVIS_BUILD:-auto}"      # auto | 1 | 0
API_IMAGE="ghcr.io/motioneso/jarv1s-api:${TAG}"
WEB_IMAGE="ghcr.io/motioneso/jarv1s-web:${TAG}"

# ---- public origin for better-auth trusted-origins (#379) -----------------
# A real deploy is reached over LAN/tailnet/domain, not localhost — better-auth rejects signup
# with "Invalid origin" otherwise. This script runs on the HOST, which can see the real LAN IP
# (the in-container `setup` service cannot), so detect it here and pass it into setup, which
# merges it into JARVIS_AUTH_TRUSTED_ORIGINS. An explicit JARVIS_PUBLIC_ORIGIN wins: a full
# origin (https://host or http://host:port) is used as-is; a bare host/IP becomes
# http://<host>:<WEB_PORT>. Detection failure is non-fatal (falls back to localhost-only).
detect_lan_ip() {
  # Primary: the source address the kernel would use to reach the internet (no traffic sent).
  ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1
}
PUBLIC_ORIGIN=""
if [ -n "${JARVIS_PUBLIC_ORIGIN:-}" ]; then
  case "$JARVIS_PUBLIC_ORIGIN" in
    *://*) PUBLIC_ORIGIN="$JARVIS_PUBLIC_ORIGIN" ;;          # full origin — use as-is
    *)     PUBLIC_ORIGIN="http://${JARVIS_PUBLIC_ORIGIN}:${WEB_PORT}" ;;  # bare host/IP
  esac
else
  _lan_ip="$(detect_lan_ip)"
  # Fallback: first non-loopback address from `hostname -I`.
  [ -z "$_lan_ip" ] && _lan_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | head -n1)"
  [ -n "$_lan_ip" ] && PUBLIC_ORIGIN="http://${_lan_ip}:${WEB_PORT}"
fi

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
# COMPOSE_FILES is the -f argument list for real compose invocations (build /
# setup run / up). Starts as just the base file; docker-compose.notes.yml is
# appended when NOTES_VAULT_HOST_PATH is set (probe below). The bare basename
# form matches COMPOSE_NAME — install.sh cd'd into COMPOSE_DIR at line 79, so
# -f resolution is relative to CWD. Never used in echo/log strings (those keep
# $COMPOSE_NAME for readability).
COMPOSE_FILES=(-f "$COMPOSE_NAME")
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

# Notes Source host-folder bind mount (#449). Optional. When set, the host vault
# directory is bind-mounted into the api + worker containers at a fixed neutral
# path /data/external-notes (via docker-compose.notes.yml, -f'd in below). Empty
# or unset = no mount = the notes feature is inert. The app reads the mount via
# JARVIS_NOTES_ROOTS=/data/external-notes, derived by setup-prod.ts from this var
# so the operator names only the host path. Read-only in v1 (ingest); :rw is
# reserved for write-back (slice #2).
NOTES_VAULT_HOST_PATH="${JARVIS_NOTES_VAULT_HOST_PATH:-}"
if [ -n "$NOTES_VAULT_HOST_PATH" ]; then
  note "notes source host path: ${NOTES_VAULT_HOST_PATH} (bind-mounted to /data/external-notes)"
  # Append the override as a bare basename (sibling of the base file in CWD).
  COMPOSE_FILES+=(-f "docker-compose.notes.yml")
fi

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

# CLIs: warn (do not fail) — the onboarding wizard tests them live. Accumulate the
# detected binary set so it can be declared via JARVIS_HOST_CLIS. NOTE (#342): the
# host CLI dirs are no longer mounted into the stack (the cli-runner sidecar owns
# the CLIs + their auth); this declaration is RETAINED only so onboarding still
# reports provider presence until the sidecar PATH-probe path lands (Phase 4).
FOUND_CLI=0
HOST_CLIS=""
for cli in claude codex gemini agy; do
  if command -v "$cli" >/dev/null 2>&1; then
    FOUND_CLI=1
    if [ -n "$HOST_CLIS" ]; then
      HOST_CLIS="${HOST_CLIS},${cli}"
    else
      HOST_CLIS="$cli"
    fi
  fi
done
if [ "$FOUND_CLI" = "0" ]; then
  warn "no provider CLI found (claude/codex/gemini). Install at least one and run its"
  warn "login (e.g. 'claude login'); the onboarding wizard tests each live."
else
  note "provider CLI(s) present on host PATH: ${HOST_CLIS}"
fi

# ---- 1a. resolve a non-colliding docker subnet ----------------------------
# Docker refuses to create a network whose /24 overlaps an existing pool ("Pool
# overlaps with other one on this address space"). When the operator did NOT pin
# JARVIS_DOCKER_SUBNET, auto-pick the first free /24 from a 10.24x/10.25x candidate
# range so a second stack on a busy host just works; if they DID pin one that
# collides, warn (their choice — the real bind error would otherwise surface late).
USED_SUBNETS=$(docker network ls -q 2>/dev/null | while read -r _nid; do
  docker network inspect "$_nid" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null
done)
subnet_collides() {  # $1 = candidate CIDR; collides if a used subnet shares its 10.N.M space
  _two=$(printf '%s' "$1" | cut -d. -f1-2)   # "10.251.0.0/24" -> "10.251"
  for _u in $USED_SUBNETS; do
    case "$_u" in "${_two}".*) return 0 ;; esac
  done
  return 1
}
if [ -n "$SUBNET" ]; then
  if subnet_collides "$SUBNET"; then
    warn "JARVIS_DOCKER_SUBNET=${SUBNET} overlaps an existing docker network — 'up' may fail"
    warn "with 'Pool overlaps...'. Unset it to auto-pick, or choose a free /24."
  fi
else
  for _o in 251 252 253 254 255 240 241 242 243 244; do
    _cand="10.${_o}.0.0/24"
    if ! subnet_collides "$_cand"; then SUBNET="$_cand"; break; fi
  done
  [ -n "$SUBNET" ] || die "no free /24 found in 10.24x/10.25x — set JARVIS_DOCKER_SUBNET to a free range."
  note "auto-selected docker subnet ${SUBNET} (override with JARVIS_DOCKER_SUBNET)"
fi
# EXPORT so Compose ${JARVIS_DOCKER_SUBNET} INTERPOLATION uses the resolved value when the
# `setup` run creates the network (the env file does not exist yet, and `-e` to the setup
# container does NOT feed interpolation). Without this an auto-picked subnet silently falls
# back to the compose default and collides.
export JARVIS_DOCKER_SUBNET="$SUBNET"

# ---- 2. detect host vars (recorded into env file in step 3c) --------------
# NOTE (#342): the host-multiplexer bridge is GONE — the provider CLIs + tmux now
# run in the cli-runner SIDECAR (ADR 0008 reversed by ADR 0010). So install.sh no
# longer records the host CLI dirs / chat home / tmux socket dir (those mounts were
# removed from the prod Compose). The JARVIS_HOST_CLIS declaration is RETAINED for
# now (its removal is deferred to Phase 4, once the sidecar PATH-probe path exists
# so onboarding still reports provider presence).
log "Detect host configuration"
note "api/web ports: ${API_PORT}/${WEB_PORT}  subnet: ${SUBNET}  tag: ${TAG}  project: ${PROJECT}"

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
  POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup JARVIS_IMAGE_TAG="$TAG" \
    docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" build api web \
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
if [ -n "$PUBLIC_ORIGIN" ]; then
  note "trusted sign-in origin: ${PUBLIC_ORIGIN} (override with JARVIS_PUBLIC_ORIGIN)"
else
  warn "no host LAN IP detected — sign-in trusted for localhost only. Set JARVIS_PUBLIC_ORIGIN to add your host."
fi
FIRST_RUN=0
# POSTGRES_PASSWORD=setup AND JARVIS_CLI_RUNNER_RPC_SECRET=setup are throwaways
# scoped to THIS command only: Compose interpolates the WHOLE file at parse time
# (incl. the api/cli-runner ${JARVIS_CLI_RUNNER_RPC_SECRET:?} fail-closed gate), so
# the setup run needs placeholder values to parse. setup IGNORES them and writes the
# REAL generated values into env.production.local; the later `up` reads those.
# JARVIS_PUBLIC_ORIGIN (the host LAN origin, #379) is passed so setup merges it into
# JARVIS_AUTH_TRUSTED_ORIGINS — empty is fine (setup falls back to localhost-only).
if POSTGRES_PASSWORD=setup JARVIS_CLI_RUNNER_RPC_SECRET=setup JARVIS_IMAGE_TAG="$TAG" \
  docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" --profile setup run --rm \
    -e JARVIS_HOST_UID="$HOST_UID" -e JARVIS_HOST_GID="$HOST_GID" \
    -e JARVIS_API_PORT="$API_PORT" -e JARVIS_WEB_PORT="$WEB_PORT" \
    -e JARVIS_DOCKER_SUBNET="$SUBNET" -e JARVIS_EMBED_PROVIDER="$EMBED" \
    -e JARVIS_PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
    -e JARVIS_IMAGE_TAG="$TAG" \
    -e JARVIS_NOTES_VAULT_HOST_PATH="$NOTES_VAULT_HOST_PATH" setup; then
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

# ---- 3c. record host-detected extras (first run only) ---------------------
# setup-prod.ts writes a FIXED key set (secrets + uid/gid + ports + subnet +
# JARVIS_MULTIPLEXER=tmux + the cli-runner RPC socket/secret/gate + embed). The
# host-bridge paths (CLI dirs / chat home / tmux socket dir) are NO LONGER written
# (#342: the CLIs run in the cli-runner sidecar, not via host mounts). We append
# ONLY the host-CLI declaration (JARVIS_HOST_CLIS), retained until Phase 4.
if [ "$FIRST_RUN" = "1" ]; then
  log "Record host-detected provider CLIs into ${ENV_FILE}"
  {
    printf '\n# --- host-detected extras (appended by install.sh) ---\n'
    printf '# Host multiplexer detected by install.sh: %s (the cli-runner sidecar uses tmux).\n' "$HOST_MUX"
    printf '# Host provider CLIs detected on PATH. RETAINED for onboarding provider\n'
    printf '# detection until the sidecar PATH-probe path lands (Phase 4). Empty = none.\n'
    printf 'JARVIS_HOST_CLIS=%s\n' "$HOST_CLIS"
  } >> "$ENV_FILE"
  note "appended host-detected provider CLIs"
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
docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" up $UP_FLAGS \
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
