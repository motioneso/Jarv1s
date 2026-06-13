#!/usr/bin/env bash
#
# Reboot-survival check (deployable-stack §8, AC#9). Run AFTER a reboot (or after
# `systemctl start jarv1s-stack`). Asserts two things:
#   1. The stack is healthy: /health/ready returns {ok:true, db:"ok", pgboss:"ok"}.
#   2. The multiplexer bridge is live: when the containerized stack is running we exec
#      `tmux ls` INSIDE the api container (proving the bind-mounted host socket is
#      reachable as the mapped uid — a host-only probe would false-green on a uid/mount
#      bug); otherwise we fall back to a host-side tmux/herdr liveness check.
#
# Exit 0 = survived; non-zero = a component is down (fail loudly, never false-green).
set -euo pipefail

API_PORT="${JARVIS_API_PORT:-3000}"
HEALTH_URL="http://localhost:${API_PORT}/health/ready"
DEADLINE=$(( $(date +%s) + 120 ))

echo "[reboot-survival] waiting for ${HEALTH_URL} ..."
while :; do
  body="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
  if printf '%s' "${body}" | grep -q '"ok":true' \
     && printf '%s' "${body}" | grep -q '"db":"ok"' \
     && printf '%s' "${body}" | grep -q '"pgboss":"ok"'; then
    echo "[reboot-survival] readiness OK: ${body}"
    break
  fi
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "[reboot-survival] FAIL: readiness not green within timeout (last: ${body:-none})" >&2
    exit 1
  fi
  sleep 2
done

# Multiplexer liveness. The honest check is whether the CONTAINER can reach the host
# tmux server through the bind-mounted socket as its mapped uid — a probe of host tmux
# alone passes even when a bad JARVIS_HOST_UID or a broken mount silently breaks CLI
# chat (Codex deploy-code R1 #3). So when the prod stack + compose are available we
# probe FROM INSIDE the api container (`tmux ls` against the bridged socket); only if
# that path is unavailable (e.g. checking a non-containerized host) do we fall back to
# the host-side probe below.
PROD_COMPOSE="infra/docker-compose.prod.yml"
if [ -z "${HERDR_SOCKET_PATH:-}" ] && command -v docker >/dev/null 2>&1 \
   && [ -f "${PROD_COMPOSE}" ] \
   && docker compose -f "${PROD_COMPOSE}" ps --status running --services 2>/dev/null | grep -qx api; then
  echo "[reboot-survival] probing the multiplexer bridge from inside the api container ..."
  # `tmux ls` exits 0 if the server is up (even with no sessions it prints to stderr
  # and exits 1, so also accept the "no server" path by trying to start+kill a probe
  # session — the same logic as the host fallback, but executed IN the container so a
  # uid/mount failure surfaces as a non-zero exec here, never a false green).
  if docker compose -f "${PROD_COMPOSE}" exec -T api sh -c \
       'tmux ls >/dev/null 2>&1 || (tmux new-session -d -s jarv1s-reboot-probe && tmux kill-session -t jarv1s-reboot-probe)' \
       >/dev/null 2>&1; then
    echo "[reboot-survival] PASS: stack healthy + the container can reach the host multiplexer"
    exit 0
  fi
  echo "[reboot-survival] FAIL: api container cannot reach the host tmux socket" \
       "(check JARVIS_HOST_UID/GID + the ${PROD_COMPOSE} socket bind mount)" >&2
  exit 1
fi

# Fallback: host-side multiplexer liveness (used when not running the containerized
# stack, or when herdr is selected). Prefer herdr if its socket is set.
echo "[reboot-survival] probing host multiplexer ..."
if [ -n "${HERDR_SOCKET_PATH:-}" ]; then
  if [ -S "${HERDR_SOCKET_PATH}" ]; then
    echo "[reboot-survival] herdr socket present: ${HERDR_SOCKET_PATH}"
  else
    echo "[reboot-survival] FAIL: HERDR_SOCKET_PATH set but no socket at ${HERDR_SOCKET_PATH}" >&2
    exit 1
  fi
else
  # tmux: `has-session` against any session returns 0 if the server is up; an
  # empty server returns non-zero with "no server running" — distinguish that.
  if tmux ls >/dev/null 2>&1; then
    echo "[reboot-survival] tmux server is live"
  else
    # `tmux ls` non-zero can mean "server up, no sessions" OR "no server". Start a
    # throwaway session to confirm the server can be created, then kill it.
    if tmux new-session -d -s jarv1s-reboot-probe 2>/dev/null; then
      tmux kill-session -t jarv1s-reboot-probe 2>/dev/null || true
      echo "[reboot-survival] tmux server can launch a session"
    else
      echo "[reboot-survival] FAIL: cannot reach or start a tmux server (CLI chat would break)" >&2
      exit 1
    fi
  fi
fi

echo "[reboot-survival] PASS: stack healthy + a chat session can launch"
