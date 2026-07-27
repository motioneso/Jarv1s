#!/usr/bin/env bash
# PreToolUse(Bash) guard: refuse to run a verification gate whose exit code is masked by a pipe.
#
# Why this exists: a shell pipeline reports the exit status of the LAST command, so
# `pnpm verify:foundation | tail -20` exits 0 even when every test failed. An agent then reads
# exit 0, reports "gate green" in good faith, and the defect merges.
#
# Measured 2026-07-27 over three weeks of transcripts: of 1,560 gate runs in this repo, 824 were
# piped to tail/head and only 142 of those set pipefail — so 682 runs (44% of all gate runs)
# could not have reported a failure. See the `verification-discipline` agent memory.
#
# Contract: stdin is the PreToolUse JSON payload. Exit 0 allows the call; exit 2 blocks it and
# sends stderr back to the model as the reason.
set -uo pipefail

payload=$(cat)

# jq is present in this repo's toolchain, but never hard-fail the hook on a missing dependency:
# a broken guard must not block every Bash call in the session.
command -v jq > /dev/null 2>&1 || exit 0

tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2> /dev/null)
[ "$tool" = "Bash" ] || exit 0

cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2> /dev/null)
[ -n "$cmd" ] || exit 0

# Explicit opt-outs. Either construct makes the pipeline report the real failure, so the
# command is safe and the author has clearly thought about it.
case "$cmd" in
  *pipefail* | *PIPESTATUS*) exit 0 ;;
esac

# Neutralise `||` before scanning, so boolean OR is never mistaken for a pipe.
scan=${cmd//\|\|/ @@OR@@ }

# Match: a package-runner gate invocation, followed later on the same command by a real pipe.
# A pipe BEFORE the gate is fine (`echo x | pnpm test` still reports pnpm's status), which is
# why the gate token has to appear first in the pattern.
gate_re='(pnpm|npm|turbo)[[:space:]]+(run[[:space:]]+)?[a-z0-9:_-]*(verify|test|lint|typecheck|format|build|check|audit)[a-z0-9:_-]*[^|]*\|'

if printf '%s' "$scan" | grep -qE "$gate_re"; then
  cat >&2 <<'MSG'
BLOCKED: this pipes a verification gate into another command, which masks its exit code.

A pipeline reports the LAST command's status, so `pnpm verify:foundation | tail -20` exits 0
even when the gate failed. Exit 0 here does not mean green.

Run it so the real status survives:

    pnpm verify:foundation > /tmp/vf.log 2>&1; echo "EXIT=$?"

then read the exit code, then read the log. If you genuinely need the pipe, put
`set -o pipefail;` in front of it, or test ${PIPESTATUS[0]} instead of $?.
MSG
  exit 2
fi

exit 0
