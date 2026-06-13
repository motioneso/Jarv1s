# Phase 2 — Portable CLI Chat Adapter (Design Spec)

**Status:** approved-pending-user-review · **Date:** 2026-06-12 · **Author:** Ben + Claude
**Phase:** 2 (epic #47, milestone #11 "Portable, Deployable & Multi-user")
**Implements:** ADR 0008 (portable pluggable chat engine), ADR 0007 (house tenancy)
**Handoff target:** OpenAI Codex dev agent
**Grounded on:** `5759b90` (local `main` == `origin/main`, 0 behind / 0 ahead)

---

## 1. Problem & Goal

Live chat today drives the `claude` / `codex` / `gemini` CLI binaries through **tmux**, on the
operator's host, under the operator's personal CLI auth. ADR 0008 named this the single biggest
"prototype vs product" gap: the engine is **welded to tmux and to one machine**. ADR 0007 requires
the product never depend on Ben's specific server.

**Goal:** make the terminal-CLI chat engine **portable** by hiding the multiplexer behind a small
seam, so a deployed instance can drive sessions through whatever multiplexer the host has
(**tmux or herdr**), selected at onboarding. Preserve the existing constrained-launch security
posture exactly. Document — and design seams for — the deferred uid-per-user isolation follow-on.

**Non-goal of this spec:** the API-key in-process adapter, the onboarding wizard UI, the module
seam, the Docker image. Those are separate Phase 2 specs (see §12).

---

## 2. Scope

**In scope**

- A `Multiplexer` seam (open / submit / isAlive / kill / attachCommand) with **tmux** and **herdr**
  backends, PATH-detected and user-selectable.
- Refactor `TmuxCliChatEngine` to depend on the `Multiplexer` seam instead of issuing tmux verbs
  inline. Rename to a multiplexer-neutral engine.
- An **agent-path `PreToolUse` policy** (FailproofAI-style) seeded into each agent home, denying
  cross-user / secret / shell-shaped tool calls and rejecting `!`-escape on **every** input path.
- Adapter seams (env/home threading, opaque-handle storage, symmetric teardown) so the deferred
  **uid-per-user** milestone drops in without re-opening this adapter.

**Out of scope (explicit non-goals)**

- uid-per-user OS isolation, privileged launcher, non-operator (web-user) attach. **Deferred
  follow-on Phase 2 milestone** (§10).
- Yolo / elevated / native-tools launch posture. The constrained posture is **locked** (§7).
- Any browser-terminal bridge for web-only users.
- API-key adapter, onboarding UI, module seam, Docker packaging.

---

## 3. Locked Decisions (carry into implementation)

1. **One CLI adapter behind the capability-router seam.** In-process HTTP API-key adapter deferred
   post-launch. All three providers (Claude default, Codex, Gemini) ride one seam.
2. **Constrained launch posture preserved EXACTLY** — `--permission-mode default`,
   `--tools ""` / MCP-allowlist-only, `--strict-mcp-config`, Codex `--sandbox read-only` `-a never`
   `features.shell_tool=false` `features.apply_patch_tool=false`, Gemini
   `--allowed-mcp-server-names jarvis`. Yolo/elevated = explicit deferred non-goal.
3. **Multiplexer abstraction:** tmux + herdr backends, PATH-detected, user-selectable; attach is a
   steering affordance only.
4. **Isolation = SHARED-UID.** All sessions run as the operator uid. Documented known soft boundary
   (§10). uid-per-user is the deferred follow-on.
5. **Agent-path defense-in-depth:** a FailproofAI-style `PreToolUse` policy seeded into each agent
   home — deny cross-user / secret / shell-shaped MCP tool calls; reject `!`-escape on every input
   path, not just HTTP/submit.
6. **Attach posture:** steer-attach for anyone with host shell access; **no** browser-terminal bridge
   for web-only users; web users stay web-only.
7. **Deferred follow-on milestone:** uid-per-user OS isolation + non-operator attach +
   privileged-launcher ADR. This spec designs the seams; it does not build them.

---

## 4. Architecture — the Multiplexer seam

The engine currently knows tmux verbs directly. We interpose a 5-verb seam. The engine becomes
multiplexer-agnostic; backends translate verbs to tmux / herdr commands.

```txt
ChatSessionManager
   └─ engineFactory ──> CliChatEngine (multiplexer-neutral)
                           └─ Multiplexer (seam)
                                ├─ TmuxMultiplexer   (tmux backend)
                                └─ HerdrMultiplexer  (herdr backend)
                           └─ TmuxIo (process/file I/O — unchanged shape, env-extensible)
```

### 4.1 The `Multiplexer` interface

```ts
/** Opaque, backend-assigned handle for a launched session. Callers STORE it; never parse it. */
export type MuxHandle = string;

export interface Multiplexer {
  readonly kind: "tmux" | "herdr";
  /** Launch a detached session running `launchLine`; returns the handle to store. */
  open(opts: { name: string; cols: number; rows: number; launchLine: string }): Promise<MuxHandle>;
  /** Paste-and-Enter `text` into the session identified by `handle`. */
  submit(handle: MuxHandle, text: string): Promise<void>;
  /** Is the session still running? */
  isAlive(handle: MuxHandle): Promise<boolean>;
  /** Terminate the session. Idempotent. */
  kill(handle: MuxHandle): Promise<void>;
  /** Human-runnable shell command to attach for steering (display-only; not executed by us). */
  attachCommand(handle: MuxHandle): string;
}
```

**KEY ASYMMETRY (must be honored):** tmux session names are caller-chosen and stable; herdr
pane ids are **server-assigned and opaque**. Therefore `open()` **returns** the handle the engine
**stores** — the engine must NOT reconstruct a tmux session name from `threadKey` to address later
calls. Today's engine derives `jarv1s-live-${threadKey}` and reuses it across `submit`/`isAlive`/
`kill` (`cli-chat-engine.ts:64`); after the refactor it stores whatever `open()` returns.

### 4.2 Backend selection

- PATH-detect available multiplexers; let the instance choose (config / onboarding). Default to
  tmux when both present (current behavior, least surprise).
- Selection point is the engine factory: `realEngineFactory` in
  `packages/chat/src/live/runtime.ts:44-45` constructs the engine with the chosen `Multiplexer`.

---

## 5. Refactor surface (file-by-file, with anchors)

This is a **refactor**, not a rewrite. The security-critical command builders and the MCP token
flow are preserved verbatim; only the multiplexer verbs move behind the seam.

### 5.1 `packages/chat/src/live/cli-chat-engine.ts` (284 lines) — primary target

- **Stale header comment (`:6)`** references a one-shot `TmuxBridgeAdapter`. Update to describe the
  persistent multiplexer-neutral engine.
- **Constructor (`:56-69`)** `(provider, threadKey, io, opts)` → add a `Multiplexer` dependency.
  Stop deriving `sessionName = jarv1s-live-${threadKey}` as the address of record; keep `threadKey`
  only as the `open()` `name` hint. Store the returned `MuxHandle`.
- **`launch()` (`:73-121`)** the 8 inline tmux calls (`new-session -d -s … -x 220 -y 50` `:105-114`,
  `send-keys … Enter` `:117`) → `mux.open({ name, cols: 220, rows: 50, launchLine })`, store handle.
  Preserve `randomUUID()` sessionId, the google `.gemini/settings.json` special-case (`:78-96`),
  and `storedTranscriptPath` derivation (`:98-101`) unchanged.
- **`submit()` (`:123-139`)** `sanitizeInput` → writeFile promptFile → load-buffer / paste-buffer /
  send-keys Enter → `mux.submit(handle, text)`. **Keep `sanitizeInput` (`:276-278`) on this path.**
- **`isAlive()` (`:170-173`)** tmux `has-session` → `mux.isAlive(handle)`.
- **`kill()` (`:175-177`)** tmux `kill-session` → `mux.kill(handle)`.
- **`readNew()` (`:141-168`)** transcript-file read — **unchanged** (multiplexer-independent).
- **Command builders — PRESERVE VERBATIM:** `buildClaudeCommand` (`:207-234`),
  `buildCodexCommand` (`:236-256`), `buildGeminiCommand` (`:258-266`). These carry the locked
  security flags (§3.2). Do **not** alter flags. Two comment fixes only:
  - `buildCodexCommand` comment (`:238-240`) "accepted tradeoff for a local single-user session" is
    **false** under the house model → revise to reflect multi-user shared-uid posture.
  - Confirm `EngineLaunchOpts.mcpToken` is described as an opaque token, not a JWT (§5.3).
- **`sanitizeInput` (`:276-278`)** `text.replace(/^(\s*)!+/, "$1")` strips a leading `!`
  (bash-escape guard). **Today it is applied only on `submit()`.** Keep it here AND make the
  `PreToolUse` policy (§6) enforce the same rejection on every input path (replay/seed/recall),
  so a `!`-escape can never reach the CLI un-stripped regardless of entry point.
- **Rename** the class from `TmuxCliChatEngine` to a multiplexer-neutral name
  (e.g. `CliChatEngineImpl`); update `runtime.ts:18,45` import/usage.

### 5.2 `packages/ai/src/adapters/tmux-bridge.ts` (98 lines) — I/O seam (env-extensible)

- `TmuxIo` (`:11-20`) `run` / `readFile` / `writeFile` / `sleep` — **shape unchanged**.
- `createRealTmuxIo()` (`:29-53`) uses `execFileAsync` (not shell), no uid/env override. **Add an
  optional `env`/`cwd` option** to `run()` now (default no-op) so the deferred uid-per-user work can
  thread a per-user `HOME`/env without re-opening this seam. Tmux and herdr backends call through it.
- `transcriptGlobDir(provider, cwd)` (`:75-97`) relies on `homedir()` (`:82,:89,:94`). **Add an
  optional `homeBase` parameter** (default `homedir()`) so a redirected per-user HOME can be passed
  later. No behavior change today.
- Consider renaming the module to `multiplexer-io.ts` (the I/O is not tmux-specific). Optional;
  the `TmuxIo` name can stay if a rename balloons the diff.

### 5.3 `packages/chat/src/live/types.ts` (45 lines) — contracts

- `EngineLaunchOpts` (`:21-27`): comment on `mcpToken` (`:25`) says "per-session JWT" — **stale**;
  it is an opaque `jst_<uuid>` token (`session-tokens.ts:67`). Fix the comment.
- `CliChatEngine` interface (`:30-40`): unchanged externally — the manager still calls
  `launch/submit/readNew/isAlive/kill`. The `Multiplexer` is an internal dependency of the impl, not
  a change to this contract.

### 5.4 `packages/chat/src/live/runtime.ts` — factory wiring

- `realEngineFactory` (`:44-45`) constructs `new TmuxCliChatEngine(provider, sessionKey,
  createRealTmuxIo())`. After refactor: construct the renamed engine **with a selected
  `Multiplexer`** (PATH-detected/configured). Keep `engineFactory` injectable so integration tests
  still swap a fake engine (no real multiplexer / CLI binary).

### 5.5 `packages/chat/src/live/persona.ts` — neutral dir

- `renderPersona` (`:83-95`) builds `neutralDir = join(base, userId)` and `mkdir`s it **without a
  mode** (`:91`, via `createRealPersonaFs` `:100-102` `recursive:true`). For shared-uid this is
  acceptable but the per-user dir is world-traversable by default. **Set mode `0700`** on the
  per-user `mkdir` now — cheap hardening, and the correct default once uid-per-user lands.

### 5.6 No change required (confirm only)

- `chat-session-manager.ts` — `launchSession` (`:147-198`), `kill`/`reapIdle` already call
  `engine.kill()` + `revokeMcpToken` symmetrically (`:286-288,:301-303,:343-345`). The seam
  refactor must keep teardown symmetric (kill handle → revoke token). No new dispose needed for
  shared-uid; uid-per-user adds per-user cleanup later.
- `session-tokens.ts` mint/verify/touch — unchanged.
- `module-registry/src/index.ts:155` `mcpServerUrl` loopback — unchanged.

---

## 6. Agent-path defense-in-depth — `PreToolUse` policy

A FailproofAI-style policy middleware hooks the `PreToolUse` event of all three CLIs (Claude / Codex
/ Gemini — the exact set FailproofAI targets). It returns `allow()` / `deny(msg)` / `instruct(msg)`.
Zero-kernel (no seccomp/ptrace/LSM); **agent-path only — it cannot contain a human attach** (§10).

**Why it still matters under shared-uid:** the agent is already constrained (`--tools ""` /
MCP-allowlist), so an injected prompt has no native file/shell primitive. The policy is a second
lock on the agent door: if a future flag change or provider quirk widened tool access, the policy
still denies cross-user / secret / shell-shaped calls.

**Policy requirements (seeded into each agent home / `.failproofai/policies/` or equivalent):**

1. **Deny shell-shaped tool calls** — any tool invocation whose target is a shell / exec / file-read
   outside the MCP allowlist. (Belt-and-suspenders behind `--tools ""`.)
2. **Deny cross-user / secret access** — reject tool calls referencing another user's id, vault
   paths outside the actor's neutral dir, or secret-shaped keys.
3. **Reject `!`-escape on every input path** — mirror `sanitizeInput` so a leading `!` can never
   reach the CLI from replay/seed/recall paths, not only `submit()`.

**Posture:** defense-in-depth, **not** a substitute for uid isolation on the human-attach path. The
dashboard (FailproofAI localhost:8020) is optional/dev-only; the policy files are the artifact.

**Decision for Codex:** evaluate adopting FailproofAI as the middleware vs. a thin in-house
`PreToolUse` hook. Either is acceptable; the **policy behavior above is the contract**, the host is
an implementation choice. Document whichever is chosen and how policies are provisioned per agent
home.

---

## 7. Attach posture

- **Steer-attach for anyone with host shell access.** `attachCommand(handle)` returns the
  human-runnable command (tmux: `tmux attach -t <name>`; herdr: its attach verb). Display-only — we
  never execute it.
- **No browser-terminal bridge** for web-only users. Web users stay web-only.
- Under shared-uid, attaching physically requires already holding a shell as the shared uid (the
  tmux socket is `/tmp/tmux-<uid>/`, mode 0700, per-uid). So "attach for everyone" means
  shell-holders only — not web users. Non-operator / web attach with real isolation is the deferred
  milestone (§10).

---

## 8. Known security limitation — shared-uid (MUST ship documented)

**All chat sessions run as one OS user (the operator uid).** This is a deliberate, accepted soft
boundary for Phase 2, not an oversight.

- **What's contained:** the autonomous agent path. With `--tools ""` / MCP-allowlist-only +
  `--strict-mcp-config` + the §6 policy, an injected prompt has no file-read or shell primitive, so
  it cannot read another user's secrets via the agent.
- **What's NOT contained:** a **human who already has a shell as the shared uid** can attach to any
  session (tmux `!`-escape, Ctrl-C-to-bash, prefix→new-window) and thereby read any user's neutral
  dir / CLI auth. The MCP RLS scoping, the §6 policy, and `sanitizeInput` are all **agent-path**
  defenses and do **not** stop a human at a live terminal.
- **Mitigation today:** host-shell access is the operator's own; per-user neutral dirs are `0700`
  (§5.5); secrets remain AES-256-GCM at rest and never enter prompts/payloads (Hard Invariant).
- **Real fix:** uid-per-user OS isolation — the deferred follow-on (§10).

This section must appear in the engine module README and be linked from the epic #47 exit criteria.

---

## 9. Seams designed for the deferred uid-per-user milestone

Build these now so the later milestone is a drop-in, not an adapter re-open:

1. **Opaque-handle storage** (§4.1) — engine stores `open()`'s return; never reconstructs an address.
   A privileged launcher can return a handle that encodes the target uid.
2. **Env/home threading** — `TmuxIo.run()` accepts optional `env`/`cwd` (§5.2);
   `transcriptGlobDir` accepts optional `homeBase` (§5.2). uid-per-user passes a redirected `HOME`.
3. **Symmetric teardown** (§5.6) — kill handle → revoke token, already symmetric; per-user cleanup
   slots in at the same call sites.
4. **`0700` neutral dirs** (§5.5) — already the correct per-user permission.

---

## 10. Deferred follow-on Phase 2 milestone (NOT this spec)

uid-per-user OS isolation + non-operator (web-user) attach + a privileged-launcher ADR. Priced
previously as ~milestone-sized (2 XL + 4 L + ~5 M), dominated by a privileged-launcher topology
reshape with no precedent (the API runs unprivileged as `ben`). Its own spec + ADR when scheduled.

---

## 11. Testing

- **Multiplexer seam:** unit tests per backend translate the 5 verbs to the expected tmux / herdr
  command lines (assert argv, not shell strings — `execFileAsync`, no shell join). Use a fake
  `TmuxIo` to capture `run()` argv.
- **Engine refactor:** existing engine/integration tests stay green with the fake engine injected
  via `engineFactory` (`runtime.ts:50`). Add a test asserting the engine **stores and reuses** the
  `open()` handle rather than deriving an address (guards the herdr asymmetry).
- **`!`-escape:** test that a leading `!` is rejected on the replay/seed path, not only `submit()`.
- **Policy:** test that a shell-shaped / cross-user MCP call is denied; that a normal allowlisted
  call is allowed.
- **Gate:** `pnpm verify:foundation` green; `pnpm check:file-size` (engine stays < 1000 lines —
  extracting the multiplexer backends helps). No new migration (this is code-only).

---

## 12. Subsequent Phase 2 specs (separate, not blocked by this)

- Module seam & per-user enablement (ADR 0009).
- Docker image / portable packaging.
- Onboarding wizard UI (multiplexer install + CLI auth + API-key entry).
- API-key in-process adapter (post-launch).

---

## 13. Codex handoff — acceptance criteria

1. `Multiplexer` seam exists with **tmux + herdr** backends, PATH-detected, user-selectable;
   `open()` returns a stored opaque handle.
2. The engine is multiplexer-neutral (renamed), depends on the seam, and **preserves all
   security-critical command-builder flags verbatim** (§3.2 / §5.1).
3. Stale comments fixed: engine header (`:6`), Codex "single-user" comment (`:238-240`),
   `types.ts` "JWT" (`:25`).
4. `!`-escape rejected on every input path; `PreToolUse` policy (§6) seeded per agent home with the
   three required behaviors.
5. Per-user neutral dirs created `0700`; `TmuxIo.run` env/cwd + `transcriptGlobDir` homeBase seams
   added (default-noop).
6. §8 shared-uid limitation documented in the module README and linked from epic #47.
7. `pnpm verify:foundation` green; file-size gate green; no new migration.
