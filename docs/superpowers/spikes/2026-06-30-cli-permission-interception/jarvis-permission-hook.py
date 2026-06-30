#!/usr/bin/env python3
"""Jarvis PreToolUse permission hook (spike prototype).

Single mode-agnostic decision point for Claude native tools (Read/Bash/Write/...).
Fires in BOTH interactive REPL and `claude -p`. Reads the PreToolUse stdin JSON,
fast-path-allows safe read-only vault patterns, else makes a BLOCKING bearer-authed
call into the gateway action_request channel and returns allow/deny.

SAFETY: this hook OWNS its deadline. It always exits 0 with a JSON decision, even on
error/timeout -> fail CLOSED (deny). It must NEVER exit non-zero or print no JSON,
because Claude Code fails OPEN when a PreToolUse hook is killed / errors (verified).
Config `timeout` must be > INTERNAL_DEADLINE_S so Claude never kills it mid-poll.
"""
import json, os, sys, urllib.request, urllib.error

INTERNAL_DEADLINE_S = float(os.environ.get("JARVIS_PERM_DEADLINE_S", "150"))  # == ConfirmationRegistry 150s
GATEWAY = os.environ.get("JARVIS_PERM_URL", "http://127.0.0.1:8799/permission")
TOKEN_FILE = os.environ.get("JARVIS_PERM_TOKEN_FILE", "")  # 0600 file in neutral dir; never on argv

def decide(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,            # "allow" | "deny"
        "permissionDecisionReason": reason}}))
    sys.exit(0)                                    # ALWAYS exit 0 — non-zero = fail OPEN

def safe_read(tool, inp):
    """Fast-path the already-shipped read-only vault allowlist (Part 1) — no network."""
    if tool not in ("Read", "Glob", "Grep"):
        return False
    roots = [r for r in os.environ.get("JARVIS_NOTES_ROOTS", "").split(",") if r]
    path = inp.get("file_path") or inp.get("path") or inp.get("pattern") or ""
    return any(path.startswith(r) for r in roots)

def main():
    try:
        ev = json.load(sys.stdin)
    except Exception:
        decide("deny", "unparseable hook input")   # fail closed
    tool = ev.get("tool_name", "?")
    inp = ev.get("tool_input", {}) or {}
    if safe_read(tool, inp):
        decide("allow", "pre-approved read-only vault path")
    token = ""
    try:
        if TOKEN_FILE:
            with open(TOKEN_FILE) as f: token = f.read().strip()
    except Exception:
        decide("deny", "missing session token")    # fail closed
    payload = json.dumps({"tool_name": tool, "tool_input": inp}).encode()
    req = urllib.request.Request(GATEWAY, data=payload, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=INTERNAL_DEADLINE_S) as r:
            body = json.load(r)
    except Exception as e:
        decide("deny", f"gateway unreachable/timeout: {e.__class__.__name__}")  # fail closed
    decide("allow" if body.get("decision") == "allow" else "deny",
           body.get("reason") or "user decision via action_request card")

if __name__ == "__main__":
    main()
