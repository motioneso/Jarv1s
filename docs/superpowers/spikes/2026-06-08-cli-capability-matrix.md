# CLI Capability Matrix — Jarv1s Chat (Phase 1, Task 1 spike)

**Date:** 2026-06-08
**Host:** xbmx (Linux 6.8, headless). tmux 3.4.
**Goal:** Establish _verified_ facts for driving an agentic coding CLI (Claude Code / Codex / Gemini)
inside a tmux session as "Jarvis" — without bypass-permissions, with the CLI's own native
shell/file tools disabled (so Jarvis can only act through a future Jarv1s MCP server, never raw host
bash), with a launch persona that survives `/clear`, and with a tailable JSONL transcript.

**Method:** Ran the real `claude` binary in detached tmux sessions in a neutral scratch dir
(`/tmp/jarvis-spike/...`), drove it with `tmux send-keys`, read panes with `tmux capture-pane -p`,
and inspected the on-disk transcript. All scratch dirs and tmux sessions were cleaned up after.

**Availability on this host (`which claude codex gemini`):**

- `claude` → `~/.local/bin/claude` — **AVAILABLE**, version **2.1.168 (Claude Code)**.
- `codex` → **UNAVAILABLE** (`command -v codex` empty). Not installed. Do not install.
- `gemini` → **UNAVAILABLE** (`command -v gemini` empty). Not installed. Do not install.

> Everything for Claude below is VERIFIED by observed behavior on v2.1.168 (flags taken from
> `claude --help` on this host, not from docs). Everything for Codex and Gemini is
> **UNVERIFIED (from docs)** and labeled as such — it must be re-confirmed once those binaries exist.

---

## Summary matrix

| #   | Capability                        | Claude Code (VERIFIED v2.1.168)                                                                                                                                                                                                                         | Codex CLI (UNVERIFIED — from docs)                                                                                                                | Gemini CLI (UNVERIFIED — from docs)                                                                      |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | Binary on PATH?                   | **YES** `~/.local/bin/claude`, v2.1.168                                                                                                                                                                                                                 | **NO — UNAVAILABLE, verify later**                                                                                                                | **NO — UNAVAILABLE, verify later**                                                                       |
| 2   | Launch persona injection          | `--append-system-prompt "<text>"` **or** `--append-system-prompt-file <path>` (both verified). `--system-prompt[-file]` _replaces_ the default prompt; the append form is what Jarv1s wants.                                                            | `~/.codex/config.toml` `model_instructions_file` / project `AGENTS.md`; experimental `developer_instructions`. Unverified.                        | `GEMINI_SYSTEM_MD=<path>` env var to load a system prompt file; or `.gemini/` context files. Unverified. |
| 3   | Persona survives `/clear`?        | **YES — verified.** After `/clear`, a re-asked identity question still returned the persona token. The launch system prompt is reapplied; `/clear` only drops conversation history.                                                                     | Unknown — verify. Codex `/clear`-equivalent behavior with `model_instructions_file` unconfirmed.                                                  | Unknown — verify. Whether `GEMINI_SYSTEM_MD` persists across the new-chat command unconfirmed.           |
| 4   | "New conversation" command        | `/clear` — clears conversation history/context for the current session, keeps the same process + launch system prompt + CLAUDE.md. (No `/new` on this version.)                                                                                         | Likely `/new` and/or `/clear` (unverified).                                                                                                       | Likely `/clear` or `/chat new` (unverified).                                                             |
| 5   | Disable native shell/file tools   | **Use an ALLOWLIST: `--tools ""`** (empty = disable ALL built-in tools). **VERIFIED** to block Bash _and_ the workaround tools (Monitor/Task/agents). `--disallowedTools "Bash ..."` is a DENYLIST and is **insufficient** (see finding F1).            | `approval_policy` / `sandbox_mode` in config; no confirmed per-tool allowlist. Unverified — treat as unknown.                                     | `--allowed-tools` / `coreTools` settings or `--sandbox`. Unverified.                                     |
| 6   | Launch WITHOUT bypass-permissions | `--permission-mode default` (**VERIFIED** to override this host's global `bypassPermissions` default). Simply _not_ passing `--dangerously-skip-permissions` is NOT enough here — see F2.                                                               | Default is interactive approval; bypass is an explicit `--dangerously-bypass-approvals-and-sandbox` / `--yolo`. Don't pass it. Unverified.        | Default prompts for approval; `--yolo` / `--approval-mode auto` bypasses. Don't pass it. Unverified.     |
| 7   | Transcript path + format          | **Plain `.jsonl`** (one JSON object per line, NOT compressed). Path: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. cwd encoding: leading `/`→leading `-`, every `/`→`-` (and `.`→`-`). Pin the filename with `--session-id <uuid>` (verified). | `~/.codex/sessions/**/rollout-*.jsonl` — **may be `.jsonl.zst` (zstd-compressed)** on recent versions. Unverified — must check on a real install. | `~/.gemini/tmp/<hash>/` chat/checkpoint files; format/path unverified.                                   |
| 8   | MCP config (Phase 2 note)         | `--mcp-config <file.json>` to load servers; `--strict-mcp-config` to use ONLY those (ignore user/global MCP); `claude mcp ...` subcommands to manage.                                                                                                   | `~/.codex/config.toml` `[mcp_servers.*]` blocks. Unverified.                                                                                      | `.gemini/settings.json` `mcpServers` map, or `gemini mcp add`. Unverified.                               |

---

## Claude Code — verified details (v2.1.168)

### Launch command Jarv1s should use (recommended shape)

```bash
claude \
  --append-system-prompt-file /path/to/jarvis-persona.md \
  --tools "" \
  --permission-mode default \
  --session-id <uuid> \
  --strict-mcp-config --mcp-config /path/to/jarvis-mcp.json   # Phase 2
```

Launched detached in tmux:

```bash
tmux new-session -d -s <name> -x 220 -y 50
tmux send-keys -t <name> "cd <workdir> && claude --append-system-prompt-file persona.md --tools '' --permission-mode default --session-id <uuid>" Enter
```

Drive it: `tmux send-keys -t <name> "<prompt>"` then a separate `tmux send-keys -t <name> Enter`
(send the text and the Enter as two calls — sending them together was unreliable). Read it:
`tmux capture-pane -p -t <name>`.

### (2) Persona injection — VERIFIED

- `--append-system-prompt "<text>"` — appends to the default system prompt. Verified: a persona that
  said "begin every reply with `JARVIS_PERSONA_ACTIVE:`" took effect on the first answer.
- `--append-system-prompt-file <path>` — same effect, reads the prompt from a file. **Also verified**
  (reply began with the file persona's token). Not listed as its own line in `--help` but documented
  under `--bare` and confirmed working — prefer this for Jarv1s (cleaner than shell-substituting a
  string, no quoting/escaping hazards).
- `--system-prompt` / `--system-prompt-file` _replace_ the default system prompt entirely. Jarv1s
  wants the **append** form so the normal Claude Code agent behavior is retained.
- A project `CLAUDE.md` in the cwd is auto-discovered and loaded too, but that is _project context_,
  not the launch persona; do not rely on it for identity (it is also reloaded on `/clear`, so it
  can't distinguish "persona survived" — that's why the test persona was injected via the flag, not
  the file).

### (3) Persona survives `/clear` — VERIFIED

Sequence run: ask identity → got persona token → `/clear` → re-ask identity → **still got the persona
token** (`JARVIS_PERSONA_ACTIVE: I'm Jarvis...`). Conclusion: `--append-system-prompt[-file]` content
is part of the session's system prompt and is reapplied after `/clear`. `/clear` only drops the
conversation transcript/context, not the launch system prompt.

### (4) "New conversation" — VERIFIED

`/clear` resets conversation history/context while keeping the same process, launch system prompt, and
auto-loaded `CLAUDE.md`. No `/new` command on this version. For Jarv1s "start fresh", send `/clear`.

### (5) Disabling native shell/file tools — VERIFIED, with a critical caveat (F1)

- **`--disallowedTools "Bash Edit Write Read Glob Grep"` is a DENYLIST and is NOT safe.** Verified:
  with Bash denied, the model still executed `echo hello-from-bash` by routing through the **`Monitor`
  tool** ("the Monitor tool runs in the same shell environment"). A denylist cannot enumerate every
  shell-capable built-in (Monitor, Task, background agents, etc.).
- **`--tools ""` (empty allowlist) IS safe — use this.** Verified: with `--tools ""`, when explicitly
  asked to run a shell command "using ANY tool available including Monitor, Task, or agents", the model
  responded it had **no shell/Bash/Task/Monitor/agent tool** available and refused (it correctly
  declined to fabricate output). This is the secure posture for Jarv1s: deny-all built-ins, then in
  Phase 2 add back capability exclusively via the Jarv1s MCP server.
- Residual escape hatch: the interactive TUI `!`-bash prefix lets the **human** run a shell line
  directly in the input box (model pointed this out: `! echo hello-from-bash`). Since Jarv1s drives
  input programmatically via `send-keys`, Jarv1s must never forward a user line that begins with `!`
  (sanitize/escape leading `!`), and the persona should be told not to instruct the operator to use it.

### (6) No bypass-permissions — VERIFIED, host-specific gotcha (F2)

- This host's **global `~/.claude/settings.json` sets `permissions.defaultMode: "bypassPermissions"`**
  (also `skipDangerousModePermissionPrompt: true`, `skipAutoPermissionPrompt: true`). So a plain
  `claude` launch shows "⏵⏵ bypass permissions on" even though `--dangerously-skip-permissions` was
  never passed. **Not passing the bypass flag is therefore NOT sufficient on this machine.**
- **`--permission-mode default` overrides it** — VERIFIED: the "bypass permissions on" indicator
  disappeared from the status bar. Jarv1s must pass `--permission-mode default` explicitly (do not
  rely on omission). Other modes: `acceptEdits`, `auto`, `dontAsk`, `plan`, `bypassPermissions`.
  (With `--tools ""` there are no built-in tools to approve anyway, but pass `default` for defense in
  depth and so future MCP tool calls are gated.)

### (7) Transcript path + format — VERIFIED

- Format: **plain JSONL**, one JSON object per line, **not compressed**. Readable directly; tail and
  `JSON.parse` each line.
- Path: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
- cwd encoding (confirmed): cwd `/tmp/jarvis-spike/claude-test` → dir
  `-tmp-jarvis-spike-claude-test`. Leading `/` → leading `-`; each `/` → `-`. (A `.` in the path also
  maps to `-`.) **The leading dash is kept.**
- **Pin the filename:** `--session-id <uuid>` makes the transcript exactly `<uuid>.jsonl` in that
  dir — VERIFIED with `--session-id 11111111-2222-3333-4444-555555555555` producing
  `.../-tmp-jarvis-spike-claude-test/11111111-2222-3333-4444-555555555555.jsonl`. This lets Jarv1s know
  the exact transcript path _before_ launch instead of globbing for the newest file.
- Record schema (observed types): `user`, `assistant`, `system`, `attachment`, `mode`,
  `permission-mode`, `last-prompt`, `ai-title`, `file-history-snapshot`. A `user` record carries:
  `type`, `uuid`, `parentUuid`, `sessionId`, `message` (`{role, content}`), `cwd`, `gitBranch`,
  `permissionMode`, `timestamp` (ISO 8601 UTC), `version`, `userType`, `entrypoint`, `promptId`,
  `promptSource`, `isSidechain`. This is sufficient for Jarv1s to reconstruct the turn-by-turn
  conversation.

### (8) MCP config (Phase 2 note) — from `--help`

- `--mcp-config <file.json | json...>` loads MCP servers for the session.
- `--strict-mcp-config` uses ONLY the `--mcp-config` servers and ignores all other (user/global)
  MCP configuration. **Jarv1s should use `--strict-mcp-config --mcp-config jarvis-mcp.json`** so the
  CLI is wired to _only_ the Jarv1s MCP server and not the operator's personal MCP servers. (Note: in
  this spike the operator's global MCP servers — Gmail, Calendar, codegraph, etc. — were still visible
  to the model precisely because strict-config was not used; with `--tools ""` they were the only
  tools present. Scoping MCP is therefore part of the security posture, not just convenience.)

---

## Codex CLI — UNVERIFIED (binary absent, from docs only — re-confirm on a real install)

- **Persona at launch:** `~/.codex/config.toml` key `model_instructions_file` (path to a file), or a
  project `AGENTS.md`, or experimental `developer_instructions`. **Unverified.**
- **Persona survives new conversation:** unknown — must test whether the equivalent of `/clear`/`/new`
  reloads `model_instructions_file`. **Unverified.**
- **Disable native shell/file tools:** Codex's model is sandbox/approval based (`sandbox_mode`,
  `approval_policy`) rather than a per-tool allowlist; whether its built-in exec/apply_patch tools can
  be fully removed (vs merely sandboxed) is **unverified** and is the key risk to validate before
  using Codex as a Jarvis backend.
- **No bypass:** default requires approvals; the bypass is the explicit
  `--dangerously-bypass-approvals-and-sandbox` (a.k.a. yolo). Do not pass it. **Unverified.**
- **Transcript:** rollout/session JSONL under `~/.codex/sessions/...` — **may be `.jsonl.zst`
  (zstd-compressed)** on recent Codex versions; the tailer would need a zstd streaming decoder.
  **Unverified — must confirm path glob and compression on a real install.**
- **MCP:** `[mcp_servers.*]` tables in `~/.codex/config.toml`. **Unverified.**

## Gemini CLI — UNVERIFIED (binary absent, from docs only — re-confirm on a real install)

- **Persona at launch:** `GEMINI_SYSTEM_MD=<path-to-md>` environment variable points the CLI at a
  system-prompt markdown file; project `.gemini/` context files also contribute. **Unverified.**
- **Persona survives new conversation:** unknown — must test whether `GEMINI_SYSTEM_MD` persists
  across the new-chat command. **Unverified.**
- **Disable native shell/file tools:** `coreTools` / `excludeTools` in `.gemini/settings.json`, or
  `--allowed-tools`; the safe approach (allowlist down to nothing, add back only MCP) needs to be
  proven. **Unverified.**
- **No bypass:** default prompts for approval; `--yolo` / `--approval-mode auto` bypasses. Do not pass
  it. **Unverified.**
- **Transcript:** chat/checkpoint files under `~/.gemini/tmp/<project-hash>/`; exact format/path
  **unverified.**
- **MCP:** `mcpServers` map in `.gemini/settings.json` or `gemini mcp add`. **Unverified.**

---

## Key findings (carry these into later tasks)

- **F1 (security, most important):** Disable native tools with the **allowlist `--tools ""`**, NOT the
  denylist `--disallowedTools`. The denylist was empirically bypassed — Bash was blocked but the model
  ran a shell command via the `Monitor` tool. `--tools ""` left it with no shell path at all.
- **F2 (this host):** `~/.claude/settings.json` forces `defaultMode: bypassPermissions` globally, so a
  bare launch is in bypass mode. Jarv1s MUST pass `--permission-mode default` to launch without
  bypass; omitting the bypass flag is not enough here.
- **F3 (persona):** `--append-system-prompt-file <path>` is the clean persona mechanism, and the
  injected persona **survives `/clear`** (verified). Use the append (not replace) form; pin the
  transcript with `--session-id <uuid>` so the JSONL path
  (`~/.claude/projects/<dash-encoded-cwd>/<uuid>.jsonl`, plain text, leading dash kept) is known
  up front.
- **F4 (residual):** the interactive `!`-bash prefix and the operator's global MCP servers are two
  escape hatches; sanitize leading `!` in forwarded input and use `--strict-mcp-config --mcp-config`
  to scope MCP to only the Jarv1s server.
- **F5 (coverage):** only Claude is verifiable on this host; Codex and Gemini rows are documented
  expectations only and MUST be re-spiked once installed — especially Codex transcript compression
  (`.jsonl.zst`) and whether either CLI supports a true tool-allowlist down to zero built-ins.
