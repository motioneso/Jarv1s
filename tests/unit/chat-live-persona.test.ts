/**
 * Unit tests for renderPersona — resolves a per-user neutral working directory
 * (outside the repo) and writes the Jarvis persona into the provider-specific
 * context filename so the CLI auto-loads it (and reloads after /clear).
 *
 * No real disk I/O: the PersonaFs seam is faked.
 */
import { describe, expect, it } from "vitest";

import { renderPersona, type PersonaFs } from "../../packages/chat/src/live/persona.js";

function fakeFs(): { fs: PersonaFs; mkdirs: string[]; writes: Record<string, string>; calls: string[] } {
  const mkdirs: string[] = [];
  const writes: Record<string, string> = {};
  const calls: string[] = [];
  const fs: PersonaFs = {
    mkdir: async (path: string) => {
      mkdirs.push(path);
      calls.push(`mkdir:${path}`);
    },
    writeFile: async (path: string, content: string) => {
      writes[path] = content;
      calls.push(`writeFile:${path}`);
    }
  };
  return { fs, mkdirs, writes, calls };
}

describe("renderPersona", () => {
  it("renders the persona to the provider's context filename in the user's neutral dir", async () => {
    const { fs, writes } = fakeFs();
    const { neutralDir, personaPath } = await renderPersona(fs, {
      userId: "u1",
      userName: "Ben",
      provider: "anthropic",
      baseDir: "/base",
      persona: "You are Jarvis, {{userName}}'s assistant."
    });
    expect(neutralDir).toBe("/base/u1");
    expect(personaPath).toBe("/base/u1/CLAUDE.md");
    expect(writes["/base/u1/CLAUDE.md"]).toContain("You are Jarvis, Ben's assistant.");
  });

  it("uses AGENTS.md for openai-compatible", async () => {
    const { fs, writes } = fakeFs();
    const { personaPath } = await renderPersona(fs, {
      userId: "u1",
      userName: "Ben",
      provider: "openai-compatible",
      baseDir: "/base",
      persona: "hello"
    });
    expect(personaPath).toBe("/base/u1/AGENTS.md");
    expect(writes["/base/u1/AGENTS.md"]).toBe("hello");
  });

  it("uses GEMINI.md for google", async () => {
    const { fs, writes } = fakeFs();
    const { personaPath } = await renderPersona(fs, {
      userId: "u1",
      userName: "Ben",
      provider: "google",
      baseDir: "/base",
      persona: "hello"
    });
    expect(personaPath).toBe("/base/u1/GEMINI.md");
    expect(writes["/base/u1/GEMINI.md"]).toBe("hello");
  });

  it("calls mkdir for the neutral dir before writeFile", async () => {
    const { fs, calls } = fakeFs();
    await renderPersona(fs, {
      userId: "u1",
      userName: "Ben",
      provider: "anthropic",
      baseDir: "/base",
      persona: "hello"
    });
    expect(calls).toEqual(["mkdir:/base/u1", "writeFile:/base/u1/CLAUDE.md"]);
  });

  it("replaces every {{userName}} token", async () => {
    const { fs, writes } = fakeFs();
    const { personaPath } = await renderPersona(fs, {
      userId: "u1",
      userName: "Ben",
      provider: "anthropic",
      baseDir: "/base",
      persona: "{{userName}} is here. Hi {{userName}}."
    });
    expect(writes[personaPath]).toBe("Ben is here. Hi Ben.");
  });

  it("defaults the base dir from JARVIS_CHAT_HOME when baseDir is omitted", async () => {
    const prev = process.env.JARVIS_CHAT_HOME;
    process.env.JARVIS_CHAT_HOME = "/env/home";
    try {
      const { fs } = fakeFs();
      const { neutralDir, personaPath } = await renderPersona(fs, {
        userId: "u2",
        userName: "Ben",
        provider: "anthropic",
        persona: "hello"
      });
      expect(neutralDir).toBe("/env/home/u2");
      expect(personaPath).toBe("/env/home/u2/CLAUDE.md");
    } finally {
      if (prev === undefined) delete process.env.JARVIS_CHAT_HOME;
      else process.env.JARVIS_CHAT_HOME = prev;
    }
  });
});
