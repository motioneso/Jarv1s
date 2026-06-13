#!/usr/bin/env bash
#
# Reboot-survival check (deployable-stack §8, AC#9). Run AFTER a reboot (or after
# `systemctl start jarv1s-stack`). Asserts two things:
#   1. The stack is healthy: /health/ready returns {ok:true, db:"ok", pgboss:"ok"}.
#   2. A chat session can launch against the host multiplexer: the bridged tmux
#      (or herdr) server is reachable.
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

# Multiplexer liveness: the host tmux/herdr server must be reachable so a chat
# session can launch (the bridge in §6). Prefer herdr if its socket is set.
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
