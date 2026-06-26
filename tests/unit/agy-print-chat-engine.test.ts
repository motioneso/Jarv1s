import { describe, expect, it } from "vitest";

import { AgyPrintChatEngine } from "../../packages/chat/src/live/agy-print-chat-engine.js";
import { createRealEngineFactory } from "../../packages/chat/src/live/runtime.js";
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
    expect(mux.opened[0]).toContain("cd '/tmp/jarvis-neutral'");
  });

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
});

describe("AgyPrintChatEngine Runtime Routing", () => {
  it("routes google non_interactive to AgyPrintChatEngine", () => {
    const mux = fakeMux();
    const factory = createRealEngineFactory({ mux });
    const engine = factory("google", "user-1", { executionMode: "non_interactive" });
    expect(engine.constructor.name).toBe("AgyPrintChatEngine");
  });

  it("preserves interactive routing to persistent engine", () => {
    const mux = fakeMux();
    const factory = createRealEngineFactory({ mux });
    const engine = factory("google", "user-1", { executionMode: "interactive" });
    expect(engine.constructor.name).toBe("CliChatEngineImpl");
  });
});
