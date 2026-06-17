import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveChatHome } from "../../packages/chat/src/live/chat-home.js";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("resolveChatHome", () => {
  it("uses an explicit override before env/default resolution", () => {
    const previous = process.env.JARVIS_CHAT_HOME;
    process.env.JARVIS_CHAT_HOME = "/env/chat";
    try {
      expect(resolveChatHome("/override/chat")).toBe("/override/chat");
    } finally {
      if (previous === undefined) delete process.env.JARVIS_CHAT_HOME;
      else process.env.JARVIS_CHAT_HOME = previous;
    }
  });

  it("uses JARVIS_CHAT_HOME when no override is supplied", () => {
    const previous = process.env.JARVIS_CHAT_HOME;
    process.env.JARVIS_CHAT_HOME = "/env/chat";
    try {
      expect(resolveChatHome()).toBe("/env/chat");
    } finally {
      if (previous === undefined) delete process.env.JARVIS_CHAT_HOME;
      else process.env.JARVIS_CHAT_HOME = previous;
    }
  });

  it("falls back to the user chat directory when unset", () => {
    const previous = process.env.JARVIS_CHAT_HOME;
    delete process.env.JARVIS_CHAT_HOME;
    try {
      expect(resolveChatHome()).toBe(join(homedir(), ".jarvis", "chat"));
    } finally {
      if (previous !== undefined) process.env.JARVIS_CHAT_HOME = previous;
    }
  });

  it("keeps direct JARVIS_CHAT_HOME reads confined to the shared helper", () => {
    expect(source("../../packages/chat/src/live/persona.ts")).not.toContain(
      "process.env.JARVIS_CHAT_HOME"
    );
    expect(source("../../packages/chat/src/live/runtime.ts")).not.toContain(
      "process.env.JARVIS_CHAT_HOME"
    );
    expect(source("../../packages/chat/src/live/chat-home.ts")).toContain(
      "process.env.JARVIS_CHAT_HOME"
    );
  });
});
