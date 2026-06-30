# Prototype — cross-mode native-tool permission interception (#635)

Working prototype for the spike findings note
([`../2026-06-30-cli-permission-interception.md`](../2026-06-30-cli-permission-interception.md)).
Demonstrates a `PreToolUse` hook intercepting Claude native tools and routing the decision
through a bearer-authed `action_request`-style channel, in **both** interactive REPL and
`claude -p` modes, with fail-closed-on-timeout.

Standard library only (Python 3). Nothing here touches the Jarvis app — it is a
self-contained demonstration of the mechanism.

## Files

| File                        | Role                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jarvis-permission-hook.py` | The `PreToolUse` hook. Reads the hook stdin JSON, fast-path-allows safe read-only vault paths, else makes a blocking bearer-authed call to the gateway. **Always `exit 0`; denies on every error/timeout (fail-closed).** This is the production-shaped artifact. |
| `mock_gateway.py`           | Stand-in for the Jarvis gateway `action_request` channel: bearer-authed, blocks like `ConfirmationRegistry.awaitResolution()` (150s, fail-closed), `/resolve` = the human clicking the card.                                                                      |
| `demo.py`                   | Deterministic, no-network-leak driver: runs the hook through allow / deny / 3× fail-closed paths in one process.                                                                                                                                                  |

## 1. Deterministic demo (no Claude, no cost)

```sh
python3 demo.py
```

Expected (all `exit 0`):

```
B) Bash, user APPROVES                     -> decision=allow exit=0 (0.1s)
C) Bash, user REJECTS                      -> decision=deny  exit=0 (0.1s)
D) gateway never resolves (self-deadline)  -> decision=deny  exit=0 (2.1s)   <- fail-closed
E) gateway DOWN / unreachable              -> decision=deny  exit=0 (0.1s)   <- fail-closed
F) empty/forged token -> 401               -> decision=deny  exit=0 (0.1s)   <- fail-closed
```

## 2. Live `claude -p` reproduction

Shows the hook governing real native-tool calls end to end.

```sh
export TOK="jst_$(python3 -c 'import uuid;print(uuid.uuid4())')"
printf '%s' "$TOK" > /tmp/perm-tok && chmod 600 /tmp/perm-tok
MOCK_JST="$TOK" MOCK_POLICY=allow python3 mock_gateway.py 8799 &   # or MOCK_POLICY=deny

mkdir -p work && echo "secret note" > work/sample.txt
JARVIS_PERM_URL=http://127.0.0.1:8799/permission \
JARVIS_PERM_TOKEN_FILE=/tmp/perm-tok \
JARVIS_NOTES_ROOTS="$PWD/vault" \
cat > .claude/settings.json <<JSON
{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"$PWD/jarvis-permission-hook.py","timeout":160}]}]}}
JSON

JARVIS_PERM_URL=http://127.0.0.1:8799/permission \
JARVIS_PERM_TOKEN_FILE=/tmp/perm-tok JARVIS_NOTES_ROOTS="$PWD/vault" \
claude -p "Use the Bash tool to run 'echo hi'." --model haiku \
  --permission-mode default --settings "$PWD/.claude/settings.json" \
  --add-dir "$PWD" --output-format json | python3 -c 'import json,sys;d=json.load(sys.stdin);print("denials:",[x["tool_name"] for x in d.get("permission_denials",[])])'
```

- `MOCK_POLICY=allow` → Bash runs (`denials: []`).
- `MOCK_POLICY=deny` → Bash blocked (`denials: ['Bash']`).

## 3. Interactive REPL reproduction

The hook is mode-agnostic; it fires in the REPL with no `-p`. Drive `claude` (no `-p`)
through a pty, send a prompt that triggers a `Read`, and watch the hook log — the hook
firing is the mode-independent proof. (A pty driver was used during the spike; any
interactive session with the same `.claude/settings.json` shows the hook firing on every
tool with `permission_mode: default` and no permission prompt rendered.)

## Hook environment contract

| Env                      | Meaning                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `JARVIS_PERM_URL`        | gateway permission endpoint (loopback in prod)                                                            |
| `JARVIS_PERM_TOKEN_FILE` | path to the `0600` per-session bearer file (reuse `.jarvis-claude-mcp.json`'s token)                      |
| `JARVIS_PERM_DEADLINE_S` | internal long-poll deadline; **must be < the hook config `timeout`** (default 150)                        |
| `JARVIS_NOTES_ROOTS`     | comma-separated vault roots fast-path-allowed for `Read`/`Glob`/`Grep` (same var as `vault-allowlist.ts`) |

## Key finding encoded in the hook

`jarvis-permission-hook.py` **never exits non-zero and never prints empty stdout** —
because Claude Code fails _open_ when a `PreToolUse` hook is killed/errs. Every failure
path calls `decide("deny", …)` which prints the JSON and `exit(0)`. The config `timeout`
(160s) is only a backstop above the hook's own 150s deadline.
