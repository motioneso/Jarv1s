# Claude Non-Interactive Execution Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Anthropic/Claude provider configs honor `executionMode: "non_interactive"` by running `claude --print` through the existing live chat engine contract, with live parity validation after the Claude quota reset.

**Architecture:** Reuse the shared provider `executionMode` plumbing from #521 for admin UI, persistence, and routing. Add a Claude-specific print-mode `CliChatEngine` implementation that launches one print-mode Claude process per submitted turn inside the existing multiplexer boundary, reuses the existing Claude transcript JSONL parser, and resumes the same Claude session across turns.

**Tech Stack:** TypeScript, existing `CliChatEngine` interface, `Multiplexer`, `TmuxIo`, Claude Code CLI `--print`, Claude transcript JSONL, Vitest.

---

## Dependency

This plan should run after #521 lands the shared provider `executionMode` type/API/UI plumbing. If #521 is not merged yet, implement Task 1 and Task 2 only, then pause before runtime wiring.

Grounding docs:

- Spec: `docs/superpowers/specs/2026-06-26-claude-non-interactive-execution-mode.md`
- Shared spike: `docs/superpowers/specs/2026-06-26-provider-execution-mode-spike.md`
- Shared execution-mode plan: `docs/superpowers/plans/2026-06-26-codex-non-interactive-execution-mode.md`

## File Map

- Create: `packages/chat/src/live/claude-print-chat-engine.ts` - print-mode engine implementing `CliChatEngine`.
- Create: `tests/unit/claude-print-chat-engine.test.ts` - command shape and transcript read tests.
- Modify: `packages/chat/src/live/runtime.ts` - select Claude print engine for Anthropic `non_interactive`.
- Modify: `packages/chat/src/live/types.ts` - only if #521 has not already added factory-level `executionMode` threading.
- Modify: `tests/unit/ai-tmux-bridge.test.ts` only if live validation reveals a Claude print-only transcript shape.

## Task 1: Add Claude Print Engine Tests

**Files:**

- Create: `tests/unit/claude-print-chat-engine.test.ts`

- [ ] **Step 1: Create the fake I/O harness**

Create `tests/unit/claude-print-chat-engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ClaudePrintChatEngine } from "../../packages/chat/src/live/claude-print-chat-engine.js";
import type { Multiplexer, MuxHandle, TmuxIo } from "@jarv1s/ai";

function fakeIo(files: Record<string, string> = {}): TmuxIo & { writes: Record<string, string> } {
  return {
    writes: files,
    async run() {
      return { code: 0, stdout: "" };
    },
    async readFile(path) {
      const value = this.writes[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async writeFile(path, content) {
      this.writes[path] = content;
    },
    async sleep() {}
  };
}

function fakeMux(): Multiplexer & { opened: string[]; killed: MuxHandle[] } {
  return {
    kind: "tmux",
    opened: [],
    killed: [],
    async open(opts) {
      this.opened.push(opts.launchLine);
      return `handle-${this.opened.length}`;
    },
    async submit() {
      throw new Error("ClaudePrintChatEngine should open per-turn commands, not paste into a REPL");
    },
    async isAlive() {
      return true;
    },
    async kill(handle) {
      this.killed.push(handle);
    },
    attachCommand() {
      return "tmux attach";
    }
  };
}
```

- [ ] **Step 2: Add first-turn command test**

Add:

```ts
describe("ClaudePrintChatEngine", () => {
  it("runs the first submitted turn with claude print and a fixed session id", async () => {
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new ClaudePrintChatEngine("user-1", io, {
      mux,
      homeBase: "/home/test",
      sessionId: "00000000-0000-4000-8000-000000000001"
    });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona"
    });
    await engine.submit("hello");

    expect(mux.opened[0]).toContain("claude -p");
    expect(mux.opened[0]).toContain("--session-id 00000000-0000-4000-8000-000000000001");
    expect(mux.opened[0]).toContain("--permission-mode default");
    expect(mux.opened[0]).toContain("--strict-mcp-config");
    expect(mux.opened[0]).not.toContain("--no-session-persistence");
  });
});
```

- [ ] **Step 3: Add resume command test**

Add:

```ts
it("uses --resume on later submitted turns", async () => {
  const io = fakeIo();
  const mux = fakeMux();
  const engine = new ClaudePrintChatEngine("user-1", io, {
    mux,
    homeBase: "/home/test",
    sessionId: "00000000-0000-4000-8000-000000000001"
  });

  await engine.launch({
    neutralDir: "/tmp/jarvis-neutral",
    personaPath: "/tmp/jarvis-neutral/persona.md",
    personaText: "persona"
  });
  await engine.submit("first");
  await engine.submit("second");

  expect(mux.opened[1]).toContain("--resume 00000000-0000-4000-8000-000000000001");
});
```

- [ ] **Step 4: Add transcript read test**

Add:

```ts
it("reads Claude transcript JSONL through the existing parser", async () => {
  const transcriptPath =
    "/home/test/.claude/projects/-tmp-jarvis-neutral/00000000-0000-4000-8000-000000000001.jsonl";
  const transcript = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "claude print ok" }]
    }
  });
  const io = fakeIo({ [transcriptPath]: `${transcript}\n` });
  const mux = fakeMux();
  const engine = new ClaudePrintChatEngine("user-1", io, {
    mux,
    homeBase: "/home/test",
    sessionId: "00000000-0000-4000-8000-000000000001"
  });

  await engine.launch({
    neutralDir: "/tmp/jarvis-neutral",
    personaPath: "/tmp/jarvis-neutral/persona.md",
    personaText: "persona"
  });

  const result = await engine.readNew(0);

  expect(result.records).toEqual([{ kind: "reply", text: "claude print ok" }]);
  expect(result.complete).toBe(true);
  expect(result.offset).toBe(`${transcript}\n`.length);
});
```

- [ ] **Step 5: Run the failing tests**

Run:

```bash
pnpm vitest run tests/unit/claude-print-chat-engine.test.ts
```

Expected: FAIL because `ClaudePrintChatEngine` does not exist.

## Task 2: Implement `ClaudePrintChatEngine`

**Files:**

- Create: `packages/chat/src/live/claude-print-chat-engine.ts`

- [ ] **Step 1: Create the engine**

Create `packages/chat/src/live/claude-print-chat-engine.ts`:

```ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  parseTranscript,
  transcriptGlobDir,
  TmuxMultiplexer,
  type Multiplexer,
  type MuxHandle,
  type TmuxIo
} from "@jarv1s/ai";

import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";

const PROMPT_FILENAME = ".jarvis-claude-print-prompt.txt";
const PERSONA_FILENAME = "persona.md";
const CLAUDE_MCP_FILENAME = ".jarvis-claude-mcp.json";

export interface ClaudePrintChatEngineOpts {
  readonly mux?: Multiplexer;
  readonly homeBase?: string;
  readonly sessionId?: string;
  readonly credentialFile?: string;
}

export class ClaudePrintChatEngine implements CliChatEngine {
  readonly provider = "anthropic" as const;
  private readonly mux: Multiplexer;
  private readonly homeBase?: string;
  private readonly credentialFile?: string;
  private readonly sessionId: string;
  private neutralDir: string | null = null;
  private personaPath: string | null = null;
  private transcriptPathValue: string | null = null;
  private currentHandle: MuxHandle | null = null;
  private hasSubmitted = false;
  private launchOpts: EngineLaunchOpts | null = null;

  constructor(
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: ClaudePrintChatEngineOpts = {}
  ) {
    this.mux = opts.mux ?? new TmuxMultiplexer(io);
    this.homeBase = opts.homeBase;
    this.credentialFile = opts.credentialFile;
    this.sessionId = opts.sessionId ?? randomUUID();
  }

  async launch(opts: EngineLaunchOpts): Promise<{ offset: number }> {
    this.launchOpts = opts;
    this.neutralDir = opts.neutralDir;
    this.personaPath = await this.resolvePersonaPath(opts);
    const transcriptDir = transcriptGlobDir("anthropic", opts.neutralDir, this.homeBase);
    this.transcriptPathValue = join(transcriptDir, `${this.sessionId}.jsonl`);
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    if (this.neutralDir === null || this.personaPath === null || this.launchOpts === null) {
      throw new Error("ClaudePrintChatEngine.submit called before launch()");
    }
    const promptPath = join(this.neutralDir, PROMPT_FILENAME);
    await this.io.writeFile(promptPath, text.replace(/^(\s*)!+/, "$1"));
    const command = await this.buildCommand(this.launchOpts, promptPath);
    this.currentHandle = await this.mux.open({
      name: `jarv1s-live-${this.threadKey}`,
      cols: 220,
      rows: 50,
      launchLine: command
    });
    this.hasSubmitted = true;
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.transcriptPathValue === null)
      return { records: [], offset: afterOffset, complete: false };
    let jsonl: string;
    try {
      jsonl = await this.io.readFile(this.transcriptPathValue);
    } catch {
      return { records: [], offset: afterOffset, complete: false };
    }
    const parsed = parseTranscript("anthropic", jsonl, afterOffset);
    const records: TranscriptRecord[] = parsed.events.map((event) => ({
      kind: event.kind as ChatRecordKind,
      text: event.text
    }));
    if (parsed.complete && parsed.reply !== null)
      records.push({ kind: "reply", text: parsed.reply });
    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    return this.currentHandle !== null ? this.mux.isAlive(this.currentHandle) : false;
  }

  async kill(): Promise<void> {
    if (this.currentHandle !== null) await this.mux.kill(this.currentHandle);
    this.currentHandle = null;
  }

  private async resolvePersonaPath(opts: EngineLaunchOpts): Promise<string> {
    if (opts.personaText === undefined) return opts.personaPath;
    const path = join(opts.neutralDir, PERSONA_FILENAME);
    await this.io.writeFile(path, opts.personaText);
    await this.io.run("chmod", ["600", path]);
    return path;
  }

  private async buildCommand(opts: EngineLaunchOpts, promptPath: string): Promise<string> {
    const claudeCmd =
      this.credentialFile && this.credentialFile.length > 0
        ? `CLAUDE_CODE_OAUTH_TOKEN="$(cat ${shellQuote(this.credentialFile)})" claude`
        : "claude";
    const sessionFlag = this.hasSubmitted
      ? `--resume ${this.sessionId}`
      : `--session-id ${this.sessionId}`;
    const parts = [
      `cd ${shellQuote(opts.neutralDir)} &&`,
      claudeCmd,
      "-p",
      sessionFlag,
      "--permission-mode default"
    ];

    if (opts.mcpToken && opts.mcpServerUrl) {
      const mcpConfigPath = await this.writeClaudeMcpConfig(opts);
      parts.push(`--mcp-config ${shellQuote(mcpConfigPath)}`);
      parts.push('--allowedTools "mcp__jarvis__*"');
    } else {
      parts.push('--tools ""');
    }

    parts.push(
      `--append-system-prompt-file ${shellQuote(this.personaPath ?? opts.personaPath)}`,
      "--strict-mcp-config",
      `"$(cat ${shellQuote(promptPath)})"`
    );

    return parts.join(" ");
  }

  private async writeClaudeMcpConfig(opts: EngineLaunchOpts): Promise<string> {
    const path = join(opts.neutralDir, CLAUDE_MCP_FILENAME);
    const mcpConfig = JSON.stringify({
      mcpServers: {
        jarvis: {
          type: "http",
          url: opts.mcpServerUrl,
          headers: { Authorization: `Bearer ${opts.mcpToken}` },
          timeout: 180000
        }
      }
    });
    await this.io.writeFile(path, mcpConfig);
    const chmod = await this.io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await this.io.run("rm", ["-f", path]);
      throw new Error(`Could not lock down Claude MCP config file: ${chmod.stderr ?? ""}`.trim());
    }
    return path;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
```

- [ ] **Step 2: Run engine tests**

Run:

```bash
pnpm vitest run tests/unit/claude-print-chat-engine.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/chat/src/live/claude-print-chat-engine.ts tests/unit/claude-print-chat-engine.test.ts
git commit -m "feat: add claude print chat engine"
```

## Task 3: Route Anthropic `non_interactive` To The Print Engine

**Files:**

- Modify: `packages/chat/src/live/runtime.ts`
- Modify: `packages/chat/src/live/types.ts` only if #521 has not already threaded `executionMode`
- Modify or create: focused runtime-selection test beside existing chat live tests

- [ ] **Step 1: Confirm shared execution-mode plumbing exists**

Run:

```bash
rg -n "AiProviderExecutionMode|executionMode" packages/chat/src packages/shared/src packages/ai/src apps/web/src/settings
```

Expected: #521 has added `executionMode` to provider config DTOs and chat runtime construction.

- [ ] **Step 2: Write the route-selection test**

Add a focused test for the landed factory shape. For the expected #521 shape:

```ts
const engine = createRealEngineFactory({ mux: fakeMux }).factory("anthropic", "user-1", {
  executionMode: "non_interactive"
});
expect(engine.constructor.name).toBe("ClaudePrintChatEngine");
```

If #521 lands a different factory signature, patch this test step to the landed signature before writing runtime code.

- [ ] **Step 3: Implement selection**

In `packages/chat/src/live/runtime.ts`, import:

```ts
import { ClaudePrintChatEngine } from "./claude-print-chat-engine.js";
```

Then in `createRealEngineFactory`, return the print engine for Anthropic non-interactive:

```ts
if (provider === "anthropic" && opts.executionMode === "non_interactive") {
  return new ClaudePrintChatEngine(sessionKey, createRealTmuxIo(), {
    mux: opts.mux,
    homeBase,
    credentialFile: opts.credentialFile
  });
}
```

Use the actual option variable names created by #521. Do not route Google or Codex through this engine.

- [ ] **Step 4: Run runtime-selection tests**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts tests/unit/claude-print-chat-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/runtime.ts packages/chat/src/live/types.ts tests/unit/chat-session-manager.test.ts
git commit -m "feat: route claude noninteractive mode"
```

## Task 4: Validation Gate After Claude Quota Reset

**Files:**

- Modify tests only if live validation reveals a parser gap.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm vitest run tests/unit/claude-print-chat-engine.test.ts tests/unit/ai-tmux-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run chat runtime tests**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full local gate**

Run:

```bash
pnpm verify:foundation
```

Expected: PASS. If it fails for unrelated pre-existing reasons, record the exact failing command and output.

- [ ] **Step 4: Run live Claude print smoke after quota reset**

Run this after the Claude weekly limit resets. The June 26 spike saw a reset time of 11am America/Los_Angeles.

From a trusted temporary directory:

```bash
session_id="$(node -e 'console.log(crypto.randomUUID())')"
claude -p --session-id "$session_id" "Reply with exactly: claude print ok"
claude -p --resume "$session_id" "What exact phrase did you just reply with?"
```

Expected:

```text
claude print ok
```

Then run a tool/MCP visibility smoke through Jarv1s with Claude provider `Execution mode` set to `Non-interactive`.

- [ ] **Step 5: Record the live validation result**

If live validation passes, add a short note to the implementation handoff or PR body:

```markdown
Live Claude print validation: pass on 2026-06-27 after quota reset.
```

If live validation fails, leave Claude non-interactive blocked and record the exact missing parity.

## Self-Review Checklist

- [ ] Shared provider config/UI `executionMode` path is reused, not duplicated.
- [ ] Claude interactive mode still uses the existing persistent engine path.
- [ ] Claude `non_interactive` uses `claude -p`.
- [ ] First turn uses `--session-id`; later turns use `--resume`.
- [ ] `--no-session-persistence` is never used.
- [ ] Existing Claude transcript parser is reused.
- [ ] MCP config remains a `0600` file.
- [ ] `kill()` stops the current print-mode turn.
- [ ] Live validation after quota reset is recorded before marking the mode complete.
