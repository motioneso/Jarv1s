# Agy Non-Interactive Execution Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google/Agy provider configs honor `executionMode: "non_interactive"` by running `agy --dangerously-skip-permissions --print` through the existing live chat engine contract with parity to interactive mode.

**Architecture:** Reuse the provider-level `executionMode` plumbing from #521 for admin UI, persistence, and routing. Add an Agy-specific non-interactive `CliChatEngine` implementation that stores launch context, starts one print-mode Agy process per submitted turn inside the existing multiplexer boundary, tails Antigravity `transcript_full.jsonl`, and maps print-mode records into normal Jarv1s transcript records.

**Tech Stack:** TypeScript, existing `CliChatEngine` interface, `Multiplexer`, `TmuxIo`, Agy CLI `--print`, Antigravity transcript JSONL, Vitest.

---

## Dependency

This plan should run after #521 lands the shared provider `executionMode` type/API/UI plumbing. If #521 is not merged yet, do not duplicate that work in a parallel branch. Rebase after #521 or execute only Task 1 and Task 2, then pause before runtime wiring.

Grounding docs:

- Spec: `docs/superpowers/specs/2026-06-26-agy-non-interactive-print-mode-viability.md`
- Viability report: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`
- Shared execution-mode plan: `docs/superpowers/plans/2026-06-26-codex-non-interactive-execution-mode.md`

## File Map

- Modify: `packages/ai/src/adapters/transcript-reader.ts` - parse Agy print-mode records.
- Modify: `packages/ai/src/adapters/tmux-bridge.ts` - add an Antigravity transcript directory resolver or helper.
- Create: `packages/chat/src/live/agy-print-chat-engine.ts` - one-shot print-mode engine implementing `CliChatEngine`.
- Modify: `packages/chat/src/live/runtime.ts` - select the Agy print engine for Google `non_interactive`.
- Modify: `packages/chat/src/live/types.ts` - only if #521 has not already added factory-level `executionMode` threading.
- Modify: `tests/unit/ai-tmux-bridge.test.ts` - parser fixtures for Agy print transcripts.
- Create: `tests/unit/agy-print-chat-engine.test.ts` - engine behavior tests with fake `TmuxIo` and fake `Multiplexer`.
- Modify or create: runtime-selection tests beside existing chat live tests.

## Task 1: Add Agy Print Transcript Fixtures

**Files:**

- Modify: `tests/unit/ai-tmux-bridge.test.ts`
- Modify: `packages/ai/src/adapters/transcript-reader.ts`

- [ ] **Step 1: Add minimal sanitized fixtures**

In `tests/unit/ai-tmux-bridge.test.ts`, add fixtures beside the Gemini fixtures. Use synthetic content only:

```ts
const AGY_PRINT_FIXTURE_TOOL = JSON.stringify({
  type: "VIEW_FILE",
  timestamp: "2026-06-26T21:00:00.000Z",
  path: "./word.txt"
});

const AGY_PRINT_FIXTURE_REPLY = JSON.stringify({
  type: "PLANNER_RESPONSE",
  timestamp: "2026-06-26T21:00:01.000Z",
  content: "alpha-bravo-charlie"
});
```

Use `content` as the final text field. If implementation against the committed viability report proves `PLANNER_RESPONSE` uses a different field, stop and update this plan with that observed field before continuing; do not guess in code.

- [ ] **Step 2: Add the failing parser test**

Add:

```ts
it("maps Agy print-mode records to tool activity and final reply", () => {
  const jsonl = [AGY_PRINT_FIXTURE_TOOL, AGY_PRINT_FIXTURE_REPLY].join("\n");

  const result = parseTranscript("google", jsonl, 0);

  expect(result.events).toEqual([{ kind: "tool", text: "VIEW_FILE ./word.txt" }]);
  expect(result.reply).toBe("alpha-bravo-charlie");
  expect(result.complete).toBe(true);
});
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts
```

Expected: FAIL because `mapGeminiRecord()` ignores print-mode records.

- [ ] **Step 4: Extend the Google parser**

In `packages/ai/src/adapters/transcript-reader.ts`, keep the existing Gemini interactive parser and add a print-mode branch:

```ts
function mapGeminiRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  if (rec["type"] !== "gemini") {
    mapAgyPrintRecord(rec, events, onFinal);
    return;
  }

  const content = rec["content"];
  const thoughts = rec["thoughts"];

  if (typeof content === "string" && content.length > 0) {
    onFinal(content);
    return;
  }

  if (Array.isArray(thoughts)) {
    for (const thought of thoughts) {
      if (!isRecord(thought)) continue;
      const subject = typeof thought["subject"] === "string" ? thought["subject"] : "";
      const description = typeof thought["description"] === "string" ? thought["description"] : "";
      const text = subject ? `${subject}: ${description}` : description;
      events.push({ kind: "thinking", text });
    }
  }
}

function mapAgyPrintRecord(
  rec: Record<string, unknown>,
  events: ChatActivityEvent[],
  onFinal: (text: string) => void
): void {
  const type = typeof rec["type"] === "string" ? rec["type"] : "";
  if (type === "PLANNER_RESPONSE") {
    const text =
      typeof rec["content"] === "string"
        ? rec["content"]
        : typeof rec["text"] === "string"
          ? rec["text"]
          : "";
    if (text.trim()) onFinal(text);
    return;
  }

  if (type === "VIEW_FILE" || type === "RUN_COMMAND") {
    const target =
      typeof rec["path"] === "string"
        ? rec["path"]
        : typeof rec["command"] === "string"
          ? rec["command"]
          : "";
    events.push({ kind: "tool", text: target ? `${type} ${target}` : type });
  }
}
```

Keep this parser intentionally narrow. Add more record types only when a fixture proves they are needed.

- [ ] **Step 5: Run parser tests**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/adapters/transcript-reader.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat: parse agy print transcript records"
```

## Task 2: Add Antigravity Transcript Resolution

**Files:**

- Modify: `packages/ai/src/adapters/tmux-bridge.ts`
- Modify: `tests/unit/ai-tmux-bridge.test.ts`

- [ ] **Step 1: Add a helper test**

In `tests/unit/ai-tmux-bridge.test.ts`, import the new helper after it exists. First write the intended test:

```ts
describe("agyPrintTranscriptRoot", () => {
  it("points at the Antigravity brain transcript root under the selected home base", () => {
    expect(agyPrintTranscriptRoot("/custom/home")).toBe(
      "/custom/home/.gemini/antigravity-cli/brain"
    );
  });
});
```

Expected first run: FAIL because `agyPrintTranscriptRoot` is not exported.

- [ ] **Step 2: Add the helper**

In `packages/ai/src/adapters/tmux-bridge.ts`, export:

```ts
export function agyPrintTranscriptRoot(homeBase: string = homedir()): string {
  return join(homeBase, ".gemini", "antigravity-cli", "brain");
}
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/adapters/tmux-bridge.ts tests/unit/ai-tmux-bridge.test.ts
git commit -m "feat: resolve agy print transcripts"
```

## Task 3: Implement `AgyPrintChatEngine`

**Files:**

- Create: `packages/chat/src/live/agy-print-chat-engine.ts`
- Create: `tests/unit/agy-print-chat-engine.test.ts`

- [ ] **Step 1: Write the fake test harness**

Create `tests/unit/agy-print-chat-engine.test.ts` with fake `TmuxIo` and `Multiplexer`:

```ts
import { describe, expect, it } from "vitest";

import { AgyPrintChatEngine } from "../../packages/chat/src/live/agy-print-chat-engine.js";
import type { Multiplexer, MuxHandle, TmuxIo } from "@jarv1s/ai";

function fakeIo(files: Record<string, string> = {}): TmuxIo & { runs: string[]; writes: Record<string, string> } {
  return {
    runs: [],
    writes: files,
    async run(cmd, args) {
      this.runs.push([cmd, ...args].join(" "));
      if (cmd === "find") return { code: 0, stdout: "/home/test/.gemini/antigravity-cli/brain/proj/.system_generated/logs/transcript_full.jsonl\n" };
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
      return "handle-1";
    },
    async submit() {
      throw new Error("AgyPrintChatEngine should open per-turn commands, not paste into a REPL");
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

- [ ] **Step 2: Add the launch/submit command test**

Add:

```ts
describe("AgyPrintChatEngine", () => {
  it("runs submitted turns through agy print mode with permission skipping", async () => {
    const io = fakeIo();
    const mux = fakeMux();
    const engine = new AgyPrintChatEngine("user-1", io, { mux, homeBase: "/home/test" });

    await engine.launch({
      neutralDir: "/tmp/jarvis-neutral",
      personaPath: "/tmp/jarvis-neutral/persona.md",
      personaText: "persona"
    });
    await engine.submit("read ./word.txt");

    expect(mux.opened[0]).toContain("agy --dangerously-skip-permissions --print");
    expect(mux.opened[0]).toContain("cd /tmp/jarvis-neutral");
  });
});
```

- [ ] **Step 3: Add the readNew test**

Add:

```ts
it("reads Antigravity print transcripts through parseTranscript", async () => {
  const transcript =
    JSON.stringify({ type: "VIEW_FILE", path: "./word.txt" }) +
    "\n" +
    JSON.stringify({ type: "PLANNER_RESPONSE", content: "alpha-bravo-charlie" }) +
    "\n";
  const path =
    "/home/test/.gemini/antigravity-cli/brain/proj/.system_generated/logs/transcript_full.jsonl";
  const io = fakeIo({ [path]: transcript });
  const mux = fakeMux();
  const engine = new AgyPrintChatEngine("user-1", io, { mux, homeBase: "/home/test" });

  await engine.launch({
    neutralDir: "/tmp/jarvis-neutral",
    personaPath: "/tmp/jarvis-neutral/persona.md",
    personaText: "persona"
  });

  const result = await engine.readNew(0);

  expect(result.records.map((r) => r.kind)).toEqual(["tool", "reply"]);
  expect(result.complete).toBe(true);
  expect(result.offset).toBe(transcript.length);
});
```

- [ ] **Step 4: Run the failing engine tests**

Run:

```bash
pnpm vitest run tests/unit/agy-print-chat-engine.test.ts
```

Expected: FAIL because `AgyPrintChatEngine` does not exist.

- [ ] **Step 5: Implement the engine**

Create `packages/chat/src/live/agy-print-chat-engine.ts`:

```ts
import { join } from "node:path";

import {
  agyPrintTranscriptRoot,
  parseTranscript,
  TmuxMultiplexer,
  type Multiplexer,
  type MuxHandle,
  type TmuxIo
} from "@jarv1s/ai";

import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";

const PROMPT_FILENAME = ".jarvis-agy-print-prompt.txt";

export interface AgyPrintChatEngineOpts {
  readonly mux?: Multiplexer;
  readonly homeBase?: string;
}

export class AgyPrintChatEngine implements CliChatEngine {
  readonly provider = "google" as const;
  private readonly mux: Multiplexer;
  private readonly homeBase?: string;
  private neutralDir: string | null = null;
  private transcriptPath: string | null = null;
  private currentHandle: MuxHandle | null = null;
  private hasSubmitted = false;
  private launchEpoch = 0;

  constructor(
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: AgyPrintChatEngineOpts = {}
  ) {
    this.mux = opts.mux ?? new TmuxMultiplexer(io);
    this.homeBase = opts.homeBase;
  }

  async launch(opts: EngineLaunchOpts): Promise<{ offset: number }> {
    this.neutralDir = opts.neutralDir;
    this.launchEpoch = Date.now();
    if (opts.personaText !== undefined) {
      await this.io.writeFile(join(opts.neutralDir, "persona.md"), opts.personaText);
    }
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    if (this.neutralDir === null) throw new Error("AgyPrintChatEngine.submit called before launch()");
    const promptPath = join(this.neutralDir, PROMPT_FILENAME);
    await this.io.writeFile(promptPath, text.replace(/^(\s*)!+/, "$1"));
    const continueFlag = this.hasSubmitted ? "--continue " : "";
    this.hasSubmitted = true;
    this.currentHandle = await this.mux.open({
      name: `jarv1s-live-${this.threadKey}`,
      cols: 220,
      rows: 50,
      launchLine:
        `cd ${shellQuote(this.neutralDir)} && ` +
        `agy --dangerously-skip-permissions ${continueFlag}--print "$(cat ${shellQuote(promptPath)})"`
    });
  }

  async readNew(afterOffset: number): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    const path = await this.resolveTranscriptPath();
    if (path === null) return { records: [], offset: afterOffset, complete: false };
    let jsonl: string;
    try {
      jsonl = await this.io.readFile(path);
    } catch {
      return { records: [], offset: afterOffset, complete: false };
    }
    const parsed = parseTranscript("google", jsonl, afterOffset);
    const records: TranscriptRecord[] = parsed.events.map((event) => ({
      kind: event.kind as ChatRecordKind,
      text: event.text
    }));
    if (parsed.complete && parsed.reply !== null) records.push({ kind: "reply", text: parsed.reply });
    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    return this.currentHandle !== null ? this.mux.isAlive(this.currentHandle) : false;
  }

  async kill(): Promise<void> {
    if (this.currentHandle !== null) await this.mux.kill(this.currentHandle);
    this.currentHandle = null;
  }

  private async resolveTranscriptPath(): Promise<string | null> {
    if (this.transcriptPath !== null) return this.transcriptPath;
    const root = agyPrintTranscriptRoot(this.homeBase);
    const found = await this.io.run("find", [
      root,
      "-name",
      "transcript_full.jsonl",
      "-type",
      "f",
      "-newermt",
      new Date(this.launchEpoch - 5000).toISOString(),
      "-print"
    ]);
    if (found.code !== 0) return null;
    const newest = found.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    this.transcriptPath = newest ?? null;
    return this.transcriptPath;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
```

This is intentionally small. If tests reveal `find` ordering is unstable, update `resolveTranscriptPath()` to use `find -printf "%T@ %p\n"` and sort numerically.

- [ ] **Step 6: Run engine tests**

Run:

```bash
pnpm vitest run tests/unit/agy-print-chat-engine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/chat/src/live/agy-print-chat-engine.ts tests/unit/agy-print-chat-engine.test.ts
git commit -m "feat: add agy print chat engine"
```

## Task 4: Route Google `non_interactive` To The Print Engine

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

Add a focused test that calls the production engine factory with provider `google` and `executionMode: "non_interactive"` and asserts the returned engine provider is `google` and class name is `AgyPrintChatEngine`.

If the factory shape from #521 is:

```ts
factory(provider, sessionKey, { executionMode: "non_interactive" })
```

then test:

```ts
const engine = createRealEngineFactory({ mux: fakeMux }).factory("google", "user-1", {
  executionMode: "non_interactive"
});
expect(engine.constructor.name).toBe("AgyPrintChatEngine");
```

If #521 lands a different factory shape, stop and patch this test step to the landed shape before writing runtime code.

- [ ] **Step 3: Implement selection**

In `packages/chat/src/live/runtime.ts`, import:

```ts
import { AgyPrintChatEngine } from "./agy-print-chat-engine.js";
```

Then in `createRealEngineFactory`, return the print engine for Google non-interactive:

```ts
if (provider === "google" && opts.executionMode === "non_interactive") {
  return new AgyPrintChatEngine(sessionKey, createRealTmuxIo(), {
    mux: opts.mux,
    homeBase
  });
}
```

Use the actual option variable names created by #521. Do not route Codex through this engine.

- [ ] **Step 4: Run runtime-selection tests**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts tests/unit/agy-print-chat-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/live/runtime.ts packages/chat/src/live/types.ts tests/unit/chat-session-manager.test.ts tests/unit/agy-print-chat-engine.test.ts
git commit -m "feat: route agy noninteractive mode"
```

## Task 5: Live Parity Smoke

**Files:**

- Modify tests only if a regression is found.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm vitest run tests/unit/ai-tmux-bridge.test.ts tests/unit/agy-print-chat-engine.test.ts
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

- [ ] **Step 4: Manual Agy print-mode smoke**

In a dev environment with Agy auth available, configure the Google/Agy provider `Execution mode` to `Non-interactive`, then send:

```text
Reply with exactly: agy print ok
```

Expected final reply:

```text
agy print ok
```

Then send:

```text
Read ./word.txt from the current directory if it exists. If it does not exist, say no word file.
```

Expected: the activity stream shows a `tool` record from the Agy print transcript and the turn completes.

- [ ] **Step 5: Commit verification fixes only if needed**

If verification exposed a real bug, commit the minimal fix:

```bash
git add packages/ai/src/adapters/transcript-reader.ts packages/chat/src/live/agy-print-chat-engine.ts tests/unit/ai-tmux-bridge.test.ts tests/unit/agy-print-chat-engine.test.ts
git commit -m "fix: stabilize agy print execution mode"
```

## Self-Review Checklist

- [ ] The shared admin/provider config `executionMode` path is reused, not duplicated.
- [ ] `ChatSessionManager` public behavior is unchanged.
- [ ] Google interactive mode still uses the existing persistent Agy/Gemini engine path.
- [ ] Google `non_interactive` uses `agy --dangerously-skip-permissions --print`.
- [ ] Continuation turns include `--continue`.
- [ ] Print-mode transcript records map to `tool` and `reply`.
- [ ] `kill()` stops the current print-mode turn.
- [ ] Raw transcript contents, secrets, and local private paths are not committed.
