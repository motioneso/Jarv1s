# P-02a Headless One-Shot Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Run Claude and Agy non-interactive turns as detached child processes with local, deny-unknown Claude permissions and no blocking approval card.

**Architecture:** Keep the interactive CliChatEngineImpl, CLAUDE_PERMISSION_HOOK_SOURCE, writeClaudePermissionHook, and their deadline ordering unchanged. Add a separate generated Claude hook whose synchronous allowlist covers Jarv1s MCP, vault reads, and writes inside the session/declared roots; launch both print engines with bash -lc through Node child_process.spawn and use the returned child handle for lifecycle operations. The existing Codex exec --json path is already headless with shell/apply-patch disabled and approval set to never, so it receives verification only.

**Tech Stack:** TypeScript, Node child_process.spawn, generated Claude PreToolUse hook, Vitest, pnpm foundation gate.

---

## File Map

- Modify packages/chat/src/live/claude-permission-hook.ts: add the parallel one-shot hook writer/source; do not edit the existing interactive source or deadline constants.
- Modify packages/chat/src/live/claude-print-chat-engine.ts: replace mux launch/lifecycle with detached child-process launch/lifecycle and use --permission-mode dontAsk plus the one-shot hook.
- Modify packages/chat/src/live/agy-print-chat-engine.ts: replace mux launch/lifecycle with the same detached child-process boundary while preserving the existing Agy print/permission flags and transcript identity flow.
- Modify tests/unit/claude-permission-hook.test.ts: add subprocess tests for local allow/deny; retain all interactive-hook tests unchanged.
- Modify tests/unit/claude-print-chat-engine.test.ts: mock spawn, assert no mux pane opens, assert the Claude command/permission mode, and assert child lifecycle signals.
- Modify tests/unit/agy-print-chat-engine.test.ts: mock spawn, assert no mux pane opens and assert child lifecycle signals while preserving transcript/purge tests.
- Do not modify packages/chat/src/live/cli-launch-commands.ts or packages/chat/src/live/cli-chat-engine.ts; those are the interactive fallback and Codex/shared launch paths.

## Task 1: Add the failing one-shot permission tests

Files:

- Modify tests/unit/claude-permission-hook.test.ts
- Seam: the generated hook process receives one Claude PreToolUse JSON event and returns a structured allow or deny decision with exit code 0.

- [ ] Step 1: Add a one-shot hook runner that writes CLAUDE_ONE_SHOT_PERMISSION_HOOK_SOURCE to a temporary file. Use the existing runHook subprocess helper shape, but pass only JARVIS_SESSION_ROOT and optionally JARVIS_NOTES_ROOTS; do not provide a gateway URL or token.

- [ ] Step 2: Add red tests for the approved policy:

```ts
it.each([
  ["Read", { file_path: "/vault/a.md" }],
  ["Glob", { pattern: "/vault/**/*.md" }],
  ["Grep", { path: "/vault" }]
])("one-shot allows %s under JARVIS_NOTES_ROOTS", async (tool_name, tool_input) => {
  const result = await runOneShotHook(
    { tool_name, tool_input },
    { JARVIS_SESSION_ROOT: "/tmp/session", JARVIS_NOTES_ROOTS: "/vault" }
  );
  expect(result.code).toBe(0);
  expect(result.decision).toBe("allow");
});

it.each(["Write", "Edit", "MultiEdit", "NotebookEdit"])(
  "one-shot allows %s inside the session root",
  async (tool_name) => {
    const result = await runOneShotHook(
      { tool_name, tool_input: { file_path: "/tmp/session/output.md" } },
      { JARVIS_SESSION_ROOT: "/tmp/session" }
    );
    expect(result.decision).toBe("allow");
  }
);

it("one-shot allows Jarv1s MCP without a gateway round-trip", async () => {
  const result = await runOneShotHook(
    { tool_name: "mcp__jarvis__get_notes", tool_input: {} },
    { JARVIS_SESSION_ROOT: "/tmp/session" }
  );
  expect(result.decision).toBe("allow");
});

it.each([
  ["Bash", { command: "echo hi" }],
  ["Write", { file_path: "/etc/jarvis.conf" }],
  ["Read", { file_path: "/etc/passwd" }],
  ["WebFetch", { url: "https://example.com" }]
])("one-shot denies %s without a card", async (tool_name, tool_input) => {
  const result = await runOneShotHook(
    { tool_name, tool_input },
    { JARVIS_SESSION_ROOT: "/tmp/session", JARVIS_NOTES_ROOTS: "/vault" }
  );
  expect(result.code).toBe(0);
  expect(result.decision).toBe("deny");
});
```

Also assert the generated one-shot source/settings contain no gateway POST/deadline/token mechanism and that the settings command exports the session root.

- [ ] Step 3: Run only the new tests and verify they fail because the one-shot source/writer is absent.

Run: pnpm exec vitest run tests/unit/claude-permission-hook.test.ts

Expected: FAIL during import or helper setup because the new one-shot exports do not exist; the pre-existing interactive tests remain the compatibility target.

## Task 2: Implement the local one-shot permission hook

Files:

- Modify packages/chat/src/live/claude-permission-hook.ts
- Test tests/unit/claude-permission-hook.test.ts

- [ ] Step 1: Add a separate writer and generated source without changing the interactive path.

Add ClaudeOneShotPermissionHookOpts, writeClaudeOneShotPermissionHook, and CLAUDE_ONE_SHOT_PERMISSION_HOOK_SOURCE. The writer must create the existing per-session hook/settings filenames, write only the hook/settings files, chmod both to 600, remove both on chmod failure, and return the settings path. Its settings command must be equivalent to:

```ts
const command = [
  "JARVIS_SESSION_ROOT=" + shellQuote(opts.neutralDir),
  "node",
  shellQuote(hookPath)
].join(" ");
```

The generated source must synchronously decide:

```js
if (tool.startsWith("mcp__jarvis__")) decide("allow", "pre-approved Jarv1s MCP tool");
if (safeVaultRead(tool, input)) decide("allow", "pre-approved read-only vault path");
if (safeWorkspaceWrite(tool, input)) decide("allow", "pre-approved session workspace write");
decide(
  "deny",
  tool === "Bash" ? "Bash is disabled for one-shot turns" : "tool not allowed for one-shot turns"
);
```

Reuse the existing source's validRoot, roots, underRoot, readCandidate, and safeVaultRead path rules in the new generated source. safeWorkspaceWrite must accept Write, Edit, MultiEdit, and NotebookEdit, extract file_path/notebook_path/path, and allow only normalized absolute candidates under JARVIS_SESSION_ROOT or a valid JARVIS_NOTES_ROOTS entry. Parse failures and uncaught errors must return structured deny with exit code 0. Do not import HTTP modules, read a token file, call /internal/permission, or add a timeout.

- [ ] Step 2: Run the focused hook tests and verify green.

Run: pnpm exec vitest run tests/unit/claude-permission-hook.test.ts

Expected: all existing interactive deadline/gateway tests and the new local allow/deny cases pass.

## Task 3: Make Claude print headless and use local auto-permission

Files:

- Modify packages/chat/src/live/claude-print-chat-engine.ts
- Modify tests/unit/claude-print-chat-engine.test.ts

- [ ] Step 1: Add a red headless lifecycle test with a mocked child process.

Mock node:child_process spawn while retaining actual module exports. The fake child exposes exitCode null, signalCode null, kill, on, and unref. After submit("hello"), assert:

```ts
expect(spawn).toHaveBeenCalledWith(
  "bash",
  ["-lc", expect.stringContaining("claude -p")],
  expect.objectContaining({
    cwd: "/tmp/jarvis-neutral",
    detached: true,
    stdio: "ignore"
  })
);
expect(mux.opened).toEqual([]);
```

The command must contain --permission-mode dontAsk, the one-shot settings path, --allowedTools, and --strict-mcp-config, and must not contain --permission-mode default. Assert isAlive() is true, interrupt() calls child.kill("SIGINT"), and kill() calls child.kill() then clears the process.

- [ ] Step 2: Run the Claude engine tests and verify the new lifecycle test fails.

Run: pnpm exec vitest run tests/unit/claude-print-chat-engine.test.ts

Expected: the current implementation still calls mux.open and emits --permission-mode default.

- [ ] Step 3: Replace mux launch/lifecycle with detached spawn.

Import spawn and ChildProcess from node:child_process, store ChildProcess or null, and leave readNew() unchanged. In submit(), build the command as before, then launch:

```ts
this.currentProcess = spawn("bash", ["-lc", launchLine], {
  cwd: this.launchOpts.neutralDir,
  detached: true,
  stdio: "ignore"
});
this.currentProcess.on("error", () => undefined);
this.currentProcess.unref();
this.hasSubmitted = true;
```

Use currentProcess.exitCode === null && currentProcess.signalCode === null for isAlive(), send SIGINT from interrupt(), and call the process handle's default kill() from kill() before clearing it. Do not call any mux method.

- [ ] Step 4: Wire the Claude one-shot hook and no-prompt mode.

Replace the writeClaudePermissionHook call in this engine only with writeClaudeOneShotPermissionHook, keep --allowedTools and --strict-mcp-config, and change --permission-mode default to --permission-mode dontAsk. Keep MCP config writing, prompt/transcript paths, readNew(), and the interactive cli-launch-commands.ts path unchanged.

- [ ] Step 5: Run the focused Claude tests and typecheck the package.

Run:

```bash
pnpm exec vitest run tests/unit/claude-print-chat-engine.test.ts tests/unit/claude-permission-hook.test.ts
pnpm typecheck
```

Expected: focused tests pass and TypeScript reports no errors.

## Task 4: Make Agy print headless and verify Codex

Files:

- Modify packages/chat/src/live/agy-print-chat-engine.ts
- Modify tests/unit/agy-print-chat-engine.test.ts
- Inspect only packages/chat/src/live/codex-exec-session.ts and packages/chat/src/live/cli-launch-commands.ts

- [ ] Step 1: Add a red Agy no-pane/process-lifecycle test.

Use the same mocked child-process seam. After submit("read ./word.txt"), assert mux.opened is empty, spawn is called with bash -lc, cwd is the neutral directory, detached is true, stdio is ignored, and the command still contains agy --dangerously-skip-permissions --print and its log path. Assert the same isAlive, SIGINT, and default kill() behavior as Claude.

- [ ] Step 2: Run the Agy test and verify it fails on mux.open.

Run: pnpm exec vitest run tests/unit/agy-print-chat-engine.test.ts

Expected: the new no-pane assertion fails against the current mux-backed launch.

- [ ] Step 3: Replace Agy mux launch/lifecycle with detached spawn.

Keep Agy's existing captureAgyConversationIdentity call, continuation flag, transcript path resolution, purge behavior, and --dangerously-skip-permissions print command. Only replace mux.open, MuxHandle, isAlive, interrupt, and kill with the Claude child-process pattern. Leave readNew() unchanged.

- [ ] Step 4: Run Agy, Claude, and Codex-focused tests.

Run: pnpm exec vitest run tests/unit/agy-print-chat-engine.test.ts tests/unit/claude-print-chat-engine.test.ts tests/unit/cli-chat-engine.test.ts

Expected: both print engines have no pane calls; Codex tests remain green. Confirm from CodexExecSession.buildCommand() that codex exec --json, features.shell_tool=false, features.apply_patch_tool=false, -a never, and approval_policy="never" remain in force. No Codex code change is needed.

## Task 5: Review, fresh-gate verification, and local commit

Files:

- Modify only the files listed above; do not touch interactive permission code or unrelated generated artifacts.

- [ ] Step 1: Run the changed-file unit suite.

Run: pnpm exec vitest run tests/unit/claude-permission-hook.test.ts tests/unit/claude-print-chat-engine.test.ts tests/unit/agy-print-chat-engine.test.ts

Expected: PASS, including interactive hook deadline ordering and all new local permission/headless lifecycle checks.

- [ ] Step 2: Re-index meaningful code edits.

Run: codegraph sync .

Do not stage .codegraph or other ignored index data.

- [ ] Step 3: Reset the per-agent gate database and run the full foundation gate.

Use the repo's existing per-agent gate database naming/connection environment. Drop and recreate only that database, then run:

```bash
pnpm verify:foundation
```

Expected: exit code 0 on the fresh gate DB. Record the exact gate exit code in the handoff report.

- [ ] Step 4: Review the diff for scope and release-note language.

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Confirm the diff leaves CLAUDE_PERMISSION_HOOK_SOURCE, writeClaudePermissionHook, the deadline constants, cli-launch-commands.ts, and the interactive engine untouched. Use release-note commit text:

```text
fix(chat): make one-shot CLI turns headless and non-blocking

One-shot Claude and Agy turns now run without opening a Herdr/tmux pane;
Claude allows safe local operations without approval cards and denies Bash.
```

- [ ] Step 5: Commit locally on build/p02a-headless-oneshot.

Stage only the plan, implementation, and focused test files:

```bash
git add docs/superpowers/plans/2026-07-23-p02a-headless-oneshot.md \
  packages/chat/src/live/claude-permission-hook.ts \
  packages/chat/src/live/claude-print-chat-engine.ts \
  packages/chat/src/live/agy-print-chat-engine.ts \
  tests/unit/claude-permission-hook.test.ts \
  tests/unit/claude-print-chat-engine.test.ts \
  tests/unit/agy-print-chat-engine.test.ts
git commit -m "fix(chat): make one-shot CLI turns headless and non-blocking"
git rev-parse HEAD
```

Do not push, merge, close #1242, or mark Ben's UAT/sign-off complete. Report the commit SHA, foundation-gate exit code, and Codex verification finding, then stop for coordinator review and Ben UAT.

## Self-review against spec §9

- §9.2 headless child process: Tasks 3 and 4 replace both print-engine mux launches and lifecycle methods.
- §9.3/§9.5 permission policy: Tasks 1 and 2 cover MCP/vault/session writes, Bash denial, out-of-root denial, and deny-unknown with no gateway/deadline.
- §9.4 Claude flags: Task 3 selects dontAsk, retains --allowedTools/--strict-mcp-config, and changes only the one-shot builder.
- §9.4 Agy/Codex: Task 4 changes Agy and verifies the already-headless Codex exec --json command.
- Interactive #1157/#1158 path: File map and Tasks 3/5 explicitly preserve its source, writer, deadline ordering, and shared interactive launch builder.
- Exit gate: Task 5 runs focused tests and pnpm verify:foundation on a fresh gate DB before the local-only commit.
