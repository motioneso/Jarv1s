# Portable CLI Chat Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal-CLI chat engine portable by hiding the multiplexer behind a small `Multiplexer` seam (tmux + herdr backends), preserving the locked constrained-launch security posture exactly.

**Architecture:** Introduce a 5-verb `Multiplexer` interface in `@jarv1s/ai`. The engine delegates session lifecycle (open/submit/isAlive/kill) to an injected `Multiplexer` and stores the **opaque handle** that `open()` returns (tmux: a stable session name; herdr: a server-assigned pane id). The engine keeps owning file/transcript I/O via the existing `TmuxIo` seam. The default backend is `TmuxMultiplexer(io)`, which reproduces today's exact tmux verb sequence — so every existing engine/manager test passes unchanged. The production factory selects the backend by PATH detection + env override.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest (`describe/it/expect/vi`), pnpm workspaces, `execFile` (never shell) via `TmuxIo`.

**Spec:** `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` (grounded on `5759b90`).

**Execution note:** This plan will be executed via an Ultracode workflow (not a Codex handoff). Run `pnpm db:up` once before the gate task; new unit tests need no DB. Do **not** `git add -A` — there is an in-flight `docs/coordination/` edit in the tree; stage explicit paths only.

---

## File Structure

**New files**

- `packages/ai/src/adapters/multiplexer.ts` — `MuxHandle` type + `Multiplexer` interface (the seam).
- `packages/ai/src/adapters/tmux-multiplexer.ts` — `TmuxMultiplexer` backend (default).
- `packages/ai/src/adapters/herdr-multiplexer.ts` — `HerdrMultiplexer` backend.
- `packages/ai/src/adapters/multiplexer-select.ts` — `selectMultiplexer(io)`: PATH/env backend choice.
- `packages/chat/src/live/pretooluse-policy.ts` — agent-path PreToolUse policy provisioning.
- `tests/unit/ai-tmux-multiplexer.test.ts`
- `tests/unit/ai-herdr-multiplexer.test.ts`
- `tests/unit/ai-multiplexer-select.test.ts`
- `tests/unit/chat-pretooluse-policy.test.ts`

**Modified files**

- `packages/ai/src/adapters/tmux-bridge.ts` — add optional `env`/`cwd` to `RunOptions`; add optional `homeBase` to `transcriptGlobDir`.
- `packages/ai/src/index.ts` — barrel-export the new multiplexer modules.
- `packages/chat/src/live/cli-chat-engine.ts` — delegate session verbs to `Multiplexer`; store handle; rename class; fix stale comments; provision policy at launch.
- `packages/chat/src/live/types.ts` — fix the stale "JWT" comment on `mcpToken`.
- `packages/chat/src/live/runtime.ts` — factory constructs the engine with a selected multiplexer; update import to the renamed class.
- `packages/chat/src/live/persona.ts` — create per-user neutral dir with mode `0700`.
- `tests/unit/cli-chat-engine.test.ts`, `tests/unit/chat-live-engine.test.ts` — update the import to the renamed class (no behavioral change).
- `tests/unit/chat-live-persona.test.ts` — assert the `0700` mode.

**Flagged for the `/grill-me-codex` review (scope/value calls, not gaps):**

- **Task 8 (HerdrMultiplexer):** herdr has no direct "new detached session" primitive — `open()` must `pane split` from a root pane and parse a server-assigned id. Higher integration risk than tmux; unit-tested at the verb-sequence level only.
- **Task 11 (PreToolUse policy):** the `!`-escape is **already** enforced on every programmatic path (all input funnels through `engine.submit` → `sanitizeInput`). The policy's only additive value is a tool-call denylist behind the already-locked `--tools ""` / MCP-allowlist. Lower value, provider-specific. Isolated as the last functional task so it can be cut cleanly if the review judges it YAGNI.

---

## Task 1: `Multiplexer` seam interface

**Files:**
- Create: `packages/ai/src/adapters/multiplexer.ts`

- [ ] **Step 1: Write the interface**

```ts
/**
 * Multiplexer seam — the portable abstraction over the terminal multiplexer that
 * hosts a live CLI chat session. Two backends implement it: TmuxMultiplexer
 * (default) and HerdrMultiplexer. The chat engine depends on this interface, not
 * on tmux/herdr verbs, so a deployed instance can drive whichever multiplexer the
 * host provides (ADR 0008).
 *
 * KEY ASYMMETRY: tmux session names are caller-chosen and stable; herdr pane ids
 * are server-assigned and opaque. So `open()` RETURNS the handle the engine must
 * STORE and pass back to submit/isAlive/kill. Callers must never reconstruct an
 * address from the `name` hint.
 */

/** Opaque, backend-assigned session handle. Callers store it; never parse it. */
export type MuxHandle = string;

export interface MuxOpenOpts {
  /** A human-readable name hint. tmux uses it as the handle; herdr ignores it. */
  readonly name: string;
  /** Terminal width in columns. */
  readonly cols: number;
  /** Terminal height in rows. */
  readonly rows: number;
  /** The single shell line to run in the session (e.g. `cd <dir> && claude ...`). */
  readonly launchLine: string;
}

export interface Multiplexer {
  readonly kind: "tmux" | "herdr";
  /** Launch a detached session running `launchLine`; return the handle to store. */
  open(opts: MuxOpenOpts): Promise<MuxHandle>;
  /** Paste `text` into the session and submit it (Enter). */
  submit(handle: MuxHandle, text: string): Promise<void>;
  /** Is the session still running? */
  isAlive(handle: MuxHandle): Promise<boolean>;
  /** Terminate the session. Idempotent — killing an absent session is not an error. */
  kill(handle: MuxHandle): Promise<void>;
  /** Human-runnable shell command to attach for steering. Display-only; never executed by us. */
  attachCommand(handle: MuxHandle): string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (interface-only; no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/adapters/multiplexer.ts
git commit -m "feat(ai): add Multiplexer seam interface (Phase 2 portable chat adapter)"
```

---

## Task 2: `TmuxIo` env/cwd + `transcriptGlobDir` homeBase seams

These additive options are no-ops today; they let the deferred uid-per-user milestone thread a per-user `HOME`/env without re-opening the seam (spec §5.2, §9).

**Files:**
- Modify: `packages/ai/src/adapters/tmux-bridge.ts`
- Test: `tests/unit/ai-tmux-bridge.test.ts`

- [ ] **Step 1: Read the current seam**

Read `packages/ai/src/adapters/tmux-bridge.ts:11-53` and `:75-97`. Confirm `TmuxIo.run(cmd, args)` and `transcriptGlobDir(provider, cwd)` signatures.

- [ ] **Step 2: Write failing tests**

Append to `tests/unit/ai-tmux-bridge.test.ts`:

```ts
import { createRealTmuxIo } from "../../packages/ai/src/adapters/tmux-bridge.js";

describe("createRealTmuxIo — env/cwd passthrough", () => {
  it("run() accepts an optional opts arg without throwing (env/cwd are optional)", async () => {
    const io = createRealTmuxIo();
    // `true` is a real binary that ignores args; opts must be accepted by the type + at runtime.
    const res = await io.run("true", [], { env: { JARVIS_TEST: "1" }, cwd: "/tmp" });
    expect(res.code).toBe(0);
  });
});

describe("transcriptGlobDir — homeBase override", () => {
  it("uses the provided homeBase instead of the OS homedir", () => {
    const dir = transcriptGlobDir("anthropic", "/tmp/x", "/custom/home");
    expect(dir.startsWith("/custom/home/.claude/projects/")).toBe(true);
  });

  it("defaults to the OS homedir when homeBase is omitted (unchanged behavior)", () => {
    const dir = transcriptGlobDir("anthropic", "~/Jarv1s/apps/worker");
    expect(dir).toContain("/.claude/projects/-home-ben-Jarv1s-apps-worker");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts`
Expected: FAIL — `run()` 3rd arg is not in the type / `transcriptGlobDir` ignores the 3rd arg.

- [ ] **Step 4: Implement the seams**

In `packages/ai/src/adapters/tmux-bridge.ts`, extend the `TmuxIo.run` signature and `createRealTmuxIo`. Add a `RunOptions` type and thread it into `execFileAsync`:

```ts
export interface RunOptions {
  /** Extra environment variables, merged over process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Working directory for the child process. */
  readonly cwd?: string;
}
```

Update the `TmuxIo` interface `run` member to:

```ts
  run(cmd: string, args: readonly string[], opts?: RunOptions): Promise<{ code: number; stdout: string; stderr?: string }>;
```

In `createRealTmuxIo()`, pass options through to `execFileAsync`:

```ts
    run: async (cmd, args, opts) => {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [...args], {
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          cwd: opts?.cwd
        });
        return { code: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr };
      }
    },
```

> Preserve the existing error-shaping behavior (non-zero `code`, captured stdout/stderr). Match the current implementation's exact return shape — only the `opts` passthrough is new.

Update `transcriptGlobDir`:

```ts
export function transcriptGlobDir(provider: ProviderKind, cwd: string, homeBase: string = homedir()): string {
```

Replace the three internal `homedir()` uses (anthropic, codex, google branches) with `homeBase`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/ai-tmux-bridge.test.ts`
Expected: PASS (new + all pre-existing cases).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/adapters/tmux-bridge.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat(ai): add optional env/cwd to TmuxIo.run and homeBase to transcriptGlobDir"
```

---

## Task 3: `TmuxMultiplexer` backend (default)

Reproduces today's exact tmux verb sequence so it is a behavior-preserving extraction.

**Files:**
- Create: `packages/ai/src/adapters/tmux-multiplexer.ts`
- Test: `tests/unit/ai-tmux-multiplexer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { TmuxMultiplexer } from "../../packages/ai/src/adapters/tmux-multiplexer.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

function calls(io: ReturnType<typeof makeIo>) {
  return io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
}

describe("TmuxMultiplexer", () => {
  it("open() creates a detached session and sends the launch line, returning the name as handle", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    const handle = await mux.open({ name: "jarv1s-live-x", cols: 220, rows: 50, launchLine: "cd '/n' && claude --tools \"\"" });

    expect(handle).toBe("jarv1s-live-x");
    const flat = calls(io);
    expect(flat.some((c) => c.startsWith("tmux new-session -d -s jarv1s-live-x -x 220 -y 50"))).toBe(true);
    expect(flat.some((c) => c.startsWith("tmux send-keys -t jarv1s-live-x") && c.endsWith("Enter"))).toBe(true);
  });

  it("submit() loads+pastes a buffer then sends Enter as a separate step", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    await mux.submit("jarv1s-live-x", "hello");

    const flat = calls(io);
    const pasteIdx = flat.findIndex((c) => c.includes("paste-buffer"));
    const enterIdx = flat.findIndex((c) => c.includes("send-keys") && c.includes("Enter"));
    expect(pasteIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(pasteIdx);
    expect(io.writeFile).toHaveBeenCalledTimes(1); // prompt written to a temp file before paste
  });

  it("isAlive() maps has-session exit code to a boolean", async () => {
    const io = makeIo();
    io.run.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const mux = new TmuxMultiplexer(io);
    expect(await mux.isAlive("jarv1s-live-x")).toBe(true);

    io.run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    expect(await mux.isAlive("jarv1s-live-x")).toBe(false);
  });

  it("kill() kills the session", async () => {
    const io = makeIo();
    const mux = new TmuxMultiplexer(io);
    await mux.kill("jarv1s-live-x");
    expect(calls(io).some((c) => c.startsWith("tmux kill-session -t jarv1s-live-x"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable tmux attach line", () => {
    const mux = new TmuxMultiplexer(makeIo());
    expect(mux.attachCommand("jarv1s-live-x")).toBe("tmux attach -t jarv1s-live-x");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-tmux-multiplexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * TmuxMultiplexer — the default Multiplexer backend. Reproduces the exact tmux
 * verb sequence the chat engine used inline before the seam was introduced, so it
 * is a behavior-preserving extraction. tmux session names are stable, so the
 * handle IS the session name (the `name` hint passed to open()).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";

export interface TmuxMultiplexerOpts {
  /** ms to let a bracketed paste settle before sending Enter. */
  readonly submitMs?: number;
}

export class TmuxMultiplexer implements Multiplexer {
  readonly kind = "tmux" as const;
  private readonly submitMs: number;

  constructor(private readonly io: TmuxIo, opts: TmuxMultiplexerOpts = {}) {
    this.submitMs = opts.submitMs ?? 600;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    await this.io.run("tmux", [
      "new-session", "-d", "-s", opts.name, "-x", String(opts.cols), "-y", String(opts.rows)
    ]);
    await this.io.run("tmux", ["send-keys", "-t", opts.name, opts.launchLine, "Enter"]);
    return opts.name;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    const promptFile = join(tmpdir(), `jarv1s-live-prompt-${handle}.txt`);
    const bufferName = handle;
    await this.io.writeFile(promptFile, text);
    await this.io.run("tmux", ["load-buffer", "-b", bufferName, promptFile]);
    await this.io.run("tmux", ["paste-buffer", "-b", bufferName, "-t", handle]);
    await this.io.sleep(this.submitMs);
    await this.io.run("tmux", ["send-keys", "-t", handle, "Enter"]);
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("tmux", ["has-session", "-t", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    await this.io.run("tmux", ["kill-session", "-t", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    return `tmux attach -t ${handle}`;
  }
}
```

> Note: the prompt temp file moves here from the engine. The buffer name stays `= handle` so the verb shape matches the engine's pre-refactor `bufferName = jarv1s-live-${threadKey}` (the handle is that same string). `submitMs` default 600 matches the engine's old default.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-tmux-multiplexer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/tmux-multiplexer.ts tests/unit/ai-tmux-multiplexer.test.ts
git commit -m "feat(ai): add TmuxMultiplexer backend (behavior-preserving tmux extraction)"
```

---

## Task 4: `selectMultiplexer` — PATH/env backend choice

**Files:**
- Create: `packages/ai/src/adapters/multiplexer-select.ts`
- Test: `tests/unit/ai-multiplexer-select.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { selectMultiplexer } from "../../packages/ai/src/adapters/multiplexer-select.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    sleep: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
  };
}

describe("selectMultiplexer", () => {
  it("honors JARVIS_MULTIPLEXER=herdr", () => {
    const mux = selectMultiplexer(makeIo(), { JARVIS_MULTIPLEXER: "herdr" });
    expect(mux.kind).toBe("herdr");
  });

  it("honors JARVIS_MULTIPLEXER=tmux", () => {
    const mux = selectMultiplexer(makeIo(), { JARVIS_MULTIPLEXER: "tmux" });
    expect(mux.kind).toBe("tmux");
  });

  it("defaults to tmux when no override is set", () => {
    const mux = selectMultiplexer(makeIo(), {});
    expect(mux.kind).toBe("tmux");
  });

  it("throws a clear error on an unknown value", () => {
    expect(() => selectMultiplexer(makeIo(), { JARVIS_MULTIPLEXER: "screen" })).toThrow(/JARVIS_MULTIPLEXER/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-multiplexer-select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Selects the Multiplexer backend for a live session. Explicit env override
 * (JARVIS_MULTIPLEXER=tmux|herdr) wins; otherwise default to tmux (least
 * surprise, matches pre-Phase-2 behavior). PATH auto-detection is layered in by
 * onboarding later; for now the default + override covers every deploy.
 */
import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer } from "./multiplexer.js";
import { TmuxMultiplexer } from "./tmux-multiplexer.js";
import { HerdrMultiplexer } from "./herdr-multiplexer.js";

export function selectMultiplexer(io: TmuxIo, env: NodeJS.ProcessEnv = process.env): Multiplexer {
  const choice = env.JARVIS_MULTIPLEXER?.trim().toLowerCase();
  switch (choice) {
    case undefined:
    case "":
    case "tmux":
      return new TmuxMultiplexer(io);
    case "herdr":
      return new HerdrMultiplexer(io);
    default:
      throw new Error(`JARVIS_MULTIPLEXER must be "tmux" or "herdr"; got "${choice}"`);
  }
}
```

> This imports `HerdrMultiplexer` (Task 8). Implement Task 8 before running this task's tests, or temporarily stub the import — recommended order is Task 8 then Task 4. (Listed here because it is the conceptual "selection" unit; execute Task 8 first.)

- [ ] **Step 4: Run to verify pass** (after Task 8 exists)

Run: `pnpm vitest run tests/unit/ai-multiplexer-select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/multiplexer-select.ts tests/unit/ai-multiplexer-select.test.ts
git commit -m "feat(ai): add selectMultiplexer backend chooser (env override, tmux default)"
```

---

## Task 5: Barrel-export the multiplexer modules

**Files:**
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Add exports**

After the existing `export * from "./adapters/tmux-bridge.js";` line, add:

```ts
export * from "./adapters/multiplexer.js";
export * from "./adapters/tmux-multiplexer.js";
export * from "./adapters/herdr-multiplexer.js";
export * from "./adapters/multiplexer-select.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/index.ts
git commit -m "feat(ai): export multiplexer seam + backends from package barrel"
```

---

## Task 6: Refactor the engine to delegate to `Multiplexer`

The core task. The engine stops issuing tmux verbs inline and instead calls an injected `Multiplexer`, storing the handle `open()` returns. The default mux is `TmuxMultiplexer(io)`, so the external `io.run` call sequence is unchanged → all existing engine tests pass without edits (other than the rename import in Task 7).

**Files:**
- Modify: `packages/chat/src/live/cli-chat-engine.ts`
- Modify: `packages/chat/src/live/types.ts`

- [ ] **Step 1: Fix the `types.ts` stale comment**

In `packages/chat/src/live/types.ts:25`, change the `mcpToken` comment from "per-session JWT" to:

```ts
  /** Opaque per-session MCP bearer token (jst_<uuid>), minted at launch. */
  readonly mcpToken?: string;
```

- [ ] **Step 2: Rewrite the engine header + class**

In `packages/chat/src/live/cli-chat-engine.ts`:

Replace the header comment (`:1-22`) — drop the stale `TmuxBridgeAdapter` reference; describe the multiplexer-neutral engine. Keep the SECURITY-CRITICAL flags block verbatim (lines documenting `--permission-mode default`, `--tools ""`, etc.).

Add imports:

```ts
import { Multiplexer, MuxHandle } from "@jarv1s/ai";
import { TmuxMultiplexer } from "@jarv1s/ai";
```

(or a single `import { ..., TmuxMultiplexer, type Multiplexer, type MuxHandle } from "@jarv1s/ai";`)

Rename `interface TmuxCliChatEngineOpts` → `CliChatEngineOpts` and add `mux`:

```ts
export interface CliChatEngineOpts {
  /** ms to let the CLI TUI finish booting before the first paste. */
  readonly launchMs?: number;
  /** ms to let a bracketed paste settle before sending Enter (passed to the default tmux backend). */
  readonly submitMs?: number;
  /** Multiplexer backend; defaults to a TmuxMultiplexer over the same io (preserves legacy behavior). */
  readonly mux?: Multiplexer;
}
```

Rename `class TmuxCliChatEngine` → `class CliChatEngineImpl`. Update the constructor:

```ts
export class CliChatEngineImpl implements CliChatEngine {
  private readonly launchMs: number;
  private readonly mux: Multiplexer;
  /** The opaque session handle returned by mux.open() at launch. */
  private handle: MuxHandle | null = null;

  /** Set at launch: the exact JSONL transcript path (session-id pinned). */
  private storedTranscriptPath: string | null = null;

  constructor(
    public readonly provider: ProviderKind,
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: CliChatEngineOpts = {}
  ) {
    this.launchMs = opts.launchMs ?? 3_000;
    this.mux = opts.mux ?? new TmuxMultiplexer(io, { submitMs: opts.submitMs ?? 600 });
  }
```

> Removed fields: `sessionName`, `submitMs`, `promptFile` (the buffer/temp-file lives in TmuxMultiplexer now). `SESSION_PREFIX` stays — it builds the `name` hint.

- [ ] **Step 3: Rewrite `launch()` to use the seam**

Keep `randomUUID()`, the google `.gemini/settings.json` special-case, and `storedTranscriptPath` derivation **verbatim**. Replace the two inline tmux calls (`new-session` + `send-keys`) with `mux.open`, store the handle, then sleep:

```ts
  async launch(opts: EngineLaunchOpts): Promise<void> {
    const sessionId = randomUUID();

    if (this.provider === "google" && opts.mcpToken && opts.mcpServerUrl) {
      // ... unchanged .gemini/settings.json block ...
    }

    this.storedTranscriptPath = join(
      transcriptGlobDir(this.provider, opts.neutralDir),
      `${sessionId}.jsonl`
    );

    const launchLine = this.buildLaunchCommand(opts, sessionId);
    this.handle = await this.mux.open({
      name: `${SESSION_PREFIX}${this.threadKey}`,
      cols: 220,
      rows: 50,
      launchLine
    });

    await this.io.sleep(this.launchMs);
  }
```

- [ ] **Step 4: Rewrite `submit()`, `isAlive()`, `kill()` to delegate**

```ts
  async submit(text: string): Promise<void> {
    const sanitized = sanitizeInput(text);
    await this.mux.submit(this.requireHandle(), sanitized);
  }

  async isAlive(): Promise<boolean> {
    if (this.handle === null) return false;
    return this.mux.isAlive(this.handle);
  }

  async kill(): Promise<void> {
    if (this.handle === null) return;
    await this.mux.kill(this.handle);
  }
```

Add a private guard near the other helpers:

```ts
  private requireHandle(): MuxHandle {
    if (this.handle === null) {
      throw new Error("CliChatEngineImpl.submit called before launch()");
    }
    return this.handle;
  }
```

> `sanitizeInput` stays in the engine — it is applied on the one programmatic input path before delegating to the backend (spec §5.1). `readNew()` and `transcriptPath()` are unchanged except for the error-message class name (`CliChatEngineImpl.…`).

- [ ] **Step 5: Fix the stale Codex comment**

In `buildCodexCommand`, replace the comment at the old `:238-240` ("accepted tradeoff for a local single-user session…") with:

```ts
    // Codex reads the Bearer token via bearer_token_env_var; there is no file-based injection
    // equivalent, so the token appears in the launch line and ps output. Under the household
    // model this is a shared-uid soft boundary (see the chat module README "Known security
    // limitation"); the token is short-lived, process-scoped, and RLS-scoped server-side.
```

Do **not** change any flag in `buildClaudeCommand` / `buildCodexCommand` / `buildGeminiCommand`.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL only in `runtime.ts` + the two test files that still import `TmuxCliChatEngine` (fixed in Tasks 7 & 9). The engine module itself must typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/live/cli-chat-engine.ts packages/chat/src/live/types.ts
git commit -m "refactor(chat): engine delegates session verbs to Multiplexer; store opaque handle"
```

---

## Task 7: Update engine tests to the renamed class (no behavior change)

**Files:**
- Modify: `tests/unit/cli-chat-engine.test.ts`
- Modify: `tests/unit/chat-live-engine.test.ts`

- [ ] **Step 1: Update imports + describe labels**

In both files, change:

```ts
import { TmuxCliChatEngine } from "../../packages/chat/src/live/cli-chat-engine.js";
```

to:

```ts
import { CliChatEngineImpl } from "../../packages/chat/src/live/cli-chat-engine.js";
```

Replace every `new TmuxCliChatEngine(` with `new CliChatEngineImpl(`. The `{ launchMs: 0, submitMs: 0 }` opts calls stay valid (4th positional arg is still `opts`). Update `describe("TmuxCliChatEngine` labels to `CliChatEngineImpl` for clarity (cosmetic).

- [ ] **Step 2: Run both engine test files**

Run: `pnpm vitest run tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts`
Expected: PASS — the default `TmuxMultiplexer(io)` reproduces the exact `io.run` tmux verb sequence (`new-session`, `send-keys ... Enter`, `load-buffer`/`paste-buffer`, `has-session`, `kill-session`) and the prompt `writeFile`, so every existing assertion holds.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts
git commit -m "test(chat): rename engine class refs to CliChatEngineImpl (no behavior change)"
```

---

## Task 8: `HerdrMultiplexer` backend

> **Review flag:** herdr has no direct "new detached session" verb. `open()` splits a pane from a root pane and parses the server-assigned, opaque `pane_id`; `pane get` checks liveness; `pane close` kills. Unit-tested at the verb-sequence level with a fake `TmuxIo`; the root-pane resolution + split-output parsing are the integration-risk surfaces.

**Files:**
- Create: `packages/ai/src/adapters/herdr-multiplexer.ts`
- Test: `tests/unit/ai-herdr-multiplexer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { HerdrMultiplexer } from "../../packages/ai/src/adapters/herdr-multiplexer.js";

function makeIo(overrides: Record<string, { code: number; stdout: string }> = {}) {
  const run = vi.fn(async (cmd: string, args: readonly string[]) => {
    const key = [cmd, ...args].join(" ");
    for (const prefix of Object.keys(overrides)) {
      if (key.startsWith(prefix)) return { code: overrides[prefix].code, stdout: overrides[prefix].stdout, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  return { run, sleep: vi.fn().mockResolvedValue(undefined), readFile: vi.fn().mockResolvedValue(""), writeFile: vi.fn().mockResolvedValue(undefined) };
}

describe("HerdrMultiplexer", () => {
  it("open() splits from the root pane, parses the new pane id, runs the launch line, and returns the id", async () => {
    const io = makeIo({
      "herdr pane list": { code: 0, stdout: "pane-root\n" },
      "herdr pane split": { code: 0, stdout: "pane-new-123\n" }
    });
    const mux = new HerdrMultiplexer(io, { rootPane: "pane-root" });
    const handle = await mux.open({ name: "jarv1s-live-x", cols: 220, rows: 50, launchLine: "cd '/n' && claude" });

    expect(handle).toBe("pane-new-123");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane split pane-root"))).toBe(true);
    expect(flat.some((c) => c.startsWith("herdr pane run pane-new-123"))).toBe(true);
  });

  it("submit() sends text then Enter to the pane handle", async () => {
    const io = makeIo();
    const mux = new HerdrMultiplexer(io, { rootPane: "pane-root" });
    await mux.submit("pane-new-123", "hello");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    const textIdx = flat.findIndex((c) => c.startsWith("herdr pane send-text pane-new-123"));
    const enterIdx = flat.findIndex((c) => c.startsWith("herdr pane send-keys pane-new-123") && c.includes("Enter"));
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThan(textIdx);
  });

  it("isAlive() maps `pane get` exit code to a boolean", async () => {
    const ioAlive = makeIo({ "herdr pane get pane-x": { code: 0, stdout: "{}" } });
    expect(await new HerdrMultiplexer(ioAlive, { rootPane: "r" }).isAlive("pane-x")).toBe(true);
    const ioDead = makeIo({ "herdr pane get pane-x": { code: 1, stdout: "" } });
    expect(await new HerdrMultiplexer(ioDead, { rootPane: "r" }).isAlive("pane-x")).toBe(false);
  });

  it("kill() closes the pane", async () => {
    const io = makeIo();
    await new HerdrMultiplexer(io, { rootPane: "r" }).kill("pane-x");
    const flat = io.run.mock.calls.map((c: unknown[]) => [c[0], ...(c[1] as string[])].join(" "));
    expect(flat.some((c) => c.startsWith("herdr pane close pane-x"))).toBe(true);
  });

  it("attachCommand() returns a human-runnable herdr attach hint", () => {
    const mux = new HerdrMultiplexer(makeIo(), { rootPane: "r" });
    expect(mux.attachCommand("pane-x")).toContain("herdr");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/ai-herdr-multiplexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * HerdrMultiplexer — Multiplexer backend over the herdr terminal workspace
 * manager (`herdr pane …` socket API). Unlike tmux, herdr has no "new detached
 * session" verb: a pane is split from an existing root pane and the server
 * assigns an OPAQUE pane id. open() therefore returns that id as the handle; the
 * engine stores it and never reconstructs it (the Multiplexer asymmetry).
 *
 * Root pane resolution: explicit opts.rootPane, else env JARVIS_HERDR_ROOT_PANE,
 * else the first id from `herdr pane list`.
 */
import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";

export interface HerdrMultiplexerOpts {
  /** Parent pane to split from; else JARVIS_HERDR_ROOT_PANE; else first `pane list`. */
  readonly rootPane?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class HerdrMultiplexer implements Multiplexer {
  readonly kind = "herdr" as const;
  private readonly rootPaneOverride?: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly io: TmuxIo, opts: HerdrMultiplexerOpts = {}) {
    this.rootPaneOverride = opts.rootPane;
    this.env = opts.env ?? process.env;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const root = await this.resolveRootPane();
    const split = await this.io.run("herdr", ["pane", "split", root, "--direction", "down", "--no-focus"]);
    const paneId = firstToken(split.stdout);
    if (!paneId) throw new Error("HerdrMultiplexer.open: could not parse new pane id from `herdr pane split`");
    await this.io.run("herdr", ["pane", "run", paneId, opts.launchLine]);
    return paneId;
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    await this.io.run("herdr", ["pane", "send-text", handle, text]);
    await this.io.run("herdr", ["pane", "send-keys", handle, "Enter"]);
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("herdr", ["pane", "get", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    await this.io.run("herdr", ["pane", "close", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    // herdr attaches to its persistent session; the pane lives inside it.
    return `herdr   # then focus pane ${handle}`;
  }

  private async resolveRootPane(): Promise<string> {
    if (this.rootPaneOverride) return this.rootPaneOverride;
    const envRoot = this.env.JARVIS_HERDR_ROOT_PANE?.trim();
    if (envRoot) return envRoot;
    const list = await this.io.run("herdr", ["pane", "list"]);
    const first = firstToken(list.stdout);
    if (!first) throw new Error("HerdrMultiplexer: no root pane (set JARVIS_HERDR_ROOT_PANE)");
    return first;
  }
}

/** First whitespace-delimited token of the first non-empty line. */
function firstToken(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const t = line.trim().split(/\s+/)[0];
    if (t) return t;
  }
  return null;
}
```

> The exact `herdr pane split` / `pane list` stdout shapes are integration assumptions (parsed by `firstToken`). If herdr's real output differs (e.g. JSON), the parser is the single point to adjust — call this out in the README and the grill review.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/ai-herdr-multiplexer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/adapters/herdr-multiplexer.ts tests/unit/ai-herdr-multiplexer.test.ts
git commit -m "feat(ai): add HerdrMultiplexer backend (pane split → opaque handle)"
```

---

## Task 9: Wire the factory to select the multiplexer

**Files:**
- Modify: `packages/chat/src/live/runtime.ts`

- [ ] **Step 1: Update import + factory**

Change the import (`:18`):

```ts
import { CliChatEngineImpl } from "./cli-chat-engine.js";
```

Add `createRealTmuxIo` and `selectMultiplexer` to the `@jarv1s/ai` import (`:12`):

```ts
import { AiRepository, createRealTmuxIo, selectMultiplexer, type ProviderKind } from "@jarv1s/ai";
```

Replace `realEngineFactory` (`:44-45`):

```ts
export const realEngineFactory: ChatEngineFactory = (provider, sessionKey) => {
  const io = createRealTmuxIo();
  return new CliChatEngineImpl(provider, sessionKey, io, { mux: selectMultiplexer(io) });
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the rename + factory now resolve).

- [ ] **Step 3: Run the manager + live-chat tests (fake engine path unaffected)**

Run: `pnpm vitest run tests/unit/chat-live-manager.test.ts`
Expected: PASS — the manager uses an injected fake engine; only the real factory changed.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/src/live/runtime.ts
git commit -m "feat(chat): real engine factory selects the multiplexer backend"
```

---

## Task 10: Create per-user neutral dir with mode `0700`

**Files:**
- Modify: `packages/chat/src/live/persona.ts`
- Test: `tests/unit/chat-live-persona.test.ts`

- [ ] **Step 1: Write a failing test**

The `PersonaFs.mkdir` seam takes only a path. Widen it to accept an optional mode and assert `renderPersona` requests `0700`. Append to `tests/unit/chat-live-persona.test.ts`:

```ts
it("creates the per-user neutral dir with mode 0700", async () => {
  const mkdirCalls: Array<{ path: string; mode?: number }> = [];
  const fs = {
    mkdir: async (path: string, mode?: number) => { mkdirCalls.push({ path, mode }); },
    writeFile: async () => {}
  };
  await renderPersona(fs, { userId: "u1", userName: "Ben", provider: "anthropic", baseDir: "/tmp/base", persona: "hi" });
  expect(mkdirCalls).toHaveLength(1);
  expect(mkdirCalls[0]?.mode).toBe(0o700);
});
```

> Check the existing test file's imports/`PersonaFs` fakes; update any inline fake `mkdir` signatures to `(path, mode?)` so they still satisfy the widened interface.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/chat-live-persona.test.ts`
Expected: FAIL — mode is `undefined`.

- [ ] **Step 3: Implement**

In `packages/chat/src/live/persona.ts`, widen the `PersonaFs.mkdir` member:

```ts
  /** Create a directory and any missing parents (recursive), with an optional mode. */
  mkdir(path: string, mode?: number): Promise<void>;
```

In `renderPersona`, pass the mode:

```ts
  await fs.mkdir(neutralDir, 0o700);
```

In `createRealPersonaFs`, honor it:

```ts
    mkdir: async (path: string, mode?: number) => {
      await mkdir(path, { recursive: true, mode });
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/chat-live-persona.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/persona.ts tests/unit/chat-live-persona.test.ts
git commit -m "feat(chat): create per-user neutral dir with mode 0700"
```

---

## Task 11: Agent-path PreToolUse policy (Claude path) — *review-flagged*

> **Review flag (scope/value):** `--tools ""` already disables all native tools; `--allowedTools "mcp__jarvis__*"` limits to MCP tools that are RLS-scoped server-side; the `!`-escape is already stripped on the one programmatic input path by `sanitizeInput`. This task adds a **defense-in-depth** PreToolUse hook (denies any tool call that is not an allowlisted `mcp__jarvis__*` call) provisioned into the anthropic neutral dir. It is isolated as the last functional task; if the grill review judges it YAGNI for v1, cut this task wholesale — nothing else depends on it.

**Files:**
- Create: `packages/chat/src/live/pretooluse-policy.ts`
- Test: `tests/unit/chat-pretooluse-policy.test.ts`
- Modify: `packages/chat/src/live/cli-chat-engine.ts` (provision at launch, anthropic only)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildClaudePreToolUseSettings, provisionAgentPolicy } from "../../packages/chat/src/live/pretooluse-policy.js";

describe("buildClaudePreToolUseSettings", () => {
  it("emits a PreToolUse hook that denies non-jarvis tool calls", () => {
    const settings = buildClaudePreToolUseSettings();
    const json = JSON.stringify(settings);
    expect(json).toContain("PreToolUse");
    expect(json).toContain("mcp__jarvis__");
  });
});

describe("provisionAgentPolicy", () => {
  it("writes the settings file under the neutral dir for the anthropic provider", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const io = { run: vi.fn().mockResolvedValue({ code: 0, stdout: "" }), sleep: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(async (p: string, c: string) => { writes.push({ path: p, content: c }); }) };
    await provisionAgentPolicy(io, "anthropic", "/tmp/neutral");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toContain("/tmp/neutral/.claude/settings.json");
  });

  it("is a no-op for codex (sandbox read-only already blocks) and gemini", async () => {
    const io = { run: vi.fn().mockResolvedValue({ code: 0, stdout: "" }), sleep: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() };
    await provisionAgentPolicy(io, "openai-compatible", "/tmp/n");
    await provisionAgentPolicy(io, "google", "/tmp/n");
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/chat-pretooluse-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Agent-path defense-in-depth: a Claude Code PreToolUse hook provisioned into the
 * per-user neutral dir. It denies any tool call that is not an allowlisted
 * mcp__jarvis__* call — a second lock behind `--tools ""` / `--allowedTools` in
 * case a flag ever regresses. This is AGENT-path only; it cannot constrain a human
 * who attaches to the shared-uid session (see the chat module README).
 *
 * Codex (`--sandbox read-only`, shell/apply_patch tools disabled) and Gemini
 * (`--allowed-mcp-server-names jarvis`) already deny native tools at launch, so
 * provisioning is a no-op for them in v1.
 */
import { join } from "node:path";

import type { ProviderKind, TmuxIo } from "@jarv1s/ai";

/** A minimal deny-by-default PreToolUse hook config for Claude Code. */
export function buildClaudePreToolUseSettings(): unknown {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              // Allow only mcp__jarvis__* tools; deny everything else (exit 2 blocks the call).
              command:
                'jq -e \'.tool_name | startswith("mcp__jarvis__")\' >/dev/null 2>&1 && exit 0 || { echo "blocked by jarvis policy" >&2; exit 2; }'
            }
          ]
        }
      ]
    }
  };
}

export async function provisionAgentPolicy(io: TmuxIo, provider: ProviderKind, neutralDir: string): Promise<void> {
  if (provider !== "anthropic") return; // codex/gemini blocked at launch flags in v1
  const dir = join(neutralDir, ".claude");
  await io.run("mkdir", ["-p", dir]);
  await io.writeFile(join(dir, "settings.json"), JSON.stringify(buildClaudePreToolUseSettings(), null, 2));
}
```

- [ ] **Step 4: Provision at launch**

In `packages/chat/src/live/cli-chat-engine.ts` `launch()`, after `storedTranscriptPath` is set and before `mux.open`, add:

```ts
    await provisionAgentPolicy(this.io, this.provider, opts.neutralDir);
```

Import it: `import { provisionAgentPolicy } from "./pretooluse-policy.js";`

> This adds one `mkdir` + one `writeFile` to the anthropic launch path. Verify the existing engine launch tests still pass (they assert on tmux `send-keys` / launch-line content and tolerate extra `io.run`/`writeFile` calls — confirm by re-running Task 7's tests).

- [ ] **Step 5: Run policy tests + re-run engine tests**

Run: `pnpm vitest run tests/unit/chat-pretooluse-policy.test.ts tests/unit/cli-chat-engine.test.ts tests/unit/chat-live-engine.test.ts`
Expected: PASS. If an engine test asserted an exact `writeFile` count, relax it to `>=` or filter to the prompt file — note any such change in the commit.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/pretooluse-policy.ts tests/unit/chat-pretooluse-policy.test.ts packages/chat/src/live/cli-chat-engine.ts
git commit -m "feat(chat): provision Claude PreToolUse deny-by-default policy (defense-in-depth)"
```

---

## Task 12: Document the shared-uid limitation

**Files:**
- Create or modify: `packages/chat/README.md`

- [ ] **Step 1: Add the section**

Add (creating the README if absent) a "Known security limitation — shared-uid" section that states: all live chat sessions run as one OS user; the agent path is contained (`--tools ""` / MCP-allowlist + `--strict-mcp-config` + the PreToolUse policy give an injected prompt no file/shell primitive); a **human who already holds a shell as the shared uid** can attach to any session and read any user's neutral dir / CLI auth; mitigations today (host-shell access is the operator's own, `0700` neutral dirs, secrets AES-256-GCM at rest and never in prompts/payloads); the real fix is the deferred uid-per-user milestone. Link to `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` §8.

- [ ] **Step 2: Commit**

```bash
git add packages/chat/README.md
git commit -m "docs(chat): document the shared-uid soft boundary (Phase 2 §8)"
```

---

## Task 13: Full gate + final verification

**Files:** none (verification only)

- [ ] **Step 1: Ensure Postgres is up**

Run: `pnpm db:up`
Expected: Postgres healthy (integration tests need it; new unit tests do not).

- [ ] **Step 2: Run the maintainability gate**

Run: `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck`
Expected: PASS. `check:file-size` confirms `cli-chat-engine.ts` is comfortably under 1000 lines (it shrank — verbs moved to backends).

- [ ] **Step 3: Run the affected unit + integration suites**

Run: `pnpm vitest run tests/unit/ tests/integration/chat-live-api.test.ts`
Expected: PASS. (Stop any `dev:worker` first — it steals pg-boss jobs.)

- [ ] **Step 4: Full foundation gate**

Run: `pnpm verify:foundation`
Expected: PASS (lint, format, file-size, typecheck, db:migrate, integration). No new migration was added — this is code-only.

- [ ] **Step 5: Final commit (if any gate fixups were needed)**

```bash
git add <explicit paths touched by fixups>
git commit -m "chore(chat): gate fixups for portable CLI chat adapter"
```

---

## Self-Review

**Spec coverage (spec §-by-§):**
- §4 Multiplexer seam → Tasks 1, 3, 8, 5 (barrel). ✓
- §4.1 opaque-handle return/store → Task 6 (`this.handle = await mux.open(...)`), Task 8 (herdr id). ✓
- §4.2 backend selection (PATH/env, tmux default) → Task 4. ✓ (PATH auto-detect deferred to onboarding; env override + default ships now — noted in Task 4.)
- §5.1 engine refactor, stale comments, sanitizeInput retained → Task 6. ✓
- §5.2 TmuxIo env/cwd + transcriptGlobDir homeBase → Task 2. ✓
- §5.3 types.ts JWT comment → Task 6 Step 1. ✓
- §5.4 runtime factory → Task 9. ✓
- §5.5 persona 0700 → Task 10. ✓
- §5.6 symmetric teardown unchanged → no code change; manager already calls kill+revoke (verified in spec). ✓
- §6 PreToolUse policy → Task 11 (anthropic; codex/gemini blocked at flags). ✓
- §7 attach posture → `attachCommand` in Tasks 3 & 8. ✓
- §8 shared-uid limitation doc → Task 12. ✓
- §9 deferred-milestone seams → Tasks 2 (env/homeBase), 6 & 8 (opaque handle), 10 (0700). ✓
- §11 testing → every task is TDD; gate in Task 13. ✓
- §13 acceptance criteria 1–7 → all mapped. ✓

**Placeholder scan:** No TBD/TODO. The herdr stdout parser (`firstToken`) and PATH auto-detect are explicitly scoped as integration assumptions / onboarding-deferred, not placeholders.

**Type consistency:** `Multiplexer`/`MuxHandle`/`MuxOpenOpts` (Task 1) used identically in Tasks 3, 6, 8. Class renamed `TmuxCliChatEngine`→`CliChatEngineImpl` consistently across Tasks 6, 7, 9. `TmuxIo.run` 3-arg signature (Task 2) is backward-compatible with all existing 2-arg callers. `PersonaFs.mkdir(path, mode?)` (Task 10) is backward-compatible.

**Execution-order note:** Task 4 imports `HerdrMultiplexer` (Task 8) — run Task 8 before Task 4's tests. All other tasks are in dependency order.
