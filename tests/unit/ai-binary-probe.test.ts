import { describe, expect, it } from "vitest";
import { createBinaryProbe } from "../../packages/ai/src/adapters/binary-probe.js";

function fakeIo(installed: string[]) {
  return { isExecutable: (p: string) => installed.includes(p) };
}

describe("createBinaryProbe", () => {
  it("detects a binary present on PATH", () => {
    const probe = createBinaryProbe({ PATH: "/a:/b" }, fakeIo(["/b/tmux"]));
    expect(probe.has("tmux")).toBe(true);
    expect(probe.has("herdr")).toBe(false);
  });

  it("reports both absent when PATH is empty", () => {
    const probe = createBinaryProbe({ PATH: "" }, fakeIo([]));
    expect(probe.has("tmux")).toBe(false);
    expect(probe.has("herdr")).toBe(false);
  });

  it("detects herdr across multiple PATH dirs", () => {
    const probe = createBinaryProbe({ PATH: "/x:/y:/z" }, fakeIo(["/z/herdr"]));
    expect(probe.has("herdr")).toBe(true);
  });
});
