import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_STARTER_PROMPT_LENGTH,
  createModuleHostActions,
  sanitizeStarterPrompt
} from "../../apps/web/src/external-modules/host-actions.js";

// #916 — the host validates + caps a module-authored starter prompt and, only when valid,
// opens the assistant with it as an editable draft. These are pure functions (no DOM), so the
// whole fail-closed surface is unit-testable in the node env — no jsdom/RTL.
describe("sanitizeStarterPrompt (#916 validation + hard cap, fail closed)", () => {
  it("trims and returns a valid single-line prompt", () => {
    expect(sanitizeStarterPrompt("  Help me start my job search.  ")).toBe(
      "Help me start my job search."
    );
  });

  it("allows internal newlines/tabs (a starter may be multi-line copy)", () => {
    expect(sanitizeStarterPrompt("Line one\n\tLine two")).toBe("Line one\n\tLine two");
  });

  it("returns null on empty or whitespace-only input (fail closed)", () => {
    expect(sanitizeStarterPrompt("")).toBeNull();
    expect(sanitizeStarterPrompt("   \n\t ")).toBeNull();
  });

  it("returns null on a non-string (fail closed, never throws)", () => {
    expect(sanitizeStarterPrompt(undefined)).toBeNull();
    expect(sanitizeStarterPrompt(null)).toBeNull();
    expect(sanitizeStarterPrompt(42)).toBeNull();
    expect(sanitizeStarterPrompt({ starterPrompt: "x" })).toBeNull();
  });

  it("fails closed (returns null, does NOT truncate) when over the hard cap", () => {
    const oversize = "a".repeat(MAX_STARTER_PROMPT_LENGTH + 1);
    expect(sanitizeStarterPrompt(oversize)).toBeNull();
  });

  it("accepts a prompt exactly at the cap", () => {
    const atCap = "a".repeat(MAX_STARTER_PROMPT_LENGTH);
    expect(sanitizeStarterPrompt(atCap)).toBe(atCap);
  });

  it("returns null when the prompt carries control characters (fail closed)", () => {
    expect(sanitizeStarterPrompt("helloworld")).toBeNull();
    expect(sanitizeStarterPrompt("bell")).toBeNull();
    expect(sanitizeStarterPrompt("esc[31m")).toBeNull();
  });
});

describe("createModuleHostActions (#916 host-bound module id, fail closed)", () => {
  it("opens the assistant with the sanitized prompt on valid input", () => {
    const open = vi.fn();
    const actions = createModuleHostActions("job-search", open);
    actions.openAssistant({ starterPrompt: "  Find me a job.  " });
    expect(open).toHaveBeenCalledExactlyOnceWith("Find me a job.");
  });

  it("does NOT open the assistant on an invalid/oversize prompt (fail closed)", () => {
    const open = vi.fn();
    const actions = createModuleHostActions("job-search", open);
    actions.openAssistant({ starterPrompt: "   " });
    actions.openAssistant({ starterPrompt: "a".repeat(MAX_STARTER_PROMPT_LENGTH + 1) });
    // @ts-expect-error — the contract input has no other field; a module cannot pass a moduleId.
    actions.openAssistant({ starterPrompt: "x", moduleId: "other" });
    expect(open).toHaveBeenCalledExactlyOnceWith("x");
  });

  it("fails closed when the host binding is a blank/malformed module id", () => {
    const open = vi.fn();
    createModuleHostActions("", open).openAssistant({ starterPrompt: "hi" });
    createModuleHostActions("Not A Slug", open).openAssistant({ starterPrompt: "hi" });
    expect(open).not.toHaveBeenCalled();
  });

  it("binds each module to its own handler — one module cannot reach another's action", () => {
    const openA = vi.fn();
    const openB = vi.fn();
    const a = createModuleHostActions("mod-a", openA);
    const b = createModuleHostActions("mod-b", openB);
    a.openAssistant({ starterPrompt: "from A" });
    expect(openA).toHaveBeenCalledExactlyOnceWith("from A");
    expect(openB).not.toHaveBeenCalled();
    b.openAssistant({ starterPrompt: "from B" });
    expect(openB).toHaveBeenCalledExactlyOnceWith("from B");
    expect(openA).toHaveBeenCalledExactlyOnceWith("from A");
  });
});

// Source guard (mirrors tests/unit/chat-composer-voice.test.tsx): the host action must NEVER
// reach for an auto-submit path. If a future edit wires openAssistant to sendChatTurn/openChatWith,
// this fails CI immediately — the node env cannot run an interaction test to catch it otherwise.
describe("host-actions source guard: openAssistant never auto-sends (#916)", () => {
  it("does not reference any chat-send path", () => {
    const source = readFileSync(
      new URL("../../apps/web/src/external-modules/host-actions.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("sendChatTurn");
    expect(source).not.toContain("openChatWith");
    expect(source).not.toContain("/api/chat/turn");
  });
});
