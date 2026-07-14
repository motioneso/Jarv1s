# CLI-provider terminal — design spec

- **Date:** 2026-07-14
- **Status:** Draft (awaiting owner review)
- **Task:** #1059
- **Parent:** Part of epic #983 (dogfood UX hardening — settings & chat self-explanatory); related to #869 (Assistant & AI admin)
- **Author:** coordinator session

## Problem

CLI-auth providers (anthropic/openai-compatible/google in `cli` mode) cannot be tested or
inspected from the UI. The current "Test" button (`packages/ai/src/provider-validation.ts:21`)
explicitly returns _"CLI provider testing is not supported yet."_ for `authMethod === "cli"`. When
the CLI-backed Live chat breaks — as it does now, because the tmux pane-scraping engine chokes on
claude CLI 2.1.183's redesigned TUI (failures masked by `mapRpcError` on the cli-runner RPC
boundary; both `"could not start the live chat session"` and `"chat input unavailable"` observed in
prod logs) — the owner has **no way to see what the CLI is actually doing**: whether auth
succeeded, whether the REPL launches, what the token state is. Diagnosis today requires
`docker exec` into the container.

## Goal

Give the **instance owner** a real interactive terminal, launched from the AI-admin settings, that
attaches to a live PTY inside the container so they can watch `claude`/`codex`/`gemini` launch,
re-login, inspect `~/.jarvis/cli-tokens`, and run arbitrary commands by hand. This is a
**manual fallback + live diagnostic**, owner-gated, in admin settings only.

## Non-goals (explicit scope boundaries)

- **Does not change how chat or any LLM interaction runs.** Chat, news validation, and structured
  AI calls keep their exact current path (cli-runner engine → `TranscriptRecord`s → SSE). The
  terminal is additive and isolated: a separate PTY, separate RPC frames, separate WebSocket. It
  does not touch chat routing, provider selection, the engine, or the tmux chat sessions.
- **Does not fix automated Live chat.** The 2.1.183 TUI-drift breakage of the pane-scraping engine
  is a **separate task**. (`node-pty` introduced here is a plausible future replacement for that
  engine, but that migration is out of scope.)
- **Does not surface blocked-states inside the Jarvis chat UI.** That owner idea is a separate
  follow-up.
- Not exposed to non-owner users. Not reachable outside admin AI settings.

## The one intentional coupling

The terminal shares exactly one thing with the chat runtime: the **cli-auth files on disk**
(`~/.jarvis/cli-tokens/*`, `.claude.json`, `.codex/`, etc.) in the `jarv1s-cli-auth` volume. A
manual re-login in the terminal refreshes the same token file chat reads on its next launch — this
is the point: fix auth by hand → chat's auth is repaired. Execution path is fully separate; auth
state is intentionally shared.

## Security model

The owner is trusted: they already control user access and could run anything on their own box.
So the shell is **not jailed**. Two gates guard opening it:

1. **Owner-only + authenticated.** Route requires an authenticated owner session. Non-owners get
   404 (not 403 — don't advertise the surface).
2. **Step-up terminal password.** A dedicated terminal password (hashed at rest, Argon2id or the
   existing password-hash primitive), independent of account login so it works under OAuth/passkey
   and survives a shoulder-surfed open session. First open with no password set → the UI forces the
   owner to set one before the socket can open. The password is verified server-side immediately
   before the WebSocket upgrade; a short-lived one-time ticket authorizes the upgrade.

Additional hardening:

- **Single active terminal session** per instance; opening a new one kills the prior.
- **Idle timeout** (default 10 min no I/O) and **hard kill on modal close / socket drop**.
- Terminal password attempts rate-limited; lockout after N failures.
- The PTY runs as the existing CLI **runtime uid**, never root; no privilege escalation added.
- Secrets: the byte stream is raw terminal output by design (the owner may `cat` a token
  themselves) — this is acceptable because it never leaves the owner's authenticated session and is
  never logged. The WebSocket frames are **never written to server logs**.

## Scope of the shell

- Unrestricted `bash` as the runtime uid (owner-trusted, no jail).
- Default `cwd` and `$HOME` = the cli-auth home (`/data/cli-auth`) so the owner lands where auth
  lives. Convenience default, not a restriction — `cd` anywhere that uid can reach is allowed.
- `PATH` includes the provider CLIs (`/data/cli-tools/bin`) plus normal coreutils.

## Architecture

Three new pieces; everything else is unchanged.

### 1. PTY source in cli-runner

Spawn a genuine PTY via `node-pty` running the login shell. This **sidesteps the tmux
pane-scraping** entirely — a real PTY emits the raw escape-sequence byte stream xterm.js expects,
so there is no TUI-layout guessing to break across CLI versions.

New RPC frames on the existing length-prefixed JSON socket
(`packages/chat/src/live/rpc-contract.ts`, `packages/cli-runner/src/connection.ts`):

- `openTerminal { cols, rows }` → `{ terminalId }` — spawns the PTY.
- `writeTerminal { terminalId, dataB64 }` — keystrokes browser → PTY (base64 to stay JSON-safe).
- `resizeTerminal { terminalId, cols, rows }`.
- `killTerminal { terminalId }`.
- **Server-push output frames** `terminalData { terminalId, dataB64 }` — PTY → browser. This is the
  first server-initiated push on the RPC socket; frames carry a `terminalId` so the connection
  demuxes them from request/response traffic. Volume is low (interactive typing); the existing
  16 MiB `MAX_FRAME_BYTES` cap is ample. Output is chunked/coalesced (~16 ms flush) to bound frame
  count.

`node-pty` is a new native dependency in `packages/cli-runner`. Build implication: the container
image must compile it (verify against the existing native-dep toolchain in the Dockerfile).

### 2. Bidirectional transport (API ↔ browser)

A new authenticated **WebSocket** route `GET /api/ai/terminal` (Fastify `@fastify/websocket`). SSE
is insufficient — a terminal needs keystrokes flowing upward. The route:

- Verifies the owner session + the step-up ticket before upgrade.
- Bridges browser frames ⇄ cli-runner terminal RPC frames (`writeTerminal`/`resizeTerminal` up,
  `terminalData` down).
- Enforces single-session, idle timeout, and hard-kills the PTY (`killTerminal`) on close/drop.

A companion REST route sets/verifies the terminal password:
`POST /api/ai/terminal/password` (set), and the step-up verification issues the one-time ticket.

### 3. Frontend

First `@xterm/xterm` (+ `@xterm/addon-fit`) dependency in `apps/web`. A modal launched from the
AI-admin Test action:

- `settings-ai-admin-pane.tsx` — for a **CLI-auth** provider, the "Test" button opens the terminal
  modal instead of the HTTPS credential check. For **API-key** providers, "Test" keeps the existing
  `POST /api/ai/providers/:id/test` credential validation. `testAiProvider` behavior becomes
  provider-kind-aware (or a sibling action `openProviderTerminal`).
- The modal: password prompt (or set-password on first use) → xterm.js canvas wired to the
  WebSocket → resize via fit addon → clean teardown on close.

## Data flow

```
browser (xterm.js)
  ⇅ WebSocket /api/ai/terminal   (owner session + one-time ticket)
API (Fastify)
  ⇅ RPC frames over Unix socket  (openTerminal / writeTerminal / resizeTerminal / terminalData / killTerminal)
cli-runner
  ⇅ node-pty PTY master          (bash, cwd/$HOME=/data/cli-auth, PATH incl. /data/cli-tools/bin)
```

## Error handling

- cli-runner PTY spawn failure → structured error frame → modal shows _"could not open terminal"_
  with the real reason (this path is **logged unredacted server-side** — unlike the chat engine's
  `mapRpcError` masking, which is the diagnosability gap this whole effort responds to).
- WebSocket drop / cli-runner restart → modal shows disconnected banner + Reconnect; PTY is
  killed server-side so no orphan shells accumulate.
- Wrong terminal password → generic failure + rate-limit; never reveal whether a password is set.
- Idle timeout → PTY killed, modal shows _"session ended (idle)"_.

## Testing

- **Unit (cli-runner):** PTY lifecycle (open→write→data→resize→kill), single-session eviction,
  idle-timeout kill, base64 round-trip integrity.
- **Unit (API):** owner-gating (non-owner → 404), password set/verify + lockout, one-time-ticket
  single-use, WS upgrade rejected without ticket.
- **Integration:** end-to-end open → `echo hello` → receive `hello` bytes → close → PTY reaped.
- **e2e dev UAT (required per project rule for UI features):** Playwright drives the real modal in a
  dev instance — set password, open terminal, run `claude --version`, confirm output renders, close,
  confirm no orphan process. This is an exit criterion before done/prod (unit + diff review are not
  sufficient for a runtime path like this).

## Open decisions (flag on review)

1. **Terminal password** = dedicated password (assumed), vs. account re-auth. Assumed dedicated.
2. **Landing dir** = cli-auth home (assumed convenience default, not a jail).
3. **Native dep:** confirm `node-pty` compiles cleanly in the prod image build.
4. **Button vs. sibling action:** reuse "Test" for CLI providers (assumed) vs. a distinct
   "Open terminal" affordance on the CLI-provider row.
